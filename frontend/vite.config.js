// Vite builds two pages: the public app (index.html) and the admin portal (admin/index.html).
// In development, API calls, photos and the install manifest are forwarded to the backend.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const backend = process.env.BACKEND_URL || 'http://localhost:8080';

// /admin/... addresses are the admin portal's own pages (like on Vercel, see vercel.json).
const adminPages = (req, res, next) => {
  if (/^\/admin(\/[^.]*)?$/.test(req.url.split('?')[0])) req.url = '/admin/index.html';
  next();
};
const adminSpa = { name: 'admin-spa', configureServer: (s) => { s.middlewares.use(adminPages); }, configurePreviewServer: (s) => { s.middlewares.use(adminPages); } };

export default defineConfig({
  plugins: [react(), adminSpa],
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin/index.html') },
    },
  },
  server: {
    port: 5173,
    host: true, // reachable from a phone on the same Wi-Fi
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/uploads': { target: backend, changeOrigin: true },
      '/manifest.webmanifest': { target: backend, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/uploads': { target: backend, changeOrigin: true },
      '/manifest.webmanifest': { target: backend, changeOrigin: true },
    },
  },
});
