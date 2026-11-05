import { defineConfig, devices } from '@playwright/test'

// Smoke tests: play through the main flows of the built app in Chrome, Firefox and WebKit (Safari's engine).
// Chrome is the one already installed on the machine; Firefox and WebKit are Playwright's own builds
// (`npx playwright install firefox webkit`).

// Playwright's Firefox doesn't start on macOS 27 ("Could not find profile folder"), so on a computer it
// runs only when asked (`SMOKE_FIREFOX=1 npm run test:smoke`). GitHub Actions (CI) always runs it.
const firefox = Boolean(process.env.CI || process.env.SMOKE_FIREFOX)
const size = { viewport: { width: 1300, height: 900 } }

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // One at a time: some tests open two tabs of the app and check how they affect each other.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4790',
    // The service worker (offline copy) would serve the app's files itself, so tests couldn't see or block
    // its requests. Off by default; the offline app tests (e2e/offline.spec.ts) turn it on.
    serviceWorkers: 'block',
    // When a test fails, keep a screenshot and a step-by-step trace (open with `npx playwright show-trace`).
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome', ...size } },
    ...(firefox ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'], ...size } }] : []),
    { name: 'webkit', use: { ...devices['Desktop Safari'], ...size } },
  ],
  // Always a fresh build, on a port of its own, so the tests never run against an old build.
  webServer: {
    command: 'npm run build && npx vite preview --port 4790 --strictPort',
    url: 'http://localhost:4790',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
