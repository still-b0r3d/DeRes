import { defineConfig, devices } from '@playwright/test'

// End-to-end checks against the dev server. The server command runs node
// directly (not through pnpm), which also works on Windows; a server already
// running on the port is reused.
//
//   pnpm test:e2e                      # Chromium
//   pnpm test:e2e --project=webkit     # Safari's engine
//   pnpm test:e2e --project=firefox
//
// E2E_PORT picks another port, so a second copy of the repository (a git
// worktree) can run its own server instead of reusing the first one's.
const PORT = Number(process.env.E2E_PORT ?? 5190)

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    acceptDownloads: true
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
    timeout: 60_000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ]
})
