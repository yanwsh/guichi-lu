import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(dir, 'index.html'),
        spike3d: resolve(dir, '3d.html'),
      },
    },
  },
});
