import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173',
    browserName: 'chromium',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command:
            'npm run dev --workspace backend-do -- --local --port 8787 --show-interactive-dev-session false',
          url: 'http://127.0.0.1:8787/api/just-one/banks',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
        {
          command:
            'npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173 --strictPort',
          url: 'http://127.0.0.1:5173',
          reuseExistingServer: !process.env.CI,
          env: { VITE_BACKEND_URL: 'http://127.0.0.1:8787' },
          timeout: 60_000,
        },
      ],
});
