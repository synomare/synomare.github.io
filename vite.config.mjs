import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve('notes-admin'),
  base: '/admin/notes/',
  plugins: [react()],
  build: {
    outDir: path.resolve('admin/notes'),
    emptyOutDir: true,
    sourcemap: true
  }
});
