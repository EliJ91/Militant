import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
  || import.meta.env.VITE_PRODUCTION_SUPABASE_URL
  || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
  || import.meta.env.VITE_PRODUCTION_SUPABASE_ANON_KEY
  || '';
const POST_LOGIN_ROUTE_KEY = 'militant.auth.redirect';

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
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
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
  const client = getAuthClient();
  if (!client) return null;

  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data?.session || null;
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
  if (!client) throw new Error('Discord login is not configured.');

  try {
    window.localStorage.setItem(POST_LOGIN_ROUTE_KEY, redirectRoute);
  } catch {
    // OAuth still works without storing the preferred post-login route.
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
  if (!client) return;

  const { error } = await client.auth.signOut();
  if (error) throw error;
}
