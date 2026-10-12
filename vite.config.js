import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: {
    target: ['chrome79', 'safari13'],
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/renderer/index.html'),
        mobile: resolve(__dirname, 'src/renderer/mobile.html')
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
