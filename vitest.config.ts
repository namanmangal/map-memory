import { defineConfig } from 'vitest/config'

// Unit tests: fast checks of the app's logic, next to the code as `src/**/*.test.ts`.
// The smoke tests in e2e/ run the real app in Chrome instead (see playwright.config.ts).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
