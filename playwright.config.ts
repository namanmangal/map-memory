import { defineConfig } from '@playwright/test'

// Smoke tests: play through the main flows of the built app in Chrome.
// Uses the Chrome already installed on this machine, so no browser download is needed.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // One at a time: some tests open two tabs of the app and check how they affect each other.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4790',
    channel: 'chrome',
    viewport: { width: 1300, height: 900 },
    // When a test fails, keep a screenshot and a step-by-step trace (open with `npx playwright show-trace`).
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // Always a fresh build, on a port of its own, so the tests never run against an old build.
  webServer: {
    command: 'npm run build && npx vite preview --port 4790 --strictPort',
    url: 'http://localhost:4790',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
