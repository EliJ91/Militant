import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteActionLog,
  recordActionLog,
  setActionLogActorName,
  setActionLogAuthSession,
} from './actionLogsApi';

vi.mock('./authService', () => ({
  getCurrentAuthSession: vi.fn().mockResolvedValue(null),
}));

describe('action log identity', () => {
  afterEach(() => {
    setActionLogActorName('System');
    setActionLogAuthSession(null);
    vi.unstubAllGlobals();
  });

  it('sends the authenticated session so the server can resolve the guild nickname', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ actionLog: { id: 'action-1' } }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    setActionLogActorName('Unknown Server Member');
    setActionLogAuthSession({
      access_token: 'supabase-token',
      provider_token: 'discord-token',
      user: { user_metadata: { provider_id: '264193431830528006' } },
    });

    await recordActionLog({ action: 'Permissions updated' });

    expect(fetchMock).toHaveBeenCalledWith('/api/action-logs', expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer supabase-token',
        'X-Discord-Access-Token': 'discord-token',
      }),
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).discordUserId).toBe('264193431830528006');
  });

  it('uses System for unauthenticated automatic actions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ actionLog: { id: 'action-2' } }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    setActionLogActorName('System');
    setActionLogAuthSession(null);

    await recordActionLog({ action: 'Automated cleanup' });

    const request = fetchMock.mock.calls[0][1];
    expect(JSON.parse(request.body).actorName).toBe('System');
    expect(request.headers).not.toHaveProperty('Authorization');
  });

  it('sends direct Discord OAuth tokens only through the Discord identity header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ actionLog: { id: 'action-3' } }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    setActionLogAuthSession({
      accessToken: 'discord-oauth-token',
      provider: 'discord',
      user: { id: '264193431830528006' },
    });

    await recordActionLog({ action: 'Role added' });

    const request = fetchMock.mock.calls[0][1];
    expect(request.headers).not.toHaveProperty('Authorization');
    expect(request.headers['X-Discord-Access-Token']).toBe('discord-oauth-token');
    expect(JSON.parse(request.body).discordUserId).toBe('264193431830528006');
  });

  it('authenticates action log deletions with the current session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ deleted: true, id: 42 }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    setActionLogAuthSession({ access_token: 'supabase-token' });

    await deleteActionLog(42);

    expect(fetchMock).toHaveBeenCalledWith('/api/action-logs', expect.objectContaining({
      body: JSON.stringify({ id: 42 }),
      headers: expect.objectContaining({ Authorization: 'Bearer supabase-token' }),
      method: 'DELETE',
    }));
  });
});
