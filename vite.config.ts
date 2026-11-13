import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import sirv from 'sirv';
import { defineConfig, type Plugin } from 'vite';

/** Serves the extracted game assets (kept outside the repository) under /data during development and preview. */
function gameAssets(): Plugin {
  const dir = resolve(process.env.PW_ASSETS_DIR ?? 'assets');
  const mount = (middlewares: { use: (path: string, handler: ReturnType<typeof sirv>) => void }) => {
    if (existsSync(dir)) middlewares.use('/data', sirv(dir, { dev: true }));
  };
  return {
    name: 'game-assets',
    configureServer: (server) => mount(server.middlewares),
    configurePreviewServer: (server) => mount(server.middlewares),
  };
}

export default defineConfig({
  plugins: [react(), gameAssets()],
  server: { host: '0.0.0.0', port: 47833, strictPort: true },
  preview: { host: '0.0.0.0', port: 47831, strictPort: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
});
