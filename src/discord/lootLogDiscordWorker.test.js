import { describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import {
  classifyLogText,
  collectLogAttachmentJobs,
  DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID,
  isSupportedLogAttachment,
  processLootLogThread,
} from './lootLogDiscordWorker.js';

const lootLogText = [
  'looted_by__name;looted_by__guild;looted_by__alliance;looted_from__name;looted_from__guild;looted_from__alliance;item_name;item_id;quantity;timestamp_utc',
  'Onslawht;Militant;CHAIR;;;;Adept\'s Rune;T4_RUNE;2;2026-07-12T04:10:00.000Z',
].join('\n');

const chestLogText = [
  'Date\tPlayer\tItem\tEnchantment\tQuality\tAmount',
  '07/12/2026 04:20:00\tOnslawht\tAdept\'s Rune\t0\t1\t2',
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

function createSupabaseMock({ processedAttachmentIds = [], threadRecord = null } = {}) {
  const state = {
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
    expect(isSupportedLogAttachment(createAttachment('2', 'chest.txt'))).toBe(true);
    expect(isSupportedLogAttachment(createAttachment('3', 'image.png'))).toBe(false);
  });

  it('classifies loot and chest log text', () => {
    expect(classifyLogText(lootLogText)).toBe('loot');
    expect(classifyLogText(chestLogText)).toBe('chest');
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
});

describe('processLootLogThread', () => {
  it('creates one bundle for a thread and attaches later chest logs to it', async () => {
    const chestAttachment = createAttachment('chest-1', 'chest.txt');
    const lootAttachment = createAttachment('loot-1', 'loot.csv');
    const messages = [
      createMessage({ attachment: chestAttachment, id: 'message-1', timestamp: 100 }),
      createMessage({ attachment: lootAttachment, id: 'message-2', timestamp: 200 }),
    ];
    const thread = createThread(messages);
    const supabase = createSupabaseMock();
    const submitLootLogFn = vi.fn().mockResolvedValue({ bundleId: 'bundle-1' });
    const submitChestLogFn = vi.fn().mockResolvedValue({ bundleId: 'bundle-1' });
    const fetchAttachmentTextFn = vi.fn(async (attachment) => (
      attachment.id === 'loot-1' ? lootLogText : chestLogText
    ));

    const result = await processLootLogThread({
      fetchAttachmentTextFn,
      submitChestLogFn,
      submitLootLogFn,
      supabase,
      thread,
    });

    expect(result).toEqual({ bundleId: 'bundle-1', processedAttachments: 2, skippedAttachments: 0 });
    expect(submitLootLogFn).toHaveBeenCalledWith({
      bundleId: null,
      lootLogText,
      originalFileName: '04 CTA loot uploads',
      username: 'Onslawht',
    });
    expect(submitChestLogFn).toHaveBeenCalledWith({
      bundleId: 'bundle-1',
      chestLogText,
      username: 'Onslawht',
    });
    expect(supabase.state.attachments.map((row) => [row.attachment_id, row.log_type, row.bundle_id]))
      .toEqual([
        ['loot-1', 'loot', 'bundle-1'],
        ['chest-1', 'chest', 'bundle-1'],
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
