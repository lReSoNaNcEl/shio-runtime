import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import macros from 'unplugin-parcel-macros'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron'],
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          browserReactiveTrackerWorker: resolve(
            __dirname,
            'src/main/browser-control/computer-use/browserReactiveTrackerWorker.ts',
          ),
        },
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron'],
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay.ts'),
        },
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    // macros() MUST run before react() so the S2 style() macro is evaluated at build time
    plugins: [macros.vite(), react()],
    optimizeDeps: {
      // Dependency scanning runs before macro transforms; style is a Node-only build-time import.
      exclude: ['@react-spectrum/s2/style'],
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})
