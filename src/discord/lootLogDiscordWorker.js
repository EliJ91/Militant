import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import { submitLootLog } from '../server/supabaseLootLogs.js';
import { recordActionLog } from '../server/supabaseActionLogs.js';
import { buildLootLogEvents } from '../utils/lootLogMerge.js';

export const DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID = '1492400020958351391';

const SUPPORTED_ATTACHMENT_EXTENSIONS = new Set(['.csv']);
const MAX_MESSAGES_PER_THREAD_SCAN = 500;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function cleanString(value) {
  return String(value || '').trim();
}

function fileExtension(fileName) {
  const clean = cleanString(fileName).toLowerCase();
  const dotIndex = clean.lastIndexOf('.');
  return dotIndex >= 0 ? clean.slice(dotIndex) : '';
}

export function isSupportedLogAttachment(attachment) {
  const name = cleanString(attachment?.name);
  if (!name) return false;
  return SUPPORTED_ATTACHMENT_EXTENSIONS.has(fileExtension(name));
}

export function classifyLogText(text) {
  if (!cleanString(text)) return 'unknown';

  try {
    const { events } = buildLootLogEvents(text);
    if (events.length > 0) return 'loot';
  } catch {
    // Unknown log format.
  }

  return 'unknown';
}

function messageTimestamp(message) {
  const raw = message?.createdTimestamp || message?.created_at || message?.createdAt;
  const timestamp = typeof raw === 'number' ? raw : new Date(raw || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeAttachment(attachment, message) {
  return {
    attachment,
    attachmentId: cleanString(attachment?.id),
    fileName: cleanString(attachment?.name),
    message,
    messageId: cleanString(message?.id),
    timestamp: messageTimestamp(message),
  };
}

export function collectLogAttachmentJobs(messages) {
  const sourceMessages = Array.isArray(messages) ? messages : [];
  return sourceMessages
    .flatMap((message) => {
      const attachments = typeof message?.attachments?.values === 'function'
        ? [...message.attachments.values()]
        : Array.isArray(message?.attachments)
          ? message.attachments
          : [];

      return attachments
        .filter(isSupportedLogAttachment)
        .map((attachment) => normalizeAttachment(attachment, message));
    })
    .filter((job) => job.attachmentId && job.messageId && job.fileName)
    .sort((left, right) => (
      left.timestamp - right.timestamp
      || left.messageId.localeCompare(right.messageId)
      || left.attachmentId.localeCompare(right.attachmentId)
    ));
}

async function fetchThreadMessages(thread) {
  const messages = [];
  let before;

  while (messages.length < MAX_MESSAGES_PER_THREAD_SCAN) {
    const batch = await thread.messages.fetch({
      limit: Math.min(100, MAX_MESSAGES_PER_THREAD_SCAN - messages.length),
      ...(before ? { before } : {}),
    });
    const values = [...batch.values()];
    if (values.length === 0) break;

    messages.push(...values);
    before = values[values.length - 1].id;
    if (values.length < 100) break;
  }

  return messages;
}

async function fetchAttachmentText(attachment) {
  const url = cleanString(attachment?.url || attachment?.proxyURL);
  if (!url) throw new Error('Attachment URL is missing.');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download ${attachment.name || 'attachment'} (${response.status}).`);
  }

  const size = Number(response.headers.get('content-length')) || 0;
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${attachment.name || 'Attachment'} is too large.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${attachment.name || 'Attachment'} is too large.`);
  }

  return buffer.toString('utf8');
}

function createSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function getDisplayName(message) {
  const member = message?.member || null;
  const nick = cleanString(member?.nickname || member?.nick);
  if (nick) return nick;

  const displayName = cleanString(member?.displayName);
  if (displayName) return displayName;

  if (message?.guild?.members?.fetch && message?.author?.id) {
    try {
      const fetchedMember = await message.guild.members.fetch(message.author.id);
      const fetchedNick = cleanString(fetchedMember?.nickname || fetchedMember?.nick);
      if (fetchedNick) return fetchedNick;
      const fetchedDisplayName = cleanString(fetchedMember?.displayName);
      if (fetchedDisplayName) return fetchedDisplayName;
    } catch {
      // Fall back to author data.
    }
  }

  return cleanString(message?.author?.globalName)
    || cleanString(message?.author?.username)
    || 'Discord';
}

async function loadThreadRecord(supabase, thread) {
  const { data, error } = await supabase
    .from('loot_log_bundles')
    .select('id,combined_loot_summary')
    .eq('combined_loot_summary->>discordThreadId', thread.id)
    .maybeSingle();

  if (error) throw error;
  return data ? {
    bundle_id: data.id,
    processedAttachmentIds: data.combined_loot_summary?.discordProcessedAttachmentIds || [],
  } : {
    bundle_id: null,
    processedAttachmentIds: [],
  };
}

async function saveThreadBundle(supabase, thread, bundleId) {
  const { data: bundle, error: loadError } = await supabase
    .from('loot_log_bundles')
    .select('combined_loot_summary')
    .eq('id', bundleId)
    .single();

  if (loadError) throw loadError;
  const currentSummary = bundle?.combined_loot_summary || {};
  const nextSummary = {
    ...currentSummary,
    discordChannelId: thread.parentId,
    discordProcessedAttachmentIds: Array.isArray(currentSummary.discordProcessedAttachmentIds)
      ? currentSummary.discordProcessedAttachmentIds
      : [],
    discordThreadId: thread.id,
    discordThreadName: cleanString(thread.name),
  };

  const { data, error } = await supabase
    .from('loot_log_bundles')
    .update({
      combined_loot_summary: nextSummary,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bundleId)
    .select('id,combined_loot_summary')
    .single();

  if (error) throw error;
  return {
    bundle_id: data.id,
    processedAttachmentIds: data.combined_loot_summary?.discordProcessedAttachmentIds || [],
  };
}

async function getProcessedAttachmentIds(supabase, attachmentIds, threadRecord) {
  const fromSummary = new Set((threadRecord?.processedAttachmentIds || []).map(String));
  if (!attachmentIds.length) return fromSummary;

  const { data, error } = await supabase
    .from('discord_loot_attachments')
    .select('attachment_id')
    .in('attachment_id', attachmentIds);

  if (error) return fromSummary;
  (data || []).forEach((row) => fromSummary.add(String(row.attachment_id)));
  return fromSummary;
}

async function markAttachmentProcessed(supabase, thread, job, { bundleId, logType, submittedBy }) {
  const { data: bundle, error: loadError } = await supabase
    .from('loot_log_bundles')
    .select('combined_loot_summary')
    .eq('id', bundleId)
    .single();

  if (loadError) throw loadError;
  const currentSummary = bundle?.combined_loot_summary || {};
  const processedAttachmentIds = [
    ...new Set([
      ...(Array.isArray(currentSummary.discordProcessedAttachmentIds) ? currentSummary.discordProcessedAttachmentIds : []),
      job.attachmentId,
    ].map(String).filter(Boolean)),
  ];

  const { error: summaryError } = await supabase
    .from('loot_log_bundles')
    .update({
      combined_loot_summary: {
        ...currentSummary,
        discordChannelId: thread.parentId,
        discordProcessedAttachmentIds: processedAttachmentIds,
        discordThreadId: thread.id,
        discordThreadName: cleanString(thread.name),
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', bundleId);

  if (summaryError) throw summaryError;

  const { error } = await supabase
    .from('discord_loot_attachments')
    .upsert({
      attachment_id: job.attachmentId,
      bundle_id: bundleId,
      file_name: job.fileName,
      log_type: logType,
      message_id: job.messageId,
      submitted_by: submittedBy,
      thread_id: thread.id,
    }, { onConflict: 'attachment_id' });

  if (error) {
    console.warn('[loot-discord-worker] Attachment tracking table unavailable; using bundle metadata only.');
  }
}

function isTargetThread(thread, channelId) {
  return Boolean(
    thread?.id
    && thread?.parentId === channelId
    && [
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread,
    ].includes(thread.type),
  );
}

async function prepareJob({ fetchAttachmentTextFn, job }) {
  const text = await fetchAttachmentTextFn(job.attachment);
  return {
    ...job,
    logText: text,
    logType: classifyLogText(text),
    submittedBy: await getDisplayName(job.message),
  };
}

async function processPreparedJob({ bundleId, job, submitLootLogFn, supabase, thread }) {
  if (job.logType === 'loot') {
    const result = await submitLootLogFn({
      bundleId,
      lootLogText: job.logText,
      originalFileName: cleanString(thread.name) || job.fileName,
      username: job.submittedBy,
    });
    const nextBundleId = result.bundleId || bundleId;
    await saveThreadBundle(supabase, thread, nextBundleId);
    await markAttachmentProcessed(supabase, thread, job, {
      bundleId: nextBundleId,
      logType: job.logType,
      submittedBy: job.submittedBy,
    });
    try {
      await recordActionLog({
        action: 'Loot log uploaded from Discord',
        actorName: job.submittedBy,
        details: {
          fileName: job.fileName,
          source: 'Discord thread',
          threadName: cleanString(thread.name),
        },
        supabase,
        targetId: nextBundleId,
        targetName: cleanString(thread.name) || job.fileName,
        targetType: 'loot-log',
      });
    } catch (error) {
      console.warn('[loot-discord-worker] Could not record action log.', error.message || error);
    }
    return { bundleId: nextBundleId, processed: true, type: job.logType };
  }

  return { bundleId, processed: false, type: job.logType };
}

export async function processLootLogThread({
  channelId = DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID,
  fetchAttachmentTextFn = fetchAttachmentText,
  messages = null,
  submitLootLogFn = submitLootLog,
  supabase,
  thread,
}) {
  if (!isTargetThread(thread, channelId)) {
    return { bundleId: null, processedAttachments: 0, skippedAttachments: 0 };
  }

  const threadMessages = messages || await fetchThreadMessages(thread);
  const jobs = collectLogAttachmentJobs(threadMessages);
  if (jobs.length === 0) {
    return { bundleId: null, processedAttachments: 0, skippedAttachments: 0 };
  }

  const threadRecord = await loadThreadRecord(supabase, thread);
  const processedIds = await getProcessedAttachmentIds(supabase, jobs.map((job) => job.attachmentId), threadRecord);
  const pendingJobs = jobs.filter((job) => !processedIds.has(job.attachmentId));
  const preparedJobs = [];
  let bundleId = threadRecord.bundle_id || null;
  let processedAttachments = 0;
  let skippedAttachments = 0;

  for (const job of pendingJobs) {
    preparedJobs.push(await prepareJob({ fetchAttachmentTextFn, job }));
  }

  for (const job of preparedJobs.filter((candidate) => candidate.logType === 'loot')) {
    const result = await processPreparedJob({
      bundleId,
      job,
      submitLootLogFn,
      supabase,
      thread,
    });

    bundleId = result.bundleId || bundleId;
    if (result.processed) processedAttachments += 1;
    else skippedAttachments += 1;
  }

  skippedAttachments += preparedJobs.filter((job) => job.logType === 'unknown').length;

  return { bundleId, processedAttachments, skippedAttachments };
}

async function scanActiveThreads(client, channelId, handler) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.threads?.fetchActive) return;

  const active = await channel.threads.fetchActive();
  const threads = [...(active?.threads?.values?.() || [])];
  for (const thread of threads) {
    await handler(thread);
  }
}

export function createLootLogDiscordWorker({
  channelId = process.env.DISCORD_LOOT_LOG_CHANNEL_ID || DEFAULT_LOOT_LOG_THREAD_CHANNEL_ID,
  client = null,
  supabase = null,
} = {}) {
  const botClient = client || new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.ThreadMember],
  });
  const admin = supabase || createSupabaseAdmin();

  const handleThread = async (thread) => {
    try {
      const result = await processLootLogThread({
        channelId,
        supabase: admin,
        thread,
      });
      if (result.processedAttachments > 0) {
        console.log(`[loot-discord-worker] ${thread.id}: processed ${result.processedAttachments} attachment(s).`);
      }
    } catch (error) {
      console.error(`[loot-discord-worker] ${thread?.id || 'unknown thread'}:`, error);
    }
  };

  botClient.once('ready', async () => {
    console.log(`[loot-discord-worker] Logged in as ${botClient.user?.tag || botClient.user?.id}.`);
    try {
      await scanActiveThreads(botClient, channelId, handleThread);
    } catch (error) {
      console.error('[loot-discord-worker] Active thread scan failed:', error);
    }
  });

  botClient.on('threadCreate', handleThread);
  botClient.on('messageCreate', async (message) => {
    const thread = message?.channel;
    if (!isTargetThread(thread, channelId)) return;
    if (!message.attachments || message.attachments.size === 0) return;
    await handleThread(thread);
  });

  return {
    client: botClient,
    async start(token = process.env.DISCORD_BOT_TOKEN) {
      if (!token) throw new Error('DISCORD_BOT_TOKEN is required.');
      await botClient.login(token);
    },
    async stop() {
      botClient.destroy();
    },
  };
}

async function main() {
  const worker = createLootLogDiscordWorker();
  const shutdown = async (signal) => {
    console.log(`[loot-discord-worker] ${signal} received, shutting down.`);
    await worker.stop();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await worker.start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[loot-discord-worker] Fatal error:', error);
    process.exit(1);
  });
}
