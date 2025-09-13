const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['line']
  ],
  use: {
    baseURL: 'http://localhost:3001',
    extraHTTPHeaders: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'API Tests',
      testMatch: '**/*.spec.js',
    },
  ],
  outputDir: 'test-results/',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  globalSetup: require.resolve('./tests/setup.js'),
  globalTeardown: require.resolve('./tests/teardown.js'),
  webServer: {
    command: 'npm run start-server',
    url: 'http://localhost:3001/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});