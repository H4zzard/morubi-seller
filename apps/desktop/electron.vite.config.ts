import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@morubi/validation'] })],
    build: { sourcemap: true }
  },
  preload: {
    build: {
      sourcemap: true,
      rollupOptions: { output: { format: 'cjs' } }
    }
  },
  renderer: {
    resolve: {
      alias: { '@renderer': resolve('src/renderer/src') }
    },
    plugins: [react(), tailwindcss()],
    build: { sourcemap: true }
  }
});
