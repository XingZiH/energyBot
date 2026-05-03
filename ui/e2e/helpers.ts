import { Page, expect } from '@playwright/test';

/**
 * 测试账号常量。
 *
 * 来源：ui/README.md 第 167 行——开发环境默认账号。
 * admin 密码 123456 是 ng-antd-admin-db.sql 里预置的 argon2 哈希对应明文。
 *
 * 若项目后续改用自定义账号，改这里即可；也可通过环境变量
 * `E2E_USERNAME` / `E2E_PASSWORD` 覆盖（便于 CI 注入测试专用账号）。
 */
export const E2E_USERNAME = process.env.E2E_USERNAME || 'admin';
export const E2E_PASSWORD = process.env.E2E_PASSWORD || '123456';

/**
 * 机器人配置页面完整路径。
 *
 * 注意：路由位于 DefaultLayout 之下（`/default/energy-rental/bot-config`），
 * 而非旧计划书里写的 `/pages/energy-rental/agent-bot-config`——以 energy-rental-routing.ts
 * 的实际定义为准（path: 'bot-config'）。
 */
export const BOT_CONFIG_URL = '/default/energy-rental/bot-config';

/**
 * 通过登录表单完成登录，等待跳转到 dashboard。
 *
 * 实现选择：走真实登录表单而非直接塞 sessionStorage token。
 * 原因：
 * 1. 不用猜 JWT 负载结构（后端可能带签名校验或 payload 字段变化）。
 * 2. 走 loginIn 路径能自动填充 UserInfoService 的用户信息，避免后续 guard 拒绝。
 * 3. 登录流程本身就是冒烟测试之一——若登录挂了，别的 E2E 也没意义。
 *
 * 代价：每个 test 都要走一遍登录（~1s）。8 个场景 ≈ 8s，可接受。
 */
export async function loginAndGoToBotConfig(page: Page): Promise<void> {
  await page.goto('/login/login-form');

  // login-form 里 userName 是 formControlName，input 定位只能靠 placeholder 或 nz-input 的宽松匹配
  await page.locator('input[formControlName="userName"]').first().fill(E2E_USERNAME);
  await page.locator('input[formControlName="password"]').first().fill(E2E_PASSWORD);

  // 登录按钮文本"登 录"（中间有全角/空格），用 role 按钮 + 文本模糊匹配
  await page.locator('button.login-form-button').click();

  // 登录成功跳转 /default/energy-rental/dashboard（见 login-form.component.ts:68）
  await page.waitForURL(/\/default\//, { timeout: 15000 });

  // 再跳转到 bot-config
  await page.goto(BOT_CONFIG_URL);

  // 确认父容器已渲染
  await expect(page.locator('app-energy-rental-agent-bot-config')).toBeVisible({ timeout: 15000 });
}

/**
 * 切到"菜单设计"tab 并等待 menu-designer 渲染。
 *
 * 父组件用 nz-tabs，tab 激活后内容才会挂载；通过文本"菜单设计"定位 tab 标题。
 */
export async function switchToMenuDesignTab(page: Page): Promise<void> {
  // nz-tabs 的 tab title 是 role="tab"
  await page.getByRole('tab', { name: '菜单设计' }).click();
  await expect(page.locator('app-menu-designer')).toBeVisible({ timeout: 10000 });
}

/**
 * 切到"消息模板"tab 并等待 message-template-editor 渲染。
 */
export async function switchToMessageTemplateTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '消息模板' }).click();
  await expect(page.locator('app-message-template-editor')).toBeVisible({ timeout: 10000 });
}
