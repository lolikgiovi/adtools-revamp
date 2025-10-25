import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    open: true,
    proxy: {
      '/register': 'http://localhost:8787',
      '/analytics': 'http://localhost:8787',
      '/whitelist.json': 'http://localhost:8787',
    },
  },
  resolve: {
    alias: {
      '@': '/app',
    },
  },
});