import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  recordActionLog,
  setActionLogActorName,
  setActionLogAuthSession,
} from './actionLogsApi';

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
    setActionLogAuthSession({ access_token: 'supabase-token', provider_token: 'discord-token' });

    await recordActionLog({ action: 'Permissions updated' });

    expect(fetchMock).toHaveBeenCalledWith('/api/action-logs', expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer supabase-token',
        'X-Discord-Access-Token': 'discord-token',
      }),
    }));
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
});
