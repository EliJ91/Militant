import { describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import {
  classifyLogText,
  collectLogAttachmentJobs,
  DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID,
  handleUploadCommand,
  isSupportedLogAttachment,
  isUploadCommandMessage,
  memberCanUploadLootLogsFromDiscord,
  processLootLogThread,
} from './lootLogDiscordWorker.js';

const lootLogText = [
  'looted_by__name;looted_by__guild;looted_by__alliance;looted_from__name;looted_from__guild;looted_from__alliance;item_name;item_id;quantity;timestamp_utc',
  'Onslawht;Militant;CHAIR;;;;Adept\'s Rune;T4_RUNE;2;2026-07-12T04:10:00.000Z',
].join('\n');

function createAttachment(id, name) {
  return { id, name, url: `https://cdn.discordapp.test/${id}/${name}` };
}

function createMessage({ attachment, author = {}, id, timestamp }) {
  return {
    attachments: new Map([[attachment.id, attachment]]),
    author: { id: 'discord-user', username: 'DiscordUser', ...author },
    createdTimestamp: timestamp,
    guild: {
      members: {
        fetch: vi.fn().mockResolvedValue({ displayName: 'Onslawht', nickname: 'Onslawht' }),
      },
    },
    id,
    member: { displayName: 'Onslawht', nickname: 'Onslawht' },
  };
}

function createSupabaseMock({ permissionRoles = [], processedAttachmentIds = [], threadRecord = null } = {}) {
  const state = {
    actionLogs: [],
    attachments: [],
    bundleSummary: threadRecord?.bundle_id ? {
      discordProcessedAttachmentIds: threadRecord.processedAttachmentIds || [],
      discordThreadId: threadRecord.thread_id,
      discordThreadName: threadRecord.thread_name,
    } : {},
    processedAttachmentIds,
    threadRecord,
    threadUpserts: [],
  };

  function builder(table) {
    const query = {
      _filters: {},
      eq(column, value) {
        this._filters[column] = value;
        return this;
      },
      in(column, values) {
        this._filters[column] = values;
        return this;
      },
      insert(value) {
        if (table === 'webapp_action_logs') {
          state.actionLogs.push(value);
          return this;
        }
        if (table === 'discord_loot_threads') {
          state.threadRecord = {
            bundle_id: null,
            created_at: '2026-07-12T04:00:00.000Z',
            updated_at: '2026-07-12T04:00:00.000Z',
            ...value,
          };
          return this;
        }
        return this;
      },
      maybeSingle() {
        if (table === 'webapp_permission_settings') {
          return Promise.resolve({
            data: { settings: { roles: permissionRoles } },
            error: null,
          });
        }
        if (table === 'loot_log_bundles' && state.threadRecord?.bundle_id) {
          return Promise.resolve({
            data: {
              combined_loot_summary: state.bundleSummary,
              id: state.threadRecord.bundle_id,
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      select() {
        return this;
      },
      single() {
        if (table === 'loot_log_bundles') {
          return Promise.resolve({
            data: {
              combined_loot_summary: state.bundleSummary,
              id: this._filters.id || state.threadRecord?.bundle_id || 'bundle-1',
            },
            error: null,
          });
        }
        return Promise.resolve({ data: state.threadRecord, error: null });
      },
      update(value) {
        if (table === 'loot_log_bundles') {
          state.bundleSummary = value.combined_loot_summary || state.bundleSummary;
          state.threadRecord = {
            ...(state.threadRecord || {}),
            bundle_id: this._filters.id || state.threadRecord?.bundle_id || 'bundle-1',
            channel_id: state.bundleSummary.discordChannelId || DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID,
            processedAttachmentIds: state.bundleSummary.discordProcessedAttachmentIds || [],
            thread_id: state.bundleSummary.discordThreadId || 'thread-1',
            thread_name: state.bundleSummary.discordThreadName || '04 CTA loot uploads',
          };
        }
        return this;
      },
      upsert(value) {
        if (table === 'discord_loot_threads') {
          state.threadRecord = { ...(state.threadRecord || {}), ...value };
          state.threadUpserts.push(value);
        }
        if (table === 'discord_loot_attachments') {
          state.attachments.push(value);
        }
        return this;
      },
      then(resolve) {
        if (table === 'discord_loot_attachments') {
          const ids = new Set(this._filters.attachment_id || []);
          resolve({
            data: state.processedAttachmentIds
              .filter((id) => ids.has(id))
              .map((attachment_id) => ({ attachment_id })),
            error: null,
          });
          return undefined;
        }
        resolve({ data: [], error: null });
        return undefined;
      },
    };

    return query;
  }

  return {
    from: vi.fn(builder),
    state,
  };
}

function createThread(messages) {
  return {
    id: 'thread-1',
    messages: {
      fetch: vi.fn().mockResolvedValue(new Map(messages.map((message) => [message.id, message]))),
    },
    name: '04 CTA loot uploads',
    parentId: DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID,
    type: ChannelType.PublicThread,
  };
}

describe('Discord loot log worker helpers', () => {
  it('recognizes supported log attachment extensions', () => {
    expect(isSupportedLogAttachment(createAttachment('1', 'loot.csv'))).toBe(true);
    expect(isSupportedLogAttachment(createAttachment('2', 'chest.txt'))).toBe(false);
    expect(isSupportedLogAttachment(createAttachment('3', 'image.png'))).toBe(false);
  });

  it('classifies only loot log text', () => {
    expect(classifyLogText(lootLogText)).toBe('loot');
    expect(classifyLogText('not a log')).toBe('unknown');
  });

  it('collects attachment jobs in timestamp order', () => {
    const first = createMessage({
      attachment: createAttachment('loot-1', 'loot.csv'),
      id: 'message-2',
      timestamp: 200,
    });
    const second = createMessage({
      attachment: createAttachment('loot-2', 'loot.csv'),
      id: 'message-1',
      timestamp: 100,
    });

    expect(collectLogAttachmentJobs([first, second]).map((job) => job.attachmentId))
      .toEqual(['loot-2', 'loot-1']);
  });

  it('recognizes the explicit upload command', () => {
    expect(isUploadCommandMessage({ content: '!upload' })).toBe(true);
    expect(isUploadCommandMessage({ content: '!upload now' })).toBe(true);
    expect(isUploadCommandMessage({ content: 'upload' })).toBe(false);
  });

  it('checks the Discord upload permission against member roles', async () => {
    const supabase = createSupabaseMock({
      permissionRoles: [
        { roleId: 'role-soldier', permissions: { uploadLootLogsFromDiscord: false } },
        { roleId: 'role-logger', permissions: { uploadLootLogsFromDiscord: true } },
      ],
    });

    await expect(memberCanUploadLootLogsFromDiscord({
      member: { id: 'discord-user', roles: { cache: new Map([['role-logger', {}]]) } },
      supabase,
    })).resolves.toBe(true);
    await expect(memberCanUploadLootLogsFromDiscord({
      member: { id: 'discord-user', roles: { cache: new Map([['role-soldier', {}]]) } },
      supabase,
    })).resolves.toBe(false);
  });
});

describe('processLootLogThread', () => {
  it('creates one bundle for a thread and appends later loot csv files to it', async () => {
    const lootAttachment = createAttachment('loot-1', 'loot.csv');
    const laterLootAttachment = createAttachment('loot-2', 'later-loot.csv');
    const messages = [
      createMessage({ attachment: lootAttachment, id: 'message-1', timestamp: 100 }),
      createMessage({
        attachment: laterLootAttachment,
        author: { id: 'discord-user-2', username: 'SecondUser' },
        id: 'message-2',
        timestamp: 200,
      }),
    ];
    const thread = createThread(messages);
    const supabase = createSupabaseMock();
    const submitLootLogFn = vi.fn().mockResolvedValue({ bundleId: 'bundle-1' });
    const fetchAttachmentTextFn = vi.fn().mockResolvedValue(lootLogText);

    const result = await processLootLogThread({
      fetchAttachmentTextFn,
      submitLootLogFn,
      supabase,
      thread,
    });

    expect(result).toEqual({ bundleId: 'bundle-1', processedAttachments: 2, skippedAttachments: 0 });
    expect(submitLootLogFn).toHaveBeenNthCalledWith(1, {
      bundleId: null,
      lootLogText,
      originalFileName: '04 CTA loot uploads',
      username: 'Onslawht',
    });
    expect(submitLootLogFn).toHaveBeenNthCalledWith(2, {
      bundleId: 'bundle-1',
      lootLogText,
      originalFileName: '04 CTA loot uploads',
      username: 'Onslawht',
    });
    expect(supabase.state.attachments.map((row) => [row.attachment_id, row.log_type, row.bundle_id]))
      .toEqual([
        ['loot-1', 'loot', 'bundle-1'],
        ['loot-2', 'loot', 'bundle-1'],
      ]);
  });

  it('does not reprocess attachments already recorded in the database', async () => {
    const lootAttachment = createAttachment('loot-1', 'loot.csv');
    const thread = createThread([
      createMessage({ attachment: lootAttachment, id: 'message-1', timestamp: 100 }),
    ]);
    const supabase = createSupabaseMock({
      processedAttachmentIds: ['loot-1'],
      threadRecord: {
        bundle_id: 'bundle-1',
        channel_id: DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID,
        thread_id: 'thread-1',
        thread_name: '04 CTA loot uploads',
      },
    });
    const submitLootLogFn = vi.fn();
    const fetchAttachmentTextFn = vi.fn();

    const result = await processLootLogThread({
      fetchAttachmentTextFn,
      submitLootLogFn,
      supabase,
      thread,
    });

    expect(result).toEqual({ bundleId: 'bundle-1', processedAttachments: 0, skippedAttachments: 0 });
    expect(fetchAttachmentTextFn).not.toHaveBeenCalled();
    expect(submitLootLogFn).not.toHaveBeenCalled();
  });
});

describe('handleUploadCommand', () => {
  it('uploads thread loot csv files only when !upload is used by a permitted member', async () => {
    const lootAttachment = createAttachment('loot-1', 'loot.csv');
    const attachmentMessage = createMessage({ attachment: lootAttachment, id: 'message-1', timestamp: 100 });
    const thread = createThread([attachmentMessage]);
    const commandMessage = {
      author: { id: 'discord-user' },
      channel: thread,
      content: '!upload',
      guild: attachmentMessage.guild,
      member: { id: 'discord-user', roles: { cache: new Map([['role-logger', {}]]) } },
    };
    const supabase = createSupabaseMock({
      permissionRoles: [
        { roleId: 'role-logger', permissions: { uploadLootLogsFromDiscord: true } },
      ],
    });
    const submitLootLogFn = vi.fn().mockResolvedValue({ bundleId: 'bundle-1' });
    const fetchAttachmentTextFn = vi.fn().mockResolvedValue(lootLogText);

    const result = await handleUploadCommand({
      fetchAttachmentTextFn,
      message: commandMessage,
      submitLootLogFn,
      supabase,
    });

    expect(result).toEqual({ bundleId: 'bundle-1', processedAttachments: 1, skippedAttachments: 0 });
    expect(submitLootLogFn).toHaveBeenCalledTimes(1);
    expect(supabase.state.actionLogs).toContainEqual(expect.objectContaining({
      actor_name: 'Onslawht',
      details: expect.objectContaining({ uploadedBy: 'Onslawht' }),
    }));
  });

  it('never falls back to a Discord username when a server nickname is unavailable', async () => {
    const lootAttachment = createAttachment('loot-1', 'loot.csv');
    const attachmentMessage = {
      ...createMessage({ attachment: lootAttachment, id: 'message-1', timestamp: 100 }),
      guild: { members: { fetch: vi.fn().mockResolvedValue({ nickname: null }) } },
      member: { roles: { cache: new Map([['role-logger', {}]]) } },
    };
    const thread = createThread([attachmentMessage]);
    const supabase = createSupabaseMock({
      permissionRoles: [
        { roleId: 'role-logger', permissions: { uploadLootLogsFromDiscord: true } },
      ],
    });

    await handleUploadCommand({
      fetchAttachmentTextFn: vi.fn().mockResolvedValue(lootLogText),
      message: {
        author: { id: 'discord-user', username: 'ActualUsername' },
        channel: thread,
        content: '!upload',
        guild: { members: { fetch: vi.fn().mockResolvedValue({ nickname: null }) } },
        member: { id: 'discord-user', roles: { cache: new Map([['role-logger', {}]]) } },
      },
      submitLootLogFn: vi.fn().mockResolvedValue({ bundleId: 'bundle-1' }),
      supabase,
    });

    expect(supabase.state.actionLogs).toContainEqual(expect.objectContaining({
      actor_name: 'Unknown Server Member',
      details: expect.objectContaining({ uploadedBy: 'Unknown Server Member' }),
    }));
  });

  it('does not upload when the member lacks the Discord upload permission', async () => {
    const lootAttachment = createAttachment('loot-1', 'loot.csv');
    const attachmentMessage = createMessage({ attachment: lootAttachment, id: 'message-1', timestamp: 100 });
    const thread = createThread([attachmentMessage]);
    const supabase = createSupabaseMock({
      permissionRoles: [
        { roleId: 'role-soldier', permissions: { uploadLootLogsFromDiscord: false } },
      ],
    });
    const submitLootLogFn = vi.fn();

    const result = await handleUploadCommand({
      message: {
        author: { id: 'discord-user' },
        channel: thread,
        content: '!upload',
        member: { id: 'discord-user', roles: { cache: new Map([['role-soldier', {}]]) } },
      },
      submitLootLogFn,
      supabase,
    });

    expect(result).toEqual({ forbidden: true, processedAttachments: 0, skippedAttachments: 0 });
    expect(submitLootLogFn).not.toHaveBeenCalled();
  });
});
