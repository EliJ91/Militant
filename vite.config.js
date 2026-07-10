import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function albionItemProxy() {
  async function proxyItemImage(req, res) {
    try {
      const target = new URL(req.url.replace(/^\/+/, ''), 'https://render.albiononline.com/v1/item/');
      const response = await fetch(target);

      if (!response.ok) {
        res.statusCode = response.status;
        res.end();
        return;
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
      const buffer = Buffer.from(await response.arrayBuffer());
      res.end(buffer);
    } catch {
      res.statusCode = 502;
      res.end();
    }
  }

  return {
    name: 'albion-item-proxy',
    configureServer(server) {
      server.middlewares.use('/item-image/', proxyItemImage);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/item-image/', proxyItemImage);
    },
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE,GET,PATCH,POST,OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function lootLogApi() {
  async function handleLootLogs(req, res) {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === 'GET') {
      try {
        const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        const bundleId = requestUrl.searchParams.get('bundleId');
        const { getLootLogBundle, listLootLogBundles } = await import('./src/server/supabaseLootLogs.js');
        const result = bundleId
          ? await getLootLogBundle(bundleId)
          : await listLootLogBundles();
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { error: error.message || 'Could not load loot logs.' });
      }
      return;
    }

    if (req.method === 'DELETE') {
      try {
        const { deleteExpiredLootLogBundles, deleteLootLogBundle } = await import('./src/server/supabaseLootLogs.js');
        const body = await readJsonBody(req);
        const result = body.deleteExpired
          ? await deleteExpiredLootLogBundles()
          : await deleteLootLogBundle(body.bundleId);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { error: error.message || 'Could not delete loot log.' });
      }
      return;
    }

    if (req.method === 'PATCH') {
      try {
        const { updateLootLogBundle } = await import('./src/server/supabaseLootLogs.js');
        const body = await readJsonBody(req);
        const result = await updateLootLogBundle({
          bundleId: body.bundleId,
          ctaHour: body.ctaHour,
          dateUtc: body.dateUtc,
          fileNames: body.fileNames,
          submitters: body.submitters,
        });
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { error: error.message || 'Could not update loot log.' });
      }
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }

    try {
      const {
        checkLootLogDeath,
        clearLootLogDeath,
        submitChestLog,
        submitLootLog,
      } = await import('./src/server/supabaseLootLogs.js');
      const body = await readJsonBody(req);
      const result = body.action === 'death-check'
        ? await checkLootLogDeath({
          bundleId: body.bundleId,
          keptItems: body.keptItems,
          player: body.player,
        })
        : body.action === 'clear-death-check'
        ? await clearLootLogDeath({
          bundleId: body.bundleId,
          player: body.player,
        })
        : body.action === 'chest'
        ? await submitChestLog({
          bundleId: body.bundleId,
          chestLogText: body.chestLogText || body.chestText || body.text,
          username: body.username,
        })
        : await submitLootLog({
          bundleId: body.bundleId || null,
          lootLogText: body.lootLogText || body.lootText || body.text,
          originalFileName: body.originalFileName
            || body.original_filename
            || body.lootFileName
            || body.logFileName
            || body.fileName
            || body.filename
            || body.file_name
            || req.headers['x-file-name']
            || req.headers['x-filename'],
          username: body.username,
        });

      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Could not submit loot log.' });
    }
  }

  return {
    name: 'loot-log-api',
    configureServer(server) {
      server.middlewares.use('/api/loot-logs', handleLootLogs);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/loot-logs', handleLootLogs);
    },
  };
}

function siphonedEnergyApi() {
  async function handleSiphonedEnergy(req, res) {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }

    try {
      const {
        importSiphonedEnergyTransactions,
        listSiphonedEnergyGuildMembers,
        listSiphonedEnergyTransactions,
        purgeSiphonedEnergyTransactions,
        updateSiphonedEnergyPlayerStar,
      } = await import('./src/server/supabaseSiphonedEnergy.js');

      if (req.method === 'GET') {
        const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        const result = requestUrl.searchParams.get('resource') === 'members'
          ? await listSiphonedEnergyGuildMembers()
          : await listSiphonedEnergyTransactions();
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        sendJson(res, 200, await importSiphonedEnergyTransactions(body.logText));
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readJsonBody(req);
        sendJson(res, 200, await updateSiphonedEnergyPlayerStar({
          player: body.player,
          starred: body.starred,
        }));
        return;
      }

      if (req.method === 'DELETE') {
        const body = await readJsonBody(req);
        sendJson(res, 200, await purgeSiphonedEnergyTransactions(body.date));
        return;
      }

      sendJson(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Could not update Siphoned Energy transactions.' });
    }
  }

  return {
    name: 'siphoned-energy-api',
    configureServer(server) {
      server.middlewares.use('/api/siphoned-energy', handleSiphonedEnergy);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/siphoned-energy', handleSiphonedEnergy);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  process.env.SUPABASE_URL ||= env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= env.SUPABASE_SERVICE_ROLE_KEY;

  return {
    base: './',
    plugins: [react(), albionItemProxy(), lootLogApi(), siphonedEnergyApi()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.js',
    },
  };
});
