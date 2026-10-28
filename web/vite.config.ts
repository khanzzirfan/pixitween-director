import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const sharedDir = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'pixi.js', '@pixi/react', 'gsap', 'three'],
    alias: { '@shared': sharedDir },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
