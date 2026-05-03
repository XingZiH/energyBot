import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 配置（任务 28）。
 *
 * 设计要点：
 * - fullyParallel=false / workers=1：E2E 共享同一后端数据库（/energy-rental/ui-config），
 *   场景 6 会写真实数据，必须串行以保证 beforeEach 的清空操作不互相冲突。
 * - 只配置 chromium 项目：本项目只要求回归核心链路，不测跨浏览器兼容性；
 *   CI 时间和维护成本是首要考量。
 * - webServer 只自启 UI dev server（port 4201，来自 ui/package.json 的 ng serve）；
 *   不自启 nest-api 以避免强耦合（nest-api 需要 Postgres 运行中，启动时间不可控）。
 *   开发者需手动在另一 terminal 运行 `cd nest-api && npm run start:dev`。
 *   详见 e2e/README.md 的 prerequisites 部分。
 * - reuseExistingServer（本地） + CI 下始终全新启动，减少"上次挂了没关"的坑。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60 * 1000,
  expect: { timeout: 10 * 1000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list']
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4201',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-testid',
    actionTimeout: 10 * 1000,
    navigationTimeout: 30 * 1000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:4201',
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
    stdout: 'ignore',
    stderr: 'pipe'
  }
});
