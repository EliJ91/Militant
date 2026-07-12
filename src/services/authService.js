import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
  || import.meta.env.VITE_PRODUCTION_SUPABASE_URL
  || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
  || import.meta.env.VITE_PRODUCTION_SUPABASE_ANON_KEY
  || '';
const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID
  || '1525606439500910682';
const POST_LOGIN_ROUTE_KEY = 'militant.auth.redirect';
const DISCORD_SESSION_KEY = 'militant.discord.session';

let authClient = null;

function getAuthClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!authClient) {
    authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  }
  return authClient;
}

export function isDiscordAuthConfigured() {
  return Boolean((SUPABASE_URL && SUPABASE_ANON_KEY) || DISCORD_CLIENT_ID);
}

export function getPendingAuthRoute() {
  try {
    return window.localStorage.getItem(POST_LOGIN_ROUTE_KEY) || '';
  } catch {
    return '';
  }
}

export function clearPendingAuthRoute() {
  try {
    window.localStorage.removeItem(POST_LOGIN_ROUTE_KEY);
  } catch {
    // The route marker is only a convenience after OAuth returns.
  }
}

export async function getCurrentAuthSession() {
  const implicitSession = await consumeDiscordImplicitCallback();
  if (implicitSession) return implicitSession;

  const client = getAuthClient();
  if (!client) return getStoredDiscordSession();

  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data?.session || getStoredDiscordSession();
}

export function onAuthStateChange(callback) {
  const client = getAuthClient();
  if (!client) return () => {};

  const { data } = client.auth.onAuthStateChange((_event, session) => {
    callback(session || null);
  });
  return () => data?.subscription?.unsubscribe?.();
}

export async function signInWithDiscord(redirectRoute = '#dashboard') {
  const client = getAuthClient();
  if (!client && !DISCORD_CLIENT_ID) throw new Error('Discord login is not configured.');

  try {
    window.localStorage.setItem(POST_LOGIN_ROUTE_KEY, redirectRoute);
  } catch {
    // OAuth still works without storing the preferred post-login route.
  }

  if (!client) {
    signInWithDiscordImplicit(redirectRoute);
    return;
  }

  const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const { error } = await client.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signOutOfDiscord() {
  const client = getAuthClient();
  clearPendingAuthRoute();
  clearStoredDiscordSession();
  if (!client) return;

  const { error } = await client.auth.signOut();
  if (error) throw error;
}

async function consumeDiscordImplicitCallback() {
  const params = getDiscordCallbackParams();
  const accessToken = params.get('access_token') || '';
  const tokenType = params.get('token_type') || 'Bearer';
  const expiresIn = Number(params.get('expires_in') || '0');
  if (!accessToken) return null;

  const session = await buildDiscordSession({
    accessToken,
    expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0,
    tokenType,
  });
  storeDiscordSession(session);

  const pendingRoute = getPendingAuthRoute() || '#dashboard';
  const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${pendingRoute}`;
  window.history.replaceState(null, '', cleanUrl);
  window.dispatchEvent(new Event('militant-route-change'));
  return session;
}

async function buildDiscordSession({ accessToken, expiresAt, tokenType }) {
  const user = await fetchDiscordUser(accessToken, tokenType);
  return {
    accessToken,
    expiresAt,
    provider: 'discord',
    tokenType,
    user: {
      avatar: user.avatar || '',
      discriminator: user.discriminator || '',
      globalName: user.global_name || '',
      id: user.id,
      username: user.username,
    },
  };
}

function getDiscordCallbackParams() {
  const hash = window.location.hash || '';
  if (hash.includes('access_token=')) return new URLSearchParams(hash.slice(1));

  const search = window.location.search || '';
  if (search.includes('access_token=')) return new URLSearchParams(search.slice(1));

  return new URLSearchParams();
}

async function fetchDiscordUser(accessToken, tokenType) {
  try {
    const response = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `${tokenType} ${accessToken}` },
    });
    if (!response.ok) throw new Error('Discord profile lookup failed.');
    const user = await response.json();
    if (user?.id) return user;
  } catch {
    // The login token is enough to unlock the app; profile data can be added by the backend later.
  }

  return {
    avatar: '',
    discriminator: '',
    global_name: '',
    id: 'discord-oauth-user',
    username: 'Discord User',
  };
}

function getStoredDiscordSession() {
  try {
    const rawSession = window.localStorage.getItem(DISCORD_SESSION_KEY);
    if (!rawSession) return null;
    const session = JSON.parse(rawSession);
    if (session?.expiresAt && session.expiresAt <= Date.now()) {
      clearStoredDiscordSession();
      return null;
    }
    return session?.user?.id ? session : null;
  } catch {
    clearStoredDiscordSession();
    return null;
  }
}

function storeDiscordSession(session) {
  try {
    window.localStorage.setItem(DISCORD_SESSION_KEY, JSON.stringify(session));
  } catch {
    // The in-memory auth state still works for the current page load.
  }
}

function clearStoredDiscordSession() {
  try {
    window.localStorage.removeItem(DISCORD_SESSION_KEY);
  } catch {
    // Clearing auth should not fail sign out.
  }
}

function signInWithDiscordImplicit(redirectRoute) {
  const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: redirectTo,
    response_type: 'token',
    scope: 'identify',
    state: redirectRoute,
  });
  window.location.assign(`https://discord.com/oauth2/authorize?${params.toString()}`);
}
