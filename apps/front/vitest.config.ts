import { fileURLToPath } from 'node:url'
import { defineVitestConfig } from '@nuxt/test-utils/config'

// @nuxt/test-utils is wired in so individual specs can opt into the Nuxt
// runtime environment with `// @vitest-environment nuxt`. The default
// environment is `node` — the current suites (locale-key parity + the pure
// locale-resolution logic) need no DOM or Nuxt context, so they stay fast.
export default defineVitestConfig({
  resolve: {
    alias: {
      '~~': fileURLToPath(new URL('./', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '@': fileURLToPath(new URL('./app', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.{test,spec}.ts']
  }
})
