# T12 彻底拆除 JustLend 及 Provider Recharge 实施计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 从代码库中彻底移除 JustLend 能量供应商的所有代码路径、相关 DB 列和 UI；同时移除 Provider Recharge 功能；引入独立的 `platform_receive_address` 字段（纯地址，不再通过私钥派生），使 catfee 成为唯一的能量供应商，让测试机 bot 能正常启动。

**架构：** 单 provider 架构（catfee）；bot 不再持有任何私钥；平台不再通过 nest-api 接口持私钥转账；运营人员需要给 catfee 账户充值时直接用冷钱包 / TronLink 向 catfee recharge_address 打款。

**技术栈：** nest-api（NestJS + Drizzle + PostgreSQL）；go-bot-v2（Go + SQLite）；go-agent（Go）；ui（Angular + ng-zorro）；部署走主站 deploy.sh（PostgreSQL 17，docker-compose）。

**技术决策**（已由用户锁定）：
- D1：删除 provider-recharge endpoint 整条功能；不再在 DB / env 存任何私钥
- D2：go-bot-v2 SQL 中 `coalesce(energy_provider, 'justlend')` 统一改为 `coalesce(energy_provider, 'catfee')`；`normalizeProviderName` 空值默认改 `"catfee"`
- D3：旧 `go-bot/` 目录不动（疑似废弃代码，单独评估）
- D4：UI provider 选择器保留结构但只剩 catfee 选项（保留扩展点）
- D5：`energy_orders.energy_provider` 列 DROP（本次彻底清理）
- D6：go-bot-v2 本地 SQLite 只 ADD（0003 migration），justlend 列躺着不处理
- D7：executor.go 的 wallet_transaction 记账逻辑（依赖 JustLendContractAddress）随 executeJustLend 一起删
- `platform_receive_address` 存 DB（UI 手填 TRON 地址），不走 env
- 一个大 commit（feat(b3/t12): 彻底拆除 JustLend 与 Provider Recharge）

---

## 文件结构变更清单

### nest-api 侧

**修改**：
- `nest-api/src/drizzle/schema.ts` — 删 justlend_* / catfee_payer_private_key 列；新增 platform_receive_address 列
- `nest-api/src/modules/energy-rental/energy-rental.service.ts` — 删 justlend 估价分支、buildProviderRechargeContext、rechargeProviderBalance、previewProviderRecharge、sendTrxTransfer、estimateTrxTransferFee、deriveTronAddressFromPrivateKey、fetchJustLendDashboard；调整 getPlatformConfig 返回字段；normalizeProvider 默认改 catfee
- `nest-api/src/modules/energy-rental/energy-rental.controller.ts` — 删 /provider-recharge/preview 和 /provider-recharge endpoints
- `nest-api/src/modules/energy-rental/dto/energy-rental.dto.ts` — 删 PreviewProviderRechargeDto、RechargeProviderBalanceDto；删 justlend_*、catfee_payer_private_key；加 platformReceiveAddress 字段
- `nest-api/src/modules/agent/agent-apply-config.service.ts` — 整体简化成单 catfee 分支，直接取 platformReceiveAddress 字段；energyProvider 硬编码 'catfee'
- `nest-api/src/modules/energy-rental/energy-rental.service.spec.ts` — 清理所有 justlend / provider-recharge 相关测试
- `nest-api/src/modules/agent/agent-apply-config.service.spec.ts` — 改为 catfee 单路径测试

**新增**：
- `nest-api/sql/20260506-t12-drop-justlend.sql` — DROP justlend 系列列 + catfee_payer_private_key；ADD platform_receive_address；DROP energy_orders.energy_provider；DROP energy_platform_config.energy_provider
- `nest-api/sql/rollback/20260506-t12-drop-justlend.rollback.sql` — 反向脚本（尽力而为）

### go-bot-v2 侧

**修改**：
- `go-bot-v2/internal/config/config.go` — 删 JustLend 字段、UsesJustLend()；defaultEnergyProvider 改 "catfee"
- `go-bot-v2/internal/config/config_test.go` — 清理 justlend 测试
- `go-bot-v2/internal/executor/executor.go` — 删 UsesJustLend 分支、processDueReturns、executeJustLend 全套；SQL fallback 改 'catfee'
- `go-bot-v2/internal/executor/executor_test.go` — 清理 justlend 测试
- `go-bot-v2/internal/executor/catfee.go` — normalizeProviderName 默认改 "catfee"；SQL filter 保留
- `go-bot-v2/cmd/bot/apply_config.go` — 删 JustLend 字段、energy_provider 字段（apply_config payload 不再接收）
- `go-bot-v2/cmd/bot/apply_config_test.go` — 清理
- `go-bot-v2/internal/telegram/bot.go` — 删 energyProvider 字段；订单 insert 去 energy_provider 列
- `go-bot-v2/internal/orders/types.go` — 删 JustLendTxID 字段（可选）

**新增**：
- `go-bot-v2/internal/storage/migrations/0003_t12_cleanup.sql` — 仅 ADD platform_receive_address（如不存在）；justlend 列躺着不动

### UI 侧

**修改**：
- `ui/src/app/core/services/http/energy-rental/energy-rental.service.ts` — 删 justlendContractAddress/justlendPayerPrivateKey/catfeePayerPrivateKey/PreviewProviderRecharge 相关接口；加 platformReceiveAddress；接口文件中删 Configured 标记
- `ui/src/app/pages/energy-rental/platform-config/platform-config.component.ts` — 删 justlend/catfee payer 私钥表单字段；加 platformReceiveAddress 字段；activeProvider signal 默认 'catfee'
- `ui/src/app/pages/energy-rental/platform-config/platform-config.component.html` — 删两个私钥表单块；加平台收款地址表单块；删 justlend provider tab
- `ui/src/app/pages/energy-rental/dashboard/dashboard.component.html` — 删 `.provider-recharge-box` 整块
- `ui/src/app/pages/energy-rental/dashboard/dashboard.component.ts` — 删 confirmRechargeProvider / executeRecharge / previewProviderRecharge 相关方法
- `ui/src/app/pages/energy-rental/packages/packages.component.ts` — activeEnergyProvider 默认 'catfee'
- `ui/src/app/pages/energy-rental/packages/packages.component.html` — 估价展示简化（去 justlend 三元）
- `ui/src/app/pages/energy-rental/packages/provider-price-summary.ts` — 删 justlend 分支
- `ui/src/app/pages/energy-rental/packages/provider-price-summary.spec.ts` — 清理
- `ui/src/app/pages/energy-rental/orders/orders.component.ts` — providerText 保留 justlend 映射（历史订单展示）

### 部署 / 文档

**修改**：
- `scripts/deploy.sh` — Step 8 加入 20260506-t12-drop-justlend migration；移除 20260505-catfee-payer-private-key（T11.11 已无效）
- `.env.example` — 删 JUSTLEND_* / ENERGY_PROVIDER 行；加 PLATFORM_RECEIVE_ADDRESS 注释说明
- `docker-compose.prod.yml` — 注释块删 JUSTLEND_* 行
- `docs/deploy-bot-designer.md` — 环境变量说明更新
- `docs/deployment/b1-production-blockers.md` — 删 JUSTLEND_* 段

**不动**：
- `go-bot/` 旧目录（疑似废弃）
- `go-agent/` 目录（无 justlend 耦合）
- `nest-api/sql/energy-rental-init.sql`（历史文档不改）
- `nest-api/sql/20260505-catfee-payer-private-key.sql`（历史 migration 保留；rollback 脚本被 T12 新 migration 覆盖）
- `go-bot-v2/internal/storage/migrations/0001_initial.sql` / `0002_platform_receive_address.sql`（历史 migration 不改）

---

## 任务分解

### 任务 1：nest-api schema + DB migration

**文件：**
- 修改：`nest-api/src/drizzle/schema.ts`
- 创建：`nest-api/sql/20260506-t12-drop-justlend.sql`
- 创建：`nest-api/sql/rollback/20260506-t12-drop-justlend.rollback.sql`

- [ ] **步骤 1.1：写 DB migration SQL**

创建 `nest-api/sql/20260506-t12-drop-justlend.sql`：

```sql
-- B3-T12: 彻底拆除 JustLend，引入 platform_receive_address
-- 幂等：所有 DROP 用 IF EXISTS，ADD COLUMN 用 IF NOT EXISTS
-- 回滚脚本：sql/rollback/20260506-t12-drop-justlend.rollback.sql

BEGIN;

-- 1. energy_platform_config 表
--    a) 新增平台统一收款地址（TRON 地址字符串，运营手填）
ALTER TABLE public.energy_platform_config
  ADD COLUMN IF NOT EXISTS platform_receive_address TEXT;
COMMENT ON COLUMN public.energy_platform_config.platform_receive_address IS
  'T12：平台统一收款地址（TRON Base58 地址），用户付款入账地址；下发给 bot 用于对账';

--    b) 删除 justlend 字段（不再使用 justlend 供应商）
ALTER TABLE public.energy_platform_config
  DROP COLUMN IF EXISTS justlend_contract_address,
  DROP COLUMN IF EXISTS justlend_payer_private_key;

--    c) 删除 T11.11 引入的 catfee_payer_private_key（未用到，回收）
ALTER TABLE public.energy_platform_config
  DROP COLUMN IF EXISTS catfee_payer_private_key;

--    d) 删除 energy_provider 字段（单 provider 架构）
ALTER TABLE public.energy_platform_config
  DROP COLUMN IF EXISTS energy_provider;

-- 2. energy_orders 表
--    删除 energy_provider 字段（历史订单数据 accept loss，一次性切换）
ALTER TABLE public.energy_orders
  DROP COLUMN IF EXISTS energy_provider;

COMMIT;
```

- [ ] **步骤 1.2：写 rollback SQL**

创建 `nest-api/sql/rollback/20260506-t12-drop-justlend.rollback.sql`：

```sql
-- T12 rollback：尽力恢复被删除的列（数据已丢失无法恢复）
-- 用途：生产事故紧急回滚，需配合代码回滚到 T11.11

BEGIN;

-- 恢复 energy_platform_config 列结构
ALTER TABLE public.energy_platform_config
  DROP COLUMN IF EXISTS platform_receive_address;

ALTER TABLE public.energy_platform_config
  ADD COLUMN IF NOT EXISTS justlend_contract_address VARCHAR(128),
  ADD COLUMN IF NOT EXISTS justlend_payer_private_key TEXT,
  ADD COLUMN IF NOT EXISTS catfee_payer_private_key TEXT,
  ADD COLUMN IF NOT EXISTS energy_provider VARCHAR(32) NOT NULL DEFAULT 'catfee';

-- 恢复 energy_orders.energy_provider
ALTER TABLE public.energy_orders
  ADD COLUMN IF NOT EXISTS energy_provider VARCHAR(32) NOT NULL DEFAULT 'catfee';

COMMIT;
```

- [ ] **步骤 1.3：改 Drizzle schema.ts**

修改 `nest-api/src/drizzle/schema.ts`：

- 在 `energyPlatformConfigTable` 定义中：
  - **删除** `justlendContractAddress` 和 `justlendPayerPrivateKey` 两行
  - **删除** `catfeePayerPrivateKey`（T11.11 加的，含前后注释块）
  - **删除** `energyProvider` 行
  - **新增** `platformReceiveAddress: text('platform_receive_address')` 一行，紧跟 `tronApiKey` 之后

- 在 `energyOrdersTable` 定义中：
  - **删除** `energyProvider: varchar('energy_provider', { length: 32 }).notNull().default('catfee')` 一行

- [ ] **步骤 1.4：验证 schema 编译通过**

运行：`cd nest-api && npm run build 2>&1`
预期：编译通过（可能有下游 service 引用错误，那是下一任务处理）。如果只是 schema.ts 本身有 TS 错，必须当场修掉。

- [ ] **步骤 1.5：改 deploy.sh Step 8**

修改 `scripts/deploy.sh`：

- 删掉 `run_sql "nest-api/sql/20260505-catfee-payer-private-key.sql" "..."` 这一行
- 在 `20260505-agents-bot-runtime` 之后加：

```bash
run_sql "nest-api/sql/20260506-t12-drop-justlend.sql"       "20260506-t12-drop-justlend（T12 删 justlend + 加 platform_receive_address）"
```

---

### 任务 2：nest-api agent-apply-config.service 单路径化

**文件：**
- 修改：`nest-api/src/modules/agent/agent-apply-config.service.ts`
- 修改：`nest-api/src/modules/agent/agent-apply-config.service.spec.ts`

- [ ] **步骤 2.1：TDD 先红 - 改测试期待**

修改 `agent-apply-config.service.spec.ts`：

- 在所有 `platformConfigRow` fixture 中：
  - 删除 `justlendContractAddress / justlendPayerPrivateKey / catfeePayerPrivateKey / energyProvider` 字段
  - 新增 `platformReceiveAddress: 'TPlatformAddr123...'` 字段（用合法长度的假地址）
- 删除所有「justlend 派生地址」相关测试用例（搜关键字 `justlend` 和 `catfee_payer_private_key`）
- 删除 T11.11 加的 catfee 私钥派生测试用例
- 新增测试：
  ```typescript
  it('应使用 platformReceiveAddress 字段直接下发，不派生地址', async () => {
    const platformConfigRow = {
      tronApiBaseUrl: 'https://api.trongrid.io',
      tronApiKey: 'key',
      platformReceiveAddress: 'TPlatformAddr123456789',
      // catfee_* 其他字段...
    };
    // 断言 registry.callAgent 被调用时 params.platform.platformReceiveAddress === 'TPlatformAddr123456789'
    // 断言 deriveTronAddressFn 永不被调用
  });

  it('platformReceiveAddress 空时抛 500', async () => {
    const platformConfigRow = { ..., platformReceiveAddress: '' };
    await expect(service.applyConfig(userId, licenseId))
      .rejects.toThrow(InternalServerErrorException);
  });
  ```
- `buildSvc` 签名中移除 `deriveAddr` 参数（或保留但永不调用）

- [ ] **步骤 2.2：运行测试验证失败**

运行：`cd nest-api && npx jest src/modules/agent/agent-apply-config.service.spec.ts --no-coverage 2>&1`
预期：新加的 2 个测试失败（platformReceiveAddress 字段尚不存在于读取列表中；或派生逻辑还在运行）

- [ ] **步骤 2.3：改实现 - 单 catfee 路径**

修改 `agent-apply-config.service.ts`：

- **SELECT 列表**：删除 `justlendContractAddress / justlendPayerPrivateKey / catfeePayerPrivateKey / energyProvider`，新增 `platformReceiveAddress: energyPlatformConfigTable.platformReceiveAddress`
- **删除** 整个 `if plat.energyProvider === 'justlend' ... else if ... === 'catfee'` 分支块（L181-219）
- **替换为**：
  ```typescript
  // T12：platformReceiveAddress 为纯地址字段，运营手填；不再派生
  const platformReceiveAddress = String(plat.platformReceiveAddress ?? '').trim();
  if (!platformReceiveAddress) {
    this.logger.error(`平台收款地址未配置 license=${licenseId}`);
    throw new InternalServerErrorException(
      '平台收款地址（platform_receive_address）未配置',
    );
  }
  ```
- **组装 params.platform**：
  - 删除 `justlendContractAddress / justlendPayerPrivateKey / catfeePayerPrivateKey` 字段
  - `energyProvider: 'catfee'` 硬编码
  - `platformReceiveAddress` 直接用上面变量
- **构造器**：移除 `deriveTronAddressFn` 字段和相关 import（如果测试不再注入）
- 删除 `import { deriveTronAddress } from './util/tron-address.util'`（若文件下游其他路径也用，暂留，但本 service 不引用）

- [ ] **步骤 2.4：运行测试验证通过**

运行：`cd nest-api && npx jest src/modules/agent/agent-apply-config.service.spec.ts --no-coverage 2>&1`
预期：所有新测试 pass，旧测试删干净后也不红

---

### 任务 3：nest-api energy-rental.service 大清理

**文件：**
- 修改：`nest-api/src/modules/energy-rental/energy-rental.service.ts`
- 修改：`nest-api/src/modules/energy-rental/dto/energy-rental.dto.ts`
- 修改：`nest-api/src/modules/energy-rental/energy-rental.service.spec.ts`

- [ ] **步骤 3.1：TDD 先红 - 清理 spec fixture**

修改 `energy-rental.service.spec.ts`：

- 全局替换：fixture 里所有 `justlendContractAddress` / `justlendPayerPrivateKey` 字段删除
- 删除 `catfeePayerPrivateKey` 字段（T11.11 加的）
- 删除 `energyProvider` 字段（现在硬编码 catfee）
- 所有 `config()` 返回对象 fixture 新增 `platformReceiveAddress: 'TPlatformAddr123456789'`
- 删除以下测试块：
  - `rechargeProviderBalance 成功路径` (~L435-491)
  - `rechargeProviderBalance 余额不足` (~L493-554)
  - `previewProviderRecharge ...` (~L556-609+)
  - `rejects packages below JustLend minimum energy amount` (~L868-888 justlend 分支)
  - `returns justlend dashboard in estimatePackage` 或类似 (L944-1072 justlend 估价)
  - `JustLend configured 状态位测试` (~L1030-1072)
  - 任何 `energyProvider === 'justlend'` 相关的断言测试
- 为 `getPlatformConfig` 测试新增断言：返回对象包含 `platformReceiveAddress` 字段、**不包含** `justlendContractAddress / justlendPayerPrivateKey / catfeePayerPrivateKey / energyProvider / justlendPayerPrivateKeyConfigured / catfeePayerPrivateKeyConfigured`

- [ ] **步骤 3.2：运行测试验证失败**

运行：`cd nest-api && npx jest src/modules/energy-rental/energy-rental.service.spec.ts --no-coverage 2>&1 | Select-Object -Last 80`
预期：大量失败（TS 编译错 + 断言失败），因为 service.ts 还在用 justlend 字段。

- [ ] **步骤 3.3：改 DTO**

修改 `dto/energy-rental.dto.ts`：

- **删除** `PreviewProviderRechargeDto` 整个 class
- **删除** `RechargeProviderBalanceDto` 整个 class
- 在 `UpdatePlatformConfigDto`（或等价 class）里：
  - 删除 `justlendContractAddress? / justlendPayerPrivateKey? / catfeePayerPrivateKey? / energyProvider?` 字段
  - 新增 `platformReceiveAddress?: string;`（加 @IsOptional @IsString 注解）

- [ ] **步骤 3.4：改 service.ts - 删除 provider-recharge 整片**

修改 `energy-rental.service.ts`：

**删除整个函数**：
- `buildProviderRechargeContext` (~L1891-1937)
- `rechargeProviderBalance` (~L1793-1853)
- `previewProviderRecharge` (~L1855-1889)
- `sendTrxTransfer` (~L2350+，定位方式：搜 `tronWeb.trx.sendTransaction`)
- `estimateTrxTransferFee` (~L2231+)
- `deriveTronAddressFromPrivateKey` (~L1939-后续)
- `fetchJustLendDashboard` (~L2434-2444)
- `normalizeTronPrivateKey`（若仅此处用，搜引用）

**删除常量**：
- `MIN_JUSTLEND_ENERGY_AMOUNT` (~L151)
- `JUSTLEND_DASHBOARD_URL` (~L157)

**修改 `estimatePackage`** (~L342-392)：
- 移除 `provider === 'catfee' ? ... : fetchJustLendDashboard(...)` 的三元分支
- 直接返回 catfee 分支逻辑
- 返回对象 `provider: 'catfee', providerLabel: 'CatFee'`（删 source 字段或保留 catfee source）

**修改 `getPlatformConfig`** (~L664-666 附近)：
- 从返回对象中删除 `justlendContractAddress / justlendPayerPrivateKey / justlendPayerPrivateKeyConfigured / catfeePayerPrivateKey / catfeePayerPrivateKeyConfigured / energyProvider`
- 新增 `platformReceiveAddress: String(config?.platformReceiveAddress ?? '').trim()`

**修改 `buildPlatformConfigValues`** (~L2575, L2597)：
- 删除 `setTrimmed(values, 'justlendContractAddress', ...)` 一行
- 删除 `setSecret(values, 'justlendPayerPrivateKey', ...)` 一行
- 删除 `setSecret(values, 'catfeePayerPrivateKey', ...)` 一行
- 新增 `setTrimmed(values, 'platformReceiveAddress', data.platformReceiveAddress)`

**修改 `assertPackageAmount`** (~L2412-2431)：
- 移除 provider 参数或固定 catfee 分支
- 直接用 catfee 最小能量常量

**修改 `normalizeProvider`** (~L3455-3457)：
- 默认返回 `'catfee'` 而不是 `'justlend'`

**修改 `platformConfigDefaults`** (~L135)：
- 删除 `energyProvider: 'justlend'` 行（或改 'catfee'，看下游引用后决定，应该是删）

**删除错误文案**：
- `'JustLend 参数异常'` (~L3441) 改写或删除

- [ ] **步骤 3.5：改 controller - 删 endpoints**

修改 `nest-api/src/modules/energy-rental/energy-rental.controller.ts`：

- **删除** `@Post('provider-recharge/preview')` 方法 `previewProviderRecharge` (~L284)
- **删除** `@Post('provider-recharge')` 方法 `rechargeProviderBalance` (~L293)
- 删除相关 import（`PreviewProviderRechargeDto / RechargeProviderBalanceDto`）

- [ ] **步骤 3.6：运行所有 nest-api 单测**

运行：`cd nest-api && npx jest --no-coverage 2>&1 | Select-Object -Last 100`
预期：
- `energy-rental.service.spec.ts` 全 pass
- `agent-apply-config.service.spec.ts` 全 pass
- 其他文件：忽略已知的 `welcomeText` 和 `@nestjs/schedule/websockets` TS 错（handoff 里记录了是存量问题）

**排错策略**：如果 `energy-rental.service.ts` 还有 TS 编译错，通常是：
- 某个地方还在引用被删的 `energyProvider` 字段 → 全文搜 `energyProvider` / `justlend` 逐个清理
- spec 里 fixture 有没加 `platformReceiveAddress` → 补齐

---

### 任务 4：go-bot-v2 核心清理

**文件：**
- 修改：`go-bot-v2/internal/config/config.go`
- 修改：`go-bot-v2/internal/config/config_test.go`
- 创建：`go-bot-v2/internal/storage/migrations/0003_t12_cleanup.sql`

- [ ] **步骤 4.1：创建 SQLite migration 0003**

创建 `go-bot-v2/internal/storage/migrations/0003_t12_cleanup.sql`：

```sql
-- B3-T12: SQLite 幂等补列
-- 注：SQLite 旧版不支持 DROP COLUMN，justlend 列躺着不动（无害）
-- 本次只确保 platform_receive_address 存在

ALTER TABLE energy_platform_config
  ADD COLUMN platform_receive_address TEXT;
```

注：0002 已经加了 platform_receive_address，这个 migration 实际上是"no-op 占位"，保留 migration 版本号连续性。**如果 0002 已经创建过该列**，重复 ALTER 会报错——需看 storage.go 的 migration 机制如何处理幂等。

**改进方案**：检查 `go-bot-v2/internal/storage/migrations/` 目录是否有 `applied_migrations` 表，有则按版本号跳过。如果已有 0002 加该列，那 0003 可省略。

运行：`ls go-bot-v2/internal/storage/migrations/`

如果 0002 已存在且内容是 `ADD COLUMN platform_receive_address`，**不需要创建 0003**，这一步跳过。

- [ ] **步骤 4.2：TDD 先红 - 改 config_test**

修改 `config_test.go`：

- 删除 `TestLoadFromDatabaseAllowsCatFeeNileWithoutJustLendSecrets` 整个测试
- 全局 fixture 中：
  - 删掉 `"TJustLendContract"` 出现的行（通常是 fixture 的 SQL INSERT 参数列表）
  - 删掉 `"justlend"` 作为 energy_provider 列的默认值（相关 INSERT 改为不插这一列，或插 'catfee'——取决于后续 schema）
  - required keys 断言中删除 `"JUSTLEND_CONTRACT_ADDRESS" / "JUSTLEND_PAYER_PRIVATE_KEY"`
  - 保留 `"PLATFORM_RECEIVE_ADDRESS"` 作为 required
- 删除 `cfg.JustLendContractAddress` / `cfg.JustLendPayerPrivateKey` 的所有断言
- env fixture 中删除 `JUSTLEND_*` 环境变量，保留 `PLATFORM_RECEIVE_ADDRESS`

- [ ] **步骤 4.3：跑测试验证失败**

运行：`cd go-bot-v2 && go test ./internal/config/... 2>&1`
预期：编译失败或 fixture 不完整导致的失败

- [ ] **步骤 4.4：改 config.go**

修改 `config.go`：

- **删除** `const defaultEnergyProvider = "justlend"` 行（L18），改为 `"catfee"`；或者干脆删掉常量（如果 normalizeProvider 不再调用）
- **删除** `"JUSTLEND_CONTRACT_ADDRESS"` / `"JUSTLEND_PAYER_PRIVATE_KEY"` 在 requiredKeys 列表中（L30-31）
- **删除** struct 字段 `JustLendContractAddress string` / `JustLendPayerPrivateKey string` (L43-44)
- **删除** env 读取 `JUSTLEND_*` (L123-124)
- **删除** SQL SELECT 里的 justlend 两列 (L176-177)
- **删除** Scan 目标 `&cfg.JustLendContractAddress / &cfg.JustLendPayerPrivateKey` (L209-210)
- **删除** TrimSpace 清理 (L250-251)
- **删除** `EnergyProvider` 字段（如果还在用就保留但 hardcoded "catfee"，如果不用就删）——实际上 executor/catfee.go 的 normalizeProviderName 还读这个概念，建议**保留字段但不下发**
- 修改：SQL SELECT 里的 `COALESCE(p.energy_provider, 'justlend')` (L182) 改为 `'catfee'`
  - 实际上：若 schema 里删了 energy_provider 列（nest-api 已 DROP），bot 端 SQLite schema 是**独立的**，可能还保留 energy_provider 列。对齐 D5 决策：nest-api DROP 了这列，bot 端 SQLite 也应删或仅置默认 catfee
  - **决定**：bot 端 SQLite 的 energy_platform_config 保留 energy_provider 列（SQLite 不支持 drop），SQL COALESCE 默认改 'catfee'
- **删除** `UsesJustLend()` 方法 (L361-362)
- **删除** apply_config env 写入里的 `JUSTLEND_*` (L332-333)
- **删除** provider 白名单里的 `case "justlend":` (L330)

- [ ] **步骤 4.5：跑 config 测试验证通过**

运行：`cd go-bot-v2 && go test ./internal/config/... -v 2>&1`
预期：全 pass

---

### 任务 5：go-bot-v2 executor 大手术

**文件：**
- 修改：`go-bot-v2/internal/executor/executor.go`
- 修改：`go-bot-v2/internal/executor/executor_test.go`
- 修改：`go-bot-v2/internal/executor/catfee.go`

- [ ] **步骤 5.1：TDD 先红 - 改 executor_test**

修改 `executor_test.go`：

- **删除** 以下测试整块：
  - `TestBuildJustLendParamsUsesUint256ResourceType` (~L128)
  - `TestValidateJustLendTransactionInfoRejectsFailedReceipt` (~L140)
  - `TestOfficialRentalExpirationUsesJustLendRemainingSeconds` (~L160)
  - `TestJustLendRefundToAddressSunReadsReturnInternalTransfer` (~L179)
- 保留 catfee 相关测试

- [ ] **步骤 5.2：跑测试验证失败/编译错**

运行：`cd go-bot-v2 && go test ./internal/executor/... 2>&1`
预期：编译错或测试失败

- [ ] **步骤 5.3：改 executor.go - 拆 justlend 代码块**

修改 `executor.go`：

**删除字段/常量**：
- `errOfficialRentalOrderNotFound` (L46)
- 相关 `justLendRentResourceMethod / justLendReturnResourceMethod` 常量

**删除整个函数**：
- `processDueReturns` (~L291-334)
- `fetchDashboard` (~L381-407)
- `fetchOfficialRentalExpirationWithRetry` (~L410-439)
- `fetchOfficialRentalExpiration` (~L441+)
- `syncOfficialRentalExpirations` (~L615-644)
- `fetchDueReturnTasks` (~L580-612)
- `fetchRentingOrdersForScheduleSync` (~L645-678)
- `executeJustLend` (~L995-1048)
- `justLendPayerAddress` (~L1051-1063)
- `buildJustLendParams` (~L1103)
- `waitForJustLendReceipt` (~L1107-1131)
- `validateJustLendTransactionInfo` (~L1133+)
- `rentalAmountsFromDashboard`（若仅 justlend 用）

**修改 `syncRentalExpirations`**（主调度器）：
- 删除 `if s.cfg.UsesJustLend() { ... }` 整个 block (L196-203)
- 保留 `syncCatFeeRentingOrders(ctx)` 调用

**修改 `processPaidOrders`**：
- 保留 `if normalizeProviderName(order.Provider) == "catfee"` 分支（其实现在永远为 true）
- **删除** else 分支的整个 JustLend 执行块（L258-287 附近）：`fetchDashboard` → `executeJustLend` → `markOrderRenting` → 通知的整条 justlend 流程
- 可以简化为：无论是否 catfee，都走 `processCatFeePaidOrder`；或者保留 if 过滤，非 catfee 订单跳过

**修改 SQL fallback**：
- L559: `fetchPaidOrders` SQL 中 `coalesce(energy_provider, 'justlend')` 改 `'catfee'`（如果 bot 端 SQLite 保留了该列）
- L588: `fetchDueReturnTasks` 已随函数删除
- L653: `fetchRentingOrdersForScheduleSync` 已随函数删除

**删除 wallet_transaction 记账**：
- `markOrderRenting` 里 `insertNetworkFeeWalletTransaction` 调用（L791, L799, L886, L894）—— 这些依赖 `JustLendContractAddress`，随 executeJustLend 一起删。注：如果 `markOrderRenting` 被 catfee 分支也调用，需要分析是否 catfee 路径需要保留记账。
  - **检查**：搜 `markOrderRenting` 调用点，catfee.go 里的 `markCatFeeOrderRenting` 若独立，不受影响
  - **删除**：justlend 专属的 insertNetworkFeeWalletTransaction 调用，保留 catfee 路径独立的记账（如果有）

- [ ] **步骤 5.4：改 catfee.go 小调整**

修改 `catfee.go`：

- `normalizeProviderName` (L492-498)：`if value == "" { return "catfee" }`（默认改 catfee）
- L213 的 SQL `coalesce(energy_provider, 'justlend') = 'catfee'` 保留（bot 端 SQLite 还有 energy_provider 列）

- [ ] **步骤 5.5：跑 executor 测试验证通过**

运行：`cd go-bot-v2 && go test ./internal/executor/... -v 2>&1`
预期：全 pass

- [ ] **步骤 5.6：跑全部 go-bot-v2 测试**

运行：`cd go-bot-v2 && go test ./... 2>&1 | Select-Object -Last 50`
预期：全 pass。如果 `internal/telegram/bot.go` 或 `cmd/bot/apply_config.go` 编译错，是下一任务的事（记在 todo）

---

### 任务 6：go-bot-v2 apply_config + telegram/bot 适配

**文件：**
- 修改：`go-bot-v2/cmd/bot/apply_config.go`
- 修改：`go-bot-v2/cmd/bot/apply_config_test.go`
- 修改：`go-bot-v2/internal/telegram/bot.go`
- 修改：`go-bot-v2/internal/telegram/bot_sqlite_sqls_test.go`（如果影响）

- [ ] **步骤 6.1：TDD 先红 - 改 apply_config_test**

修改 `apply_config_test.go`：

- payload fixture (L29-32) 里：
  - **删除** `JustLendContractAddress: "TCONTRACT"` 字段
  - **删除** `JustLendPayerPrivateKey: "priv-key-hex"` 字段
  - **删除** `EnergyProvider: "justlend"` 字段（整行删，不改成 catfee）
- 断言 (L66-67) 里删 `cfg.PlatformReceiveAddress != "TABC12345"` 保留；**删** `cfg.JustLendContractAddress / JustLendPayerPrivateKey / EnergyProvider` 相关断言

- [ ] **步骤 6.2：跑测试验证失败**

运行：`cd go-bot-v2 && go test ./cmd/bot/... 2>&1`
预期：失败或编译错

- [ ] **步骤 6.3：改 apply_config.go**

修改 `apply_config.go`：

- **删除** Params struct 中字段 (L47-49)：
  - `JustLendContractAddress string json:"justlendContractAddress"`
  - `JustLendPayerPrivateKey string json:"justlendPayerPrivateKey"`
  - `EnergyProvider string json:"energyProvider"`
- 修改 SQL UPDATE 模板 (L118-121)：
  - **删除** `justlend_contract_address = ?, justlend_payer_private_key = ?, energy_provider = ?` 三列
  - 保留 `platform_receive_address = ?`
- 修改 Exec 参数 (L140-143)：
  - **删除** `p.JustLendContractAddress, p.JustLendPayerPrivateKey, coalesceDefault(p.EnergyProvider, "justlend")` 三参
  - 保留 `p.PlatformReceiveAddress`

**注意**：由于 bot 端 SQLite 的 `energy_platform_config` 表仍有 `justlend_contract_address / justlend_payer_private_key / energy_provider` 这几列（本次不 drop），UPDATE 语句**不动这几列**即可，它们会保持 NULL/空字符串。

- [ ] **步骤 6.4：改 bot.go**

修改 `internal/telegram/bot.go`：

- **保留** `receiveAddress string` 字段 (L34)
- **删除** `energyProvider string` 字段 (L37) —— 现在只剩 catfee，不需要区分
- **保留** L243: `receiveAddress: cfg.PlatformReceiveAddress`
- **删除** L246: `energyProvider: ...` 注入
- SQL insert energy_orders (L1027-1038)：
  - **删除** `energy_provider` 列从 column list 和 VALUES
  - 删除 b.energyProvider 参数

注：bot 端 SQLite 的 energy_orders 表**保留** energy_provider 列（不迁移），INSERT 不填等于 NULL 或 default。**更安全的做法**：
- 检查 bot 端 SQLite 的 energy_orders.energy_provider 是否有 NOT NULL 约束
- 如果有，INSERT 必须给值，建议 insert `'catfee'` 写死

**实现**：保留 INSERT 里写 `'catfee'` 字符串而不是变量：

```go
// 将原 VALUES 里的 ?（energy_provider 位置）替换为字面量 'catfee'
// 其他参数顺序对应调整
```

- [ ] **步骤 6.5：改 bot_sqlite_sqls_test.go（如果存在）**

修改 `bot_sqlite_sqls_test.go`：

- L107 附近的 SQL 模板字符串同步更新（与 bot.go 的 INSERT 语句匹配）

- [ ] **步骤 6.6：跑测试验证通过**

运行：`cd go-bot-v2 && go test ./... 2>&1 | Select-Object -Last 50`
预期：全 pass

---

### 任务 7：UI - 平台配置页改造

**文件：**
- 修改：`ui/src/app/core/services/http/energy-rental/energy-rental.service.ts`
- 修改：`ui/src/app/pages/energy-rental/platform-config/platform-config.component.ts`
- 修改：`ui/src/app/pages/energy-rental/platform-config/platform-config.component.html`

- [ ] **步骤 7.1：改 http service 接口**

修改 `core/services/http/energy-rental/energy-rental.service.ts`：

- UpdateDto interface (L140)：
  - **删除** `energyProvider?: string`
  - **新增** `platformReceiveAddress?: string`
- ConfigResponse interface (L278-283)：
  - **删除** `justlendContractAddress / justlendPayerPrivateKey / justlendPayerPrivateKeyConfigured` 
  - **删除** `catfeePayerPrivateKey / catfeePayerPrivateKeyConfigured`
  - **删除** `energyProvider: string`
  - **新增** `platformReceiveAddress: string`
- **删除** `PreviewProviderRechargeRequest / PreviewProviderRechargeResponse / RechargeProviderBalanceRequest / RechargeProviderBalanceResponse` 相关接口（搜 `ProviderRecharge`）
- **删除** `previewProviderRecharge()` 和 `rechargeProviderBalance()` 两个方法（~L503-507）

- [ ] **步骤 7.2：改 platform-config.component.ts**

修改 `platform-config.component.ts`：

- `activeProvider = signal('justlend')` → `signal('catfee')` (L50)
- providers 数组 (L59 附近)：删除 `{ value: 'justlend', ... }` 条目，只剩 catfee
- Form 控件 (L81-84)：
  - **删除** `justlendContractAddress: ['', [Validators.required]]`
  - **删除** `justlendPayerPrivateKey: ['']`
  - **删除** `catfeePayerPrivateKey: ['']`
  - **删除** `energyProvider: ['justlend', [Validators.required]]`
  - **新增** `platformReceiveAddress: ['', [Validators.required, Validators.pattern(/^T[A-Za-z0-9]{33}$/)]]`  // TRON 地址正则
- `syncProviderValidators` (L124-130)：简化或删除（现在只有 catfee，不需要 switch）
- `patchValue` (L153-156) 改为只 patch `platformReceiveAddress`
- L170 `activeProvider.set(...)` 去掉（或固定 catfee）
- L193-195 订阅 provider 变化的代码块：删除或简化

- [ ] **步骤 7.3：改 platform-config.component.html**

修改 `platform-config.component.html`：

- **删除** L34-54 「JustLend 平台付款私钥」表单块（整个 `<nz-form-item>` 块）
- **删除** L56-78 附近「CatFee 平台收款私钥」表单块（T11.11 加的）
- **删除** L181-199 `@if (activeProvider() === 'justlend')` 包裹的合约地址面板
- **新增** 平台统一收款地址表单项，位置放在"Tron API 基础 URL"之后、"Tron API Key"之前：

```html
<nz-form-item>
  <nz-form-label [nzSpan]="6" nzRequired>平台统一收款地址</nz-form-label>
  <nz-form-control [nzSpan]="18" nzErrorTip="请输入合法 TRON 地址（T 开头 34 位）">
    <input
      nz-input
      formControlName="platformReceiveAddress"
      placeholder="例如 TXYZAbc123...（平台统一收款 TRON 地址）"
    />
    <div class="nz-form-explain-tip">
      下游客户下单付款将打到此地址；bot 通过该地址查询入账确认付款到账。
    </div>
  </nz-form-control>
</nz-form-item>
```

- [ ] **步骤 7.4：UI 构建验证**

运行：`cd ui && npx ng build --configuration=development 2>&1 | Select-Object -Last 40`
预期：编译成功。如果有 TS 错：
- 通常是 service 接口 type 不匹配 → 补全 ConfigResponse 的可选字段
- html 模板里还引用了 `config()?.justlend_*` → 全文搜 `justlend` 清理

---

### 任务 8：UI - Dashboard 页删除 provider-recharge

**文件：**
- 修改：`ui/src/app/pages/energy-rental/dashboard/dashboard.component.ts`
- 修改：`ui/src/app/pages/energy-rental/dashboard/dashboard.component.html`

- [ ] **步骤 8.1：改 dashboard.component.html**

修改 `dashboard.component.html`：

- **删除** `.provider-recharge-box` 整个 `<div>` 块 (L82-108)
- 相关条件 `item.provider === 'catfee' && item.channel === 'prod'` 语句随之删除

- [ ] **步骤 8.2：改 dashboard.component.ts**

修改 `dashboard.component.ts`：

- **删除** `confirmRechargeProvider()` 方法 (L219-242 附近)
- **删除** `executeRecharge()` 方法
- **删除** `previewProviderRecharge()` 方法
- **删除** 相关 `this.modal.confirm` 引用链
- 删除相关未用 import（可能是 PreviewProviderRechargeDto / RechargeProviderBalanceDto 等）

- [ ] **步骤 8.3：UI 构建验证**

运行：`cd ui && npx ng build --configuration=development 2>&1 | Select-Object -Last 30`
预期：编译成功

---

### 任务 9：UI - packages / orders 清理

**文件：**
- 修改：`ui/src/app/pages/energy-rental/packages/packages.component.ts`
- 修改：`ui/src/app/pages/energy-rental/packages/packages.component.html`
- 修改：`ui/src/app/pages/energy-rental/packages/provider-price-summary.ts`
- 修改：`ui/src/app/pages/energy-rental/packages/provider-price-summary.spec.ts`
- 修改：`ui/src/app/pages/energy-rental/orders/orders.component.ts`

- [ ] **步骤 9.1：改 packages.component.ts**

- `activeEnergyProvider = signal('justlend')` → `signal('catfee')` (L105)
- L586 附近根据 config.energyProvider 同步的逻辑：固定 catfee 或删除

- [ ] **步骤 9.2：改 packages.component.html**

- L259 `estimate.provider === 'catfee' ? 'CatFee 参考参数' : 'JustLend 参考参数'` → 直接用 `'CatFee 参考参数'`

- [ ] **步骤 9.3：改 provider-price-summary.ts**

- 删除 `buildProviderPriceRequest` 里的 `if provider === 'justlend'` 分支 (L12-34)
- 只保留 catfee 分支

- [ ] **步骤 9.4：改 provider-price-summary.spec.ts**

- 删除 `测试 buildProviderPriceRequest('justlend')` 相关 case (L13)

- [ ] **步骤 9.5：改 orders.component.ts**

- `providerText` map (L172)：**保留** `justlend: 'JustLend'` 映射（展示历史订单需要）—— 但因为已经 DROP energy_provider 列，历史订单新查不到这个字段了
- **改为**：删除整个 providerText map 引用，订单列表不再展示 provider 列
- L203 `{ title: '服务商', field: 'energyProvider' }`：**删除** 这整列
- L60-61 `orders.component.html` 里 `<nz-tag>` provider 展示：**删除** 这一列对应的 `<td>` 单元格

**注**：因为 D5 决定 DROP energy_orders.energy_provider，历史订单信息丢失是 accept loss。UI 不展示 provider 列更干净。

- [ ] **步骤 9.6：UI 全量构建**

运行：`cd ui && npx ng build --configuration=development 2>&1 | Select-Object -Last 30`
预期：编译成功

---

### 任务 10：主站部署

**前置要求**：任务 1-9 全部完成，所有测试 pass。

- [ ] **步骤 10.1：本地完整检查**

运行（分别）：
- `cd nest-api && npx jest --no-coverage 2>&1 | Select-Object -Last 30`
- `cd go-bot-v2 && go test ./... 2>&1 | Select-Object -Last 30`
- `cd ui && npx ng build --configuration=development 2>&1 | Select-Object -Last 30`

预期：全部 green。任何红都要修完才能部署。

- [ ] **步骤 10.2：本地构建 go 二进制**

运行 `./go-agent/packaging/build.sh`（agent）和 `./go-bot-v2/packaging/build.sh`（bot，需 Docker Desktop 启动）。

预期：
- `go-agent/dist/energybot-agent-linux-{amd64,arm64}` 生成
- `go-bot-v2/dist/energybot-bot-linux-{amd64,arm64}` 生成

- [ ] **步骤 10.3：scp 二进制到主站**

```powershell
$env:SSHPASS='+bp5XcF95o1RK;'
$sshpass = 'C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Links\sshpass.exe'

# 备份旧的
& $sshpass -e ssh -o StrictHostKeyChecking=no root@47.82.151.0 "ts=`$(date +%Y%m%d-%H%M%S); cp -a /opt/maer-energy/public/bin /opt/maer-energy/public/bin.backup-`$ts; ls /opt/maer-energy/public/"

# 上传 4 个新二进制
& $sshpass -e scp -o StrictHostKeyChecking=no go-agent/dist/energybot-agent-linux-amd64 root@47.82.151.0:/opt/maer-energy/public/bin/energybot-agent-linux-amd64
& $sshpass -e scp -o StrictHostKeyChecking=no go-agent/dist/energybot-agent-linux-arm64 root@47.82.151.0:/opt/maer-energy/public/bin/energybot-agent-linux-arm64
& $sshpass -e scp -o StrictHostKeyChecking=no go-bot-v2/dist/energybot-bot-linux-amd64 root@47.82.151.0:/opt/maer-energy/public/bin/energybot-bot-linux-amd64
& $sshpass -e scp -o StrictHostKeyChecking=no go-bot-v2/dist/energybot-bot-linux-arm64 root@47.82.151.0:/opt/maer-energy/public/bin/energybot-bot-linux-arm64

# 更新 sha256sums
& $sshpass -e ssh -o StrictHostKeyChecking=no root@47.82.151.0 "cd /opt/maer-energy/public/bin && sha256sum energybot-* > SHA256SUMS.txt && cat SHA256SUMS.txt"
```

- [ ] **步骤 10.4：git commit**

```bash
git add -A
git status --short
```

预期：所有 T12 改动都被 stage 了。

```bash
git commit -m "feat(b3/t12): 彻底拆除 JustLend 与 Provider Recharge；引入 platform_receive_address 纯地址字段" -m "背景：catfee 模式下 bot 启动失败（T11.11 方案有误），根因是 catfee 不该用私钥派生收款地址。" -m "本次变更：" -m "- 删除 JustLend 能量供应商所有代码路径（nest-api estimate 分支、go-bot-v2 executor 全套 executeJustLend / processDueReturns / fetchDashboard）" -m "- 删除 Provider Recharge 功能：/energy-rental/provider-recharge endpoint、UI Dashboard 一键充值按钮、buildProviderRechargeContext 及相关函数" -m "- 新增 energy_platform_config.platform_receive_address（纯 TRON 地址字符串），UI 手填，下发给 bot 对账用" -m "- DROP justlend_contract_address / justlend_payer_private_key / catfee_payer_private_key / energy_provider 列" -m "- DROP energy_orders.energy_provider 列（accept loss）" -m "- agent-apply-config 简化为单 catfee 路径；bot 不再接收任何私钥字段" -m "- UI 平台配置页新增「平台统一收款地址」输入框，删除两个私钥输入框" -m "- normalizeProviderName 默认改 catfee；bot 端 SQLite COALESCE fallback 改 catfee" -m "运营影响：CatFee 账户充值今后直接用冷钱包/TronLink 向 recharge_address 打款，不再经过 nest-api。" -m "测试：TDD 先红后绿；nest-api 单测 pass；go-bot-v2 go test ./... pass；UI 构建 pass。"
```

- [ ] **步骤 10.5：merge main + push**

```bash
git checkout main
git merge --ff-only codex/energy-rental-admin
git push origin main
```

预期：fast-forward 成功。如果不是 ff（origin/main 有别的 commit），先 `git fetch origin`、分析冲突。

- [ ] **步骤 10.6：主站 deploy.sh**

```powershell
$env:SSHPASS='+bp5XcF95o1RK;'
& 'C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Links\sshpass.exe' -e ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 root@47.82.151.0 'cd /opt/maer-energy && bash scripts/deploy.sh 2>&1'
```

预期：deploy 成功，Step 8 跑完新 migration（20260506-t12-drop-justlend），docker 重建，容器切换。

**注意坑**：上次发现主站 `/opt/maer-energy/scripts/deploy.sh` 是独立拷贝不是 symlink，外层的 deploy.sh 是入口；必须确认它**被更新过**（上次我已经手工同步过）。验证：

```
& $sshpass -e ssh ... "grep -c t12-drop /opt/maer-energy/scripts/deploy.sh"
```
预期：1

如果为 0，拉新 release 后拷过去：

```
cp /opt/maer-energy/current/scripts/deploy.sh /opt/maer-energy/scripts/deploy.sh
```
然后重跑 deploy.sh。

- [ ] **步骤 10.7：验证主站 DB 改动**

```powershell
$sql = "SELECT column_name FROM information_schema.columns WHERE table_name='energy_platform_config' ORDER BY column_name;"
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sql))
& $sshpass -e ssh ... "echo $b64 | base64 -d | docker exec -i maer-energy-postgres psql -U admin -d energybot -tA"
```

预期输出应包含 `platform_receive_address`，**不包含** `justlend_contract_address / justlend_payer_private_key / catfee_payer_private_key / energy_provider`。

同样验证 `energy_orders.energy_provider` 已被 DROP。

- [ ] **步骤 10.8：主站容器健康**

```
& $sshpass -e ssh ... "docker compose -p maer-energy -f /opt/maer-energy/current/docker-compose.prod.yml ps; curl -fsS http://127.0.0.1:13001/getHello"
```

预期：api unhealthy 但 HTTP 200（存量问题），UI healthy。

---

### 任务 11：测试机升级 + 用户验证

- [ ] **步骤 11.1：测试机 reinstall**

测试机（43.119.5.98）跑：

```bash
EBT_LICENSE_KEY=... EBT_LICENSE_SECRET=... \
  sh -c "curl -fsSL https://www.feiyijt.com/install.sh -o /tmp/install.sh && LICENSE_KEY=\$EBT_LICENSE_KEY LICENSE_SECRET=\$EBT_LICENSE_SECRET sh /tmp/install.sh --reinstall"
```

（参考上次的 `.tmp-reinstall.sh` 流程，读取 `/etc/energybot-agent/agent.env` 里已有 LICENSE 自动传入。）

- [ ] **步骤 11.2：验证 agent 版本与服务状态**

```bash
systemctl status energybot-agent --no-pager
grep -ao DispatchRequest /opt/energybot-agent/bin/energybot-agent | head -1
journalctl -u energybot-agent --no-pager -n 20
```

预期：
- agent active（T12 版本号会含 t12 tag）
- `DispatchRequest` 符号存在
- heartbeat 正常发送

- [ ] **步骤 11.3：用户前端手动验证（需用户协作）**

告知用户：

1. 浏览器登录 `https://www.feiyijt.com/`
2. 进入「能量租赁 → 平台配置」
3. 看到新的「**平台统一收款地址**」输入框
4. 填入合法 TRON 地址（T 开头 34 位），例如运营实际的收款钱包地址
5. 保存
6. 进入「我的 Bot」页面找到测试机 license_id=4 那条
7. 点「启动 Bot」
8. 预期：
   - 不再报「catfee_payer_private_key 未配置」错误
   - 状态变为 `running`
   - PID 非空
   - 最近 TG 拉取时间显示最近时间

- [ ] **步骤 11.4：日志验证**

测试机：

```bash
journalctl -u energybot-agent --no-pager -n 50 | grep -i "bot\|error\|apply"
ls -la /var/lib/energybot-agent/bot.db
```

预期：
- 看到 agent.applyConfig 成功日志
- 看到 bot supervisor 启动 bot 进程
- `bot.db` 已创建，大小 > 0

如果失败，查看 bot 进程的 journalctl：

```bash
journalctl -u energybot-agent --no-pager -n 100
```

---

## 自检清单

在开始执行前，我（计划作者）自己复核以下项：

### 1. 规格覆盖度
- ✅ 彻底拆 JustLend：任务 3-5、7-9
- ✅ 删除 Provider Recharge：任务 3 (步骤 3.4/3.5)、任务 8
- ✅ 新增 platform_receive_address 字段：任务 1、2、6、7
- ✅ `go-bot/` 旧目录不动：未列入任何任务
- ✅ UI provider 选择器保留结构但只剩 catfee：任务 7 步骤 7.2
- ✅ bot 端 SQLite 仅 ADD：任务 4 步骤 4.1
- ✅ SQL fallback 改 catfee：任务 4、5
- ✅ 一个大 commit：任务 10 步骤 10.4

### 2. 类型一致性
- `platformReceiveAddress` 字段命名：schema（snake_case `platform_receive_address`）、drizzle（camelCase `platformReceiveAddress`）、DTO（camelCase）、UI form control（camelCase）、go-bot-v2 JSON tag `json:"platformReceiveAddress"`、SQLite 列 `platform_receive_address` — **一致**
- `energyProvider` 在 bot 端 SQLite 保留（COALESCE default 改 catfee），nest-api + UI 完全删除 — **差异刻意为之**，记录在任务 4.4 决策注释

### 3. 占位符扫描
- ❌ 任务 2.1 TDD 测试示例代码有 `'TPlatformAddr123...'` 占位符 — **OK**，这是 fixture 地址，上下文清楚
- ❌ 任务 5.3 的 "~L1103" 行号是估算 — **OK**，执行时工程师应搜函数名精确定位
- 无"TODO 后续实现"、"添加适当错误处理"等空洞描述

### 4. 高风险点提醒
- **任务 3.4 删除 `buildProviderRechargeContext`** 时，要同步搜索 `recharge` 关键字确保没有遗留调用点
- **任务 6.4 bot.go energy_orders INSERT**：必须处理 SQLite NOT NULL 约束（建议 INSERT 写死 'catfee'）
- **任务 10.6 主站 deploy.sh 外层拷贝问题**：上次发现的坑，本次仍需验证
- **任务 10.5 merge ff-only**：可能失败（origin/main 有其他 commit），要提前 fetch 检查

---

## 执行交接

**计划已完成并保存到 `docs/superpowers/plans/2026-05-06-t12-drop-justlend-and-provider-recharge.md`。**

两种执行方式：

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

**选哪种方式？**
