# Bot WebUI 可视化设计器 · 设计文档

> **状态**：终稿已获批（2026-05-02）
> **蓝本**：`/Users/xingzihua/Desktop/Project-TG/teledashFront/src/views/tgbot/designer/`
> **目标交付**：完整版（对齐蓝本能力）

---

## 1. 背景与目标

### 1.1 当前痛点

`go-bot/internal/telegram/bot.go` 已有基础 designer 数据结构（`BotDesignerConfig`/`DesignerMenuRow`/`DesignerMenuButton`），但存在以下缺陷：

1. **无嵌套 submenu**：`MenuRows` 只支持单层
2. **action 枚举不完整**：当前仅 `package`/`address`/`wallet`/`text`/`url`/`start`/`command` 共 7 种，缺少订单查询、套餐组等
3. **套餐绑定僵化**：只能绑定单个 `packageId`，无法按组动态展开
4. **消息模板能力缺失**：`parseMessageConfig` 只是 `JSON.Parse` 成 map，不支持 `{var}` 占位符渲染
5. **前端无可视化工具**：`agent-bot-config` 组件只能编辑纯 JSON，体验极差

### 1.2 目标

- 提供对标 teledashFront 的 WebUI 可视化设计器（菜单 + 消息模板）
- 三端（Angular UI / NestJS API / Go bot）共享数据契约
- 跟随系统明暗主题（已是硬性约束）
- 支持热加载（改配置后下一条 TG 消息即生效，无需重启）

### 1.3 非目标

- ❌ 不做 A/B 测试、多版本灰度
- ❌ 不做配置版本历史（下期可加）
- ❌ 不兼容现有 v1 数据（已决策：清空）

---

## 2. 范围

### 2.1 前端

- 升级 `ui/src/app/pages/energy-rental/agent-bot-config/` 组件（加 nz-tabs）
- 新增 `designer/` 子目录（菜单设计器 + 消息模板设计器）
- 新增依赖：`@angular/cdk`

### 2.2 后端

- 新增 DTO：`nest-api/src/modules/energy-rental/dto/ui-config.dto.ts`
- 新增 service：`nest-api/src/modules/energy-rental/services/ui-config.service.ts`
- 新增 3 个 API 端点（GET/PUT/PUT?dryRun）

### 2.3 Bot 端

- 重写 `parseMenuRows`/`parseMessageConfig` 支持嵌套 + 枚举校验
- 新增 `templateRender` 模板引擎
- 新增 Inline Keyboard submenu 下钻处理
- 新增 9 种 action 的分发逻辑

### 2.4 数据

- DB schema **不变**（`menu_config`/`message_config`/`welcome_text` 字段已存在）
- 部署时执行 SQL 清空旧数据

---

## 3. 数据契约（三端共享）

### 3.1 TypeScript 定义（前端）

```typescript
// ui/src/app/pages/energy-rental/agent-bot-config/designer/types.ts

export enum ButtonAction {
  URL = 'url',                                   // 打开外链
  TEXT = 'text',                                 // 回复纯文本
  COMMAND = 'command',                           // 触发 Bot 命令
  START = 'start',                               // 回到首页
  SUBMENU = 'submenu',                           // 展开子菜单
  ENERGY_PACKAGE_GROUP = 'energy_package_group', // 展示套餐组
  ADDRESS_MANAGE = 'address_manage',             // 地址管理
  WALLET_QUERY = 'wallet_query',                 // 钱包查询
  ORDERS = 'orders',                             // 我的订单
}

export interface ButtonStyle {
  bgColor?: string;
  textColor?: string;
}

export interface PackageGroup {
  packageIds: number[];
  sortBy: 'price_asc' | 'price_desc' | 'manual';
  textTemplate: string; // 如 "{name} - {price} TRX"
}

export interface MenuButton {
  id: string;
  text: string;
  action: ButtonAction;
  style?: ButtonStyle;
  url?: string;
  message?: string;
  command?: string;
  submenu?: MenuRow[];        // action === 'submenu'
  packageGroup?: PackageGroup; // action === 'energy_package_group'
}

export interface MenuRow {
  id: string;
  buttons: MenuButton[];      // 每行最多 4 个
}

export interface MessageTemplates {
  welcome: string;
  orderCreated: string;
  payPending: string;
  paySuccess: string;
  payFailed: string;
  addressInvalid: string;
  unknownCommand: string;
  packageUnavailable: string;
  walletQueryResult: string;
}

export interface BotDesignerConfig {
  welcomeText: string;
  menuConfig: MenuRow[];
  messageConfig: MessageTemplates;
}
```

### 3.2 Go 定义（bot 端）

```go
// go-bot/internal/telegram/designer.go（新文件）

type ButtonAction string

const (
    ActionURL                ButtonAction = "url"
    ActionText               ButtonAction = "text"
    ActionCommand            ButtonAction = "command"
    ActionStart              ButtonAction = "start"
    ActionSubmenu            ButtonAction = "submenu"
    ActionEnergyPackageGroup ButtonAction = "energy_package_group"
    ActionAddressManage      ButtonAction = "address_manage"
    ActionWalletQuery        ButtonAction = "wallet_query"
    ActionOrders             ButtonAction = "orders"
)

type BotDesignerConfig struct {
    WelcomeText   string
    MessageConfig MessageTemplates
    MenuRows      []DesignerMenuRow
}

type MessageTemplates struct {
    Welcome            string `json:"welcome"`
    OrderCreated       string `json:"orderCreated"`
    PayPending         string `json:"payPending"`
    PaySuccess         string `json:"paySuccess"`
    PayFailed          string `json:"payFailed"`
    AddressInvalid     string `json:"addressInvalid"`
    UnknownCommand     string `json:"unknownCommand"`
    PackageUnavailable string `json:"packageUnavailable"`
    WalletQueryResult  string `json:"walletQueryResult"`
}

type DesignerMenuRow struct {
    ID      string               `json:"id"`
    Buttons []DesignerMenuButton `json:"buttons"`
}

type DesignerMenuButton struct {
    ID           string              `json:"id"`
    Text         string              `json:"text"`
    Action       ButtonAction        `json:"action"`
    Style        *ButtonStyle        `json:"style,omitempty"`
    URL          string              `json:"url,omitempty"`
    Message      string              `json:"message,omitempty"`
    Command      string              `json:"command,omitempty"`
    Submenu      []DesignerMenuRow   `json:"submenu,omitempty"`
    PackageGroup *PackageGroupConfig `json:"packageGroup,omitempty"`
}

type PackageGroupConfig struct {
    PackageIDs   []int  `json:"packageIds"`
    SortBy       string `json:"sortBy"`
    TextTemplate string `json:"textTemplate"`
}

type ButtonStyle struct {
    BgColor   string `json:"bgColor,omitempty"`
    TextColor string `json:"textColor,omitempty"`
}
```

### 3.3 约束

| 约束项 | 值 |
|---|---|
| 菜单最大深度 | 3 层 |
| 每行最大按钮数 | 4 |
| 每菜单最大行数 | 8 |
| 按钮文本最大长度 | 64 字符（TG 限制） |
| 模板变量格式 | `{varName}`（camelCase） |

---

## 4. 交互设计

### 4.1 UI 整体布局

```
┌─────────────────────────────────────────────────────────────┐
│ [面包屑: 首页 › 机器人配置 › 菜单设计器]      [预览] [保存]  │
├──────────┬────────────────────────────────┬─────────────────┤
│          │                                │                 │
│ 组件板   │        中央画布                │  属性面板/预览  │
│          │                                │                 │
│ - 基础   │   [🔙 返回上一级]              │  当前选中按钮：│
│   · URL  │   ┌────────────────────────┐   │  ┌───────────┐ │
│   · 文本 │   │ 💎 购买能量  📦 订单  │   │  │ 文本      │ │
│   · 命令 │   └────────────────────────┘   │  │ Action ▼  │ │
│ - 业务   │   ┌────────────────────────┐   │  │ (动态字段)│ │
│   · 套餐 │   │ 👛 钱包      📍 地址  │   │  │ 样式      │ │
│   · 订单 │   └────────────────────────┘   │  └───────────┘ │
│   · 钱包 │                                │                 │
│   · 地址 │   面包屑: 根 › 购买能量        │  [Telegram 预览]│
│ - 结构   │                                │  ┌───────────┐ │
│   · 子菜 │                                │  │ 💎 购买能量│ │
│          │                                │  │ 📦 订单    │ │
│          │                                │  └───────────┘ │
└──────────┴────────────────────────────────┴─────────────────┘
```

### 4.2 关键交互

| 动作 | 实现 |
|---|---|
| 添加按钮 | 从左栏拖到中栏（`@angular/cdk` drag-drop） |
| 编辑按钮 | 单击选中 → 右栏属性面板 |
| 删除按钮 | 选中 + Delete 键 / 右上角 × |
| 下钻子菜单 | 双击 `submenu` 按钮 → 面包屑追加，画布切换 |
| 返回上级 | 点击面包屑 |
| 换行 | 拖到"新行"占位符 |
| 撤销/重做 | Ctrl+Z / Ctrl+Y（history 栈 50 步） |
| 实时预览 | 右下角 Telegram 模拟器随编辑更新 |
| 模拟/编辑开关 | 顶部 segment，模拟模式下中栏变交互式预览 |

### 4.3 主题跟随（硬性约束）

所有 `.less` 文件 **必须** 使用 `var(--ant-color-*)` + fallback：

```less
.menu-canvas {
  background: var(--ant-color-bg-container);
  border: 1px solid var(--ant-color-border);
  color: var(--ant-color-text);
}

.button-item {
  background: var(--ant-color-fill-tertiary);
  &:hover { background: var(--ant-color-fill-secondary); }
  &.is-selected { border-color: var(--ant-color-primary); }
}
```

**唯一例外**：Telegram 预览器为还原 TG 外观，固定使用 TG 官方色（`#517da2` 背景、`#e7f0f9` 气泡）。这是"截图还原"不是 UI 组件，**刻意的**。

---

## 5. Bot 端实现

### 5.1 Submenu 下钻机制（Inline Keyboard）

- **根菜单**：Reply Keyboard（底部常驻）
- **子菜单**：遇到 `action=submenu` 触发时，**发一条新消息** + Inline Keyboard
- **返回**：callback_data 带父菜单 path，`editMessageReplyMarkup` 替换按钮
- **callback_data 编码**：`menu:<path>`，其中 path 形如 `row0.btn1.row0.btn2`（下标路径），按 ID 查找
- **无状态**：状态全在 callback_data 里，无需服务端 session、无 mutex、容器重启不影响

### 5.2 模板引擎

```go
// go-bot/internal/telegram/template.go
func renderTemplate(tpl string, vars map[string]string) string {
    if tpl == "" {
        return ""
    }
    for k, v := range vars {
        tpl = strings.ReplaceAll(tpl, "{"+k+"}", v)
    }
    return tpl
}
```

**变量清单**（bot 端所有触发点提供）：

| 变量 | 来源 | 示例 |
|---|---|---|
| `{orderNo}` | Order.OrderNo | `ORD20260502001` |
| `{packageName}` | Package.Name | `100K 能量套餐` |
| `{amount}` | Order.Amount | `12.50` |
| `{energy}` | Package.Energy | `100000` |
| `{address}` | Order.ReceiverAddress | `TXYZ...abc` |
| `{payAddress}` | Order.PayAddress | `TAAA...zzz` |
| `{txHash}` | Order.TxHash | `abc123def...` |
| `{botName}` | bot.Username | `MyEnergyBot` |
| `{bandwidth}` | TRON API | `1500` |
| `{balance}` | TRON API | `125.80` |
| `{reason}` | err.Error() | `余额不足` |

未识别的 `{var}` **保持原样**，方便用户看出拼写错误。

### 5.3 套餐组动态展开

```go
func (b *Bot) executePackageGroup(ctx context.Context, chatID int64, cfg *PackageGroupConfig) error {
    packages, err := b.loadPackagesByIDs(ctx, cfg.PackageIDs)
    if err != nil {
        return err
    }
    sortPackages(packages, cfg.SortBy) // price_asc / price_desc / manual
    var rows [][]inlineKeyboardButton
    for _, pkg := range packages {
        text := renderTemplate(cfg.TextTemplate, map[string]string{
            "name":   pkg.Name,
            "price":  fmt.Sprintf("%.2f", pkg.Price),
            "energy": fmt.Sprintf("%d", pkg.Energy),
        })
        rows = append(rows, []inlineKeyboardButton{
            {Text: text, CallbackData: fmt.Sprintf("pkg:%d", pkg.ID)},
        })
    }
    // 追加 "🔙 返回" 按钮
    rows = append(rows, []inlineKeyboardButton{{Text: "🔙 返回", CallbackData: "menu:back"}})
    return b.sendMessageWithInline(ctx, chatID, "请选择套餐：", &inlineKeyboardMarkup{InlineKeyboard: rows})
}
```

### 5.4 9 种 action 分发

```go
func (b *Bot) executeDesignerButton(ctx context.Context, chatID int64, btn DesignerMenuButton) error {
    switch btn.Action {
    case ActionURL:                return b.sendURLMessage(ctx, chatID, btn.URL, btn.Text)
    case ActionText:               return b.sendMessage(ctx, chatID, btn.Message, nil)
    case ActionCommand:            return b.dispatchCommand(ctx, chatID, btn.Command)
    case ActionStart:              return b.handleStart(ctx, chatID)
    case ActionSubmenu:            return b.enterSubmenu(ctx, chatID, btn.Submenu)
    case ActionEnergyPackageGroup: return b.executePackageGroup(ctx, chatID, btn.PackageGroup)
    case ActionAddressManage:      return b.handleAddressManage(ctx, chatID)
    case ActionWalletQuery:        return b.handleWalletQuery(ctx, chatID)
    case ActionOrders:             return b.handleOrderList(ctx, chatID)
    default:                       return fmt.Errorf("未知 action: %s", btn.Action)
    }
}
```

---

## 6. API 契约

### 6.1 端点

```
GET  /api/agent-bot-configs/:agentId/ui-config
PUT  /api/agent-bot-configs/:agentId/ui-config
PUT  /api/agent-bot-configs/:agentId/ui-config?dryRun=true
GET  /api/energy-platform-config/ui-config          # admin 专属
PUT  /api/energy-platform-config/ui-config          # admin 专属
```

### 6.2 Request/Response

```typescript
// GET response
{
  welcomeText: string,
  menuConfig: MenuRow[],
  messageConfig: MessageTemplates,
  updatedAt: string  // ISO8601，用于并发保护
}

// PUT body
{
  welcomeText?: string,
  menuConfig?: MenuRow[],
  messageConfig?: MessageTemplates
}

// PUT response (success)
{ success: true, updatedAt: string }

// PUT?dryRun=true response
{
  success: boolean,
  validation: {
    errors: Array<{ path: string, message: string }>,
    warnings: Array<{ path: string, message: string }>
  }
}
```

### 6.3 校验规则（NestJS service 层）

1. **DTO 结构校验**：class-validator 装饰器
2. **深度校验**：递归检查 submenu 深度 ≤ 3
3. **每行按钮数**：≤ 4
4. **每菜单行数**：≤ 8
5. **套餐 ID 存在性**：检查 `packageIds` 在当前代理商/平台的套餐表中存在
6. **action 必填字段**：`url` action 必填 `url`、`submenu` 必填 `submenu` 数组非空
7. **按钮文本长度**：≤ 64 字符

### 6.4 并发保护

- GET 返回 `updatedAt`
- PUT 请求头 `If-Unmodified-Since: <updatedAt>`，不匹配返回 409
- UI 提示「配置已被他人修改，请刷新后重试」

### 6.5 权限

- `/api/agent-bot-configs/:agentId/*`：代理商 owner 或 admin
- `/api/energy-platform-config/*`：admin 专属（`@Roles('admin')`）
- 现有 `AuthGuard` + `RolesGuard` 覆盖

---

## 7. 向后兼容

**决策：不兼容，清空旧数据。**

部署时执行 SQL：

```sql
UPDATE agent_bot_configs
SET menu_config = '[]'::jsonb,
    message_config = '{}'::jsonb,
    welcome_text = ''
WHERE menu_config IS NOT NULL
   OR message_config IS NOT NULL
   OR welcome_text IS NOT NULL;

UPDATE energy_platform_config
SET menu_config = '[]'::jsonb,
    message_config = '{}'::jsonb,
    welcome_text = ''
WHERE id = 1;
```

迁移脚本路径：`nest-api/src/drizzle/migrations/YYYY-MM-DD-reset-designer-config.sql`

---

## 8. 前端组件拆分（7 个文件 · 每个 < 300 行）

```
ui/src/app/pages/energy-rental/agent-bot-config/
├── agent-bot-config.component.ts      (现有升级 · 加 nz-tabs)
└── designer/
    ├── types.ts                                 (~120 行)
    ├── menu-designer/
    │   ├── menu-designer.component.ts           (~280 行 · 顶层容器)
    │   ├── menu-tree.service.ts                 (~200 行 · signal state + undo/redo)
    │   ├── component-palette.component.ts       (~150 行 · 左栏)
    │   ├── menu-canvas.component.ts             (~280 行 · 中栏 + CDK 拖拽)
    │   ├── property-panel.component.ts          (~300 行 · 右栏动态表单)
    │   └── telegram-preview.component.ts        (~220 行 · 模拟器)
    └── message-designer/
        ├── message-designer.component.ts        (~250 行 · 9 个模板 Tab)
        ├── variable-hint.component.ts           (~100 行 · 变量 chip 插入)
        └── template-preview.component.ts        (~120 行 · 样例数据渲染)
```

**状态管理**：`menu-tree.service.ts` 提供三个 signal：
- `$currentMenu`：当前层级的 `MenuRow[]`
- `$selectedButtonId`：当前选中按钮
- `$breadcrumb`：面包屑路径

父子通过 service 共享，**避免 Input/Output 地狱**。

---

## 9. 测试策略

### 9.1 后端（NestJS · Jest）

- `ui-config.service.spec.ts`：深度校验、套餐 ID 存在性、action 必填字段
- `ui-config.controller.spec.ts`：权限边界（代理商跨户）、If-Unmodified-Since 并发

### 9.2 Bot 端（Go · testing）

- `designer_test.go`：JSON 解析、嵌套、枚举、畸形数据降级
- `template_test.go`：`{var}` 替换、未知变量、空模板
- `execute_button_test.go`：9 种 action 分发覆盖
- `submenu_callback_test.go`：callback_data 编解码

### 9.3 前端（Angular · Karma）

- `menu-tree.service.spec.ts`：add/remove/move/nest、undo/redo、深度校验
- `property-panel.component.spec.ts`：action 切换时表单重建
- `variable-hint.component.spec.ts`：光标位置插入

### 9.4 E2E（Playwright）

1. 登录 → 进入机器人配置 → 菜单设计器 Tab
2. 拖拽按钮 → 选中 → 配置 → 保存成功
3. 主题切换（暗黑/明亮）→ 所有组件无白块
4. 刷新页面 → 配置保持
5. 模拟模式 → 模拟器显示对应布局

---

## 10. 实施顺序（5 个 PR）

| PR | 内容 | 验收 |
|---|---|---|
| **PR1** | 数据契约：Go struct + NestJS DTO + API 三端打通 | curl PUT/GET 通；go-bot parse 通 |
| **PR2** | Bot 端：9 种 action 分发 + 模板引擎 + Inline submenu + 清空 SQL | go-bot 单测通；TG bot 响应新菜单 |
| **PR3** | 前端菜单设计器（palette + canvas + property + service） | 拖拽可用；主题无违和；undo 可用 |
| **PR4** | 前端消息模板设计器 + Telegram 预览器 | 9 模板可编辑；变量插入可用 |
| **PR5** | E2E + 文档（docs/bot-designer.md 用户手册） | Playwright 关键路径通；文档含截图 |

每个 PR 独立 release，回滚到前一个软链即可。

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| CDK 拖拽在嵌套结构下表现不稳 | 中 | 用单层拖拽 + 下钻切换画布（不做跨层级拖拽） |
| 主题变量 `--ant-color-*` 未覆盖某些场景 | 低 | less 一律带 fallback；code review 严禁硬编码 |
| 套餐 ID 被删后的孤儿引用 | 中 | 加载时过滤不存在的 ID；UI 提示「某套餐已失效」 |
| callback_data 64 字节限制 | 低 | path 用下标（数字）而非按钮 ID，极限情况 3 层共 ~20 字节 |
| 模板变量拼写错误用户不易察觉 | 低 | 未知变量保留原样（显而易见） |
| 清空旧数据导致生产配置丢失 | 高 | 部署前 `pg_dump` 备份三张表；回滚脚本 ready |

---

## 12. 里程碑

1. **W1**：PR1（数据契约打通）
2. **W2**：PR2（Bot 端）
3. **W3-W4**：PR3（菜单设计器）
4. **W5**：PR4（消息模板设计器）
5. **W6**：PR5（E2E + 文档）

---

## 附录 A · 蓝本对照表

| teledashFront 功能 | 本项目映射 |
|---|---|
| 菜单设计器（面包屑、三栏、拖拽） | ✅ PR3 |
| 按钮动作（9 种，含 buy_card） | ⚠️ 改为能量业务 9 种 action |
| 颜色主题选择器 | ✅ `ButtonStyle`（但跟随系统主题，不硬编码） |
| 消息模板（多场景） | ✅ 9 个场景（能量业务特化） |
| 变量插入 | ✅ `variable-hint.component` |
| Telegram 预览器 | ✅ `telegram-preview.component` |
| 模拟/编辑开关 | ✅ 顶部 segment |
| 套餐绑定 | ⚠️ 升级为套餐组（packageIds + sortBy） |

---

**设计终稿 · 2026-05-02**
