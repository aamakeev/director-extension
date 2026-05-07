import { resolve } from 'path';

import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig(({ mode }) => {
  const isMocks = mode === 'mocks';

  return {
    base: './',
    server: {
      cors: true,
      allowedHosts: true,
      open: isMocks ? '/mocks.html' : false,
    },
    resolve: isMocks
      ? {
          alias: {
            '@stripchatdev/ext-helper': resolve(
              __dirname,
              'src/mocks/extHelperMock.ts',
            ),
          },
        }
      : undefined,
    build: {
      outDir: isMocks ? 'dist-mocks' : 'dist',
      rollupOptions: {
        input: (isMocks
          ? { mocks: resolve(__dirname, 'mocks.html') }
          : {
              mainGameFun: resolve(__dirname, 'mainGameFun.html'),
              backgroundModel: resolve(__dirname, 'backgroundModel.html'),
              backgroundViewer: resolve(__dirname, 'backgroundViewer.html'),
              rightOverlay: resolve(__dirname, 'rightOverlay.html'),
              settings: resolve(__dirname, 'settings.html'),
            }) as Record<string, string>,
      },
    },
    plugins: [preact()],
  };
});
