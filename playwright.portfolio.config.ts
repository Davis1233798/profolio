import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: ['portfolio-experience.spec.ts', 'portfolio-performance.spec.ts', 'station-dataset-pagination.spec.ts'], timeout: 45_000, retries: 1,
  use: { baseURL: process.env.PORTFOLIO_TEST_URL || 'http://127.0.0.1:8090', viewport: { width: 1366, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'on', launchOptions: { args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  outputDir: 'outputs/browser/results', reporter: [['list']],
});
