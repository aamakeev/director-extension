import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        settings: resolve(__dirname, 'settings.html'),
        menu: resolve(__dirname, 'menu.html'),
        overlay: resolve(__dirname, 'overlay.html'),
        background: resolve(__dirname, 'background.html')
      }
    }
  }
});
