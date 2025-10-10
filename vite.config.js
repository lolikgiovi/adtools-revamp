import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: true,
  },
  resolve: {
    alias: {
      '@': '/app',
    },
  },
});