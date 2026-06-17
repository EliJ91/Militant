import { defineConfig } from 'vite';
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

export default defineConfig({
  base: './',
  plugins: [react(), albionItemProxy()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
});
