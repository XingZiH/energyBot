# Bot Designer E2E（任务 28）

Playwright E2E 套件，覆盖 `/default/energy-rental/bot-config` 页面的关键链路：登录 → 菜单设计 → 消息模板。

> **⚠️ 当前状态**：基础设施已就绪（config/helpers/8 场景 spec/README 完整），但基线 `3f0f7309` 的 UI 无法编译（见[限制 0](#0-基线-ui-编译错误优先级最高)），实际 E2E 运行被阻塞。修复编译错误后可立即跑通。

## 前置条件（Prerequisites）

E2E 是**真实端到端**——测试会走真实 HTTP 到后端，命中真实数据库。运行前需确保：

1. **Postgres 已启动**（或 docker-compose up -d）
2. **nest-api 已启动**：
   ```bash
   cd nest-api
   npm run start:dev
   ```
   后端默认监听 `3000`，前端通过代理转发。若后端没起，`saveUiConfig` 会走错误分支，场景 8 会失败。
3. **数据库里存在 admin 用户**：
   - 用户名 `admin`，密码 `123456`（`ng-antd-admin-db.sql` 预置）
   - 如用其他账号，用环境变量覆盖：`E2E_USERNAME=xxx E2E_PASSWORD=yyy npm run e2e`

## 运行

```bash
cd ui

# 全量跑（webServer 配置会自启 `npm start`，端口 4201）
npm run e2e

# UI 模式——可视化看失败、重跑单个用例
npm run e2e:ui

# 有头模式——看真实浏览器执行
npm run e2e:headed

# 单独跑一个场景
npm run e2e -- -g "场景 6"

# 保留 trace（失败时自动开 trace viewer）
npx playwright show-trace playwright-report/trace.zip
```

测试报告默认输出到 `ui/playwright-report/`，HTML 不自动打开；可 `npx playwright show-report` 手动查看。

## 8 核心场景

| # | 名称 | 状态 | 备注 |
|---|------|------|------|
| 1 | 菜单设计 tab 四栏渲染 | 稳定 | 仅校验 DOM 挂载 |
| 2 | palette → canvas 拖拽 | **不稳定** | CDK drag 在 Playwright 下不可靠；见下方限制 |
| 3 | submenu 进入子层 | 依赖前置数据 | 若 canvas 无 submenu 按钮自动 skip |
| 4 | 深度限制提示 | **skip** | 多步前置成本高；单元测试已覆盖 `menu-tree.service.spec.ts` |
| 5 | PropertyPanel 出现 | 依赖前置数据 | 若 canvas 无按钮 skip |
| 6 | 消息模板编辑 + 预览 | 稳定 | 只要 `app-template-preview` 挂载 |
| 7 | 变量徽章点击插入 | 稳定 | 关键路径，必过 |
| 8 | 保存 toast（操作成功） | 依赖后端 | 后端没起会 fail（假阴性，非 bug） |

## 已知限制

### 0. 基线 UI 编译错误（**优先级最高**）

**截至基线 commit `3f0f7309`，UI 无法通过 `ng build` / `ng serve`！**

错误位置：`ui/src/app/pages/energy-rental/agent-bot-config/designer/menu-designer/menu-canvas/menu-canvas.component.html`
- Line 19/34/95：`(cdkDropListDropped)="onDropToNewRow($event)"` 类型不匹配
- 原因：`[cdkDropListData]="row.buttons"` 让 CDK 推断为 `CdkDragDrop<MenuButton[]>`，
  但方法签名声明为 `CdkDragDrop<unknown>`，双向泛型不兼容。

**在修复此问题之前，所有 E2E 都无法实际运行**——Playwright 的 `webServer` 会因 UI 启动失败而超时。

修复方案（二选一）：
1. 改方法签名：`onDropToRow(event: CdkDragDrop<MenuButton[] | null>, ...)`
2. 模板里断言：`[cdkDropListData]="$any(row.buttons)"`

此修复不属于任务 28 范围，独立建 issue / commit。

### 1. CDK drag-drop 在 Playwright 下不稳定

Angular CDK 的 drag-drop 底层用浏览器原生 `drag` 事件（部分路径）和鼠标事件（另一些路径）。Playwright 的 `page.mouse.down/move/up` 只模拟鼠标事件，有时不足以触发 CDK 的 drop zone 检测。

**症状**：场景 2 可能失败且没有错误信息——拖拽"看起来"发生了，但 canvas 没更新。

**解决方案**：
- **短期**：在 commit 说明里记录；手工验证拖拽功能
- **长期**：考虑给 palette/canvas 加 `data-testid` + 提供"非拖拽"的备用添加路径（比如点击 palette 卡片直接追加到末行），E2E 改走该路径

### 2. 场景 3/5 依赖前置数据

这两个场景要求 canvas 已经有菜单数据。**如果测试库是干净的**（没有已存在的 ui-config），场景 3 会 skip、场景 5 如果场景 2 也失败则 skip。

**推荐**：先在浏览器里手工拖两个按钮 + 1 个 submenu 按钮再跑 E2E，命中率更高。或后续引入 fixture SQL 播种数据。

### 3. 场景 8 对后端强依赖

没有后端运行时：
- 拦截器会把 4xx 发到 `message.error`，看不到"操作成功"
- Playwright 就会超时失败

**验证前**务必确保 `curl http://localhost:3000/api/energy-rental/ui-config` 能返回 2xx（或 4xx 带 body，不是连接拒绝）。

## 架构选择

- **fullyParallel=false / workers=1**：E2E 共享同一后端数据库，场景 6/7/8 会写真实数据。并行会产生乐观锁冲突（If-Unmodified-Since）。
- **webServer 只启 UI**：nest-api 依赖 Postgres，启动时间不可控且失败场景多。开发者手动启后端成本远低于在 webServer 里串行管理多服务。
- **只测 Chromium**：项目不要求跨浏览器兼容，维护 firefox/webkit 性价比低。
- **testIdAttribute: 'data-testid'**：留个口子，未来给关键节点加 `data-testid` 时可以直接 `page.getByTestId('xxx')`。

## 文件

```
ui/
├── playwright.config.ts      # 配置（webServer / workers=1 / testDir=./e2e）
└── e2e/
    ├── README.md             # 本文档
    ├── helpers.ts            # 登录 + 导航 + 切 tab 公共函数
    └── bot-designer.spec.ts  # 8 场景
```
