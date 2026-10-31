import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const sharedDir = fileURLToPath(new URL('../shared', import.meta.url));
const engineDir = fileURLToPath(new URL('../engine/src', import.meta.url));

export default defineConfig({
  root: webRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom', 'pixi.js', '@pixi/react', 'gsap', 'three'],
    alias: { '@shared': sharedDir, '@engine': engineDir },
  },
  server: {
    port: Number(process.env.DIRECTOR_WEB_PORT ?? 5173),
    strictPort: !!process.env.DIRECTOR_WEB_PORT,
    fs: { allow: ['..'] },
    proxy: { '/api': { target: process.env.DIRECTOR_API_URL ?? 'http://localhost:8787', changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
