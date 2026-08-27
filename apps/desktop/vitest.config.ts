import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      'electron-log/main': fileURLToPath(
        new URL('./tests/support/electron/electron-log-main-stub.ts', import.meta.url),
      ),
    },
  },
  test: {
    clearMocks: true,
    environment: 'node',
    exclude: ['qualifications/**', 'benchmarks/**', 'repro/**', 'scripts/**'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    server: {
      deps: {
        inline: [/@react-spectrum\/s2/],
      },
    },
    unstubEnvs: true,
    unstubGlobals: true,
  },
})
