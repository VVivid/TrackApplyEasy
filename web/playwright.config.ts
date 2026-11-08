import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'https://127.0.0.1:8099', ignoreHTTPSErrors: true, trace: 'retain-on-failure' },
  webServer: {
    command:
      'cd .. && TRACK_BROWSER_FIXTURE=1 GOCACHE="$PWD/.cache/go-build" go test ./internal/httpapp -run TestBrowserFixture -count=1 -timeout=10m -v',
    url: 'https://127.0.0.1:8099',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
