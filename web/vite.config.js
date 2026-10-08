import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, Vite serves the UI on :5173 and forwards API calls to the Flask backend on :5055.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:5055' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
