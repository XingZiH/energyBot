# 能源租赁机器人：License 颁发 + 一键部署脚本（子系统 A）

**起草日期**：2026-05-03
**涉及范围**：后端 `nest-api/` + 前端 `ui/` + 部署脚本 `scripts/install.sh` + 生产 nginx
**关联后续**：子系统 B（远程控制）基于本阶段颁发的 license 构建，见"后续工作"章节

---

## 1. 背景

EnergyBot 目前是内部工具：管理员在 UI 里手改 `agent_bot_configs` 表，后台 Go bot 读配置连 Telegram。没有客户隔离，没有对外交付。

现在业务要做产品化：

> 客户下载一条一键部署命令到自己的服务器 → 跑完后连回我们的 SaaS → 在 SaaS UI 里配 token / 启停 bot。

这是完整闭环 "Bot-as-a-Service 自托管 agent 平台"。按风险控制和价值递送速度，**本规格只覆盖子系统 A**：

| 子系统 | 本规格包含 | 说明 |
|---|---|---|
| A: License 颁发 | ✅ | 后台新增客户 → 发 license key → 客户跑 install.sh → 写到客户机磁盘 |
| B: 远程控制 | ❌（下一规格） | Agent 进程、WSS 反向通道、token 热更新、启停指令 |

**子系统 A 独立可用**：完成后，管理员可以给客户发一行命令，客户能在自己机器上装好 Docker 与 license 文件，留待 B 上线时无缝接入。

---

## 2. 成功标准

1. 管理员在 UI "客户管理" 页新建客户 → 抽屉一次性显示 license key、license secret、完整 install.sh 一行命令，可复制。
2. 客户拷贝命令到自己 Linux 服务器（Ubuntu 20+/Debian 11+/CentOS 8+/Rocky/Alma/阿里 Linux，x86_64 或 aarch64）粘贴运行 → 以下事件全部发生：
   - 检测到 Docker，装或跳过
   - 把 license 信息落到 `/etc/energybot/license.conf`（权限 600）
   - 向中心发一次 HMAC 签名的 `precheck` 请求，中心返回 200 证明凭据有效
   - 控制台输出一段彩色成功提示 + "下一步："等说明
3. license 吊销后，客户再次跑 install.sh → 中心返回 401，脚本打印明确错误并退出非 0。
4. 所有新增后端接口都走 JwtGuard + AuthGuard + `@Permission` 三件套，permission code = `default:system:customers[:add|:revoke|:reveal]`。Role 1 自动获得；其他角色不得访问。
5. 前端新增 262 → 262+X 个 karma spec 全绿；后端 jest 增量 spec 全绿。
6. 部署：CF Origin Cert 部署 + cardshop nginx 加 `www.feiyijt.com` 虚拟主机 + `install.sh` 挂载 + maer-energy UI 端口收口。**用户从 `https://www.feiyijt.com/` 访问到 UI，旧 `47.82.151.0:18080` 过渡 30 天。**

---

## 3. 数据模型

### 3.1 新增两张表

新增到 `nest-api/src/drizzle/schema.ts`：

```ts
/**
 * 客户——对外交付的独立主体。一客户当前限发一张 license（MVP）。
 * 吊销走 status='suspended' 或 licenses.revoked_at，不做物理删除。
 */
export const customersTable = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  contact: varchar('contact', { length: 200 }),  // 邮箱/手机/微信号，自由格式
  status: varchar('status', { length: 20 }).notNull().default('active'),  // active / suspended / deleted
  remark: text('remark'),
  createdBy: integer('created_by').notNull(),  // sys_user.id
  createdAt: timestamp('created_at', { precision: 3 }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { precision: 3 }).defaultNow().notNull(),
});

/**
 * License 凭据。一客户可多张 license（MVP 只发一张，但模型支持未来多）。
 * key   : 对外的字符串标识，format "ebt_" + base58(24 random bytes) = 37 字符
 * secret: 共享密钥，仅签发时原文返回一次；后续通过 HMAC 签名校验 secret_hash
 */
export const licensesTable = pgTable('licenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customersTable.id, { onDelete: 'cascade' }),
  licenseKey: varchar('license_key', { length: 40 }).notNull().unique(),
  secretHash: varchar('secret_hash', { length: 64 }).notNull(),  // SHA-256(secret)
  issuedAt: timestamp('issued_at', { precision: 3 }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { precision: 3 }),
  lastBoundAt: timestamp('last_bound_at', { precision: 3 }),
  issuedBy: integer('issued_by').notNull(),  // sys_user.id
  remark: text('remark'),
});
```

**索引**：
- `customers.status` — 列表过滤频繁
- `licenses.customer_id` — join
- `licenses.license_key` — 唯一（已通过 `.unique()` 自动建）

### 3.2 Migration 文件

`nest-api/sql/20260503-customers-and-licenses.sql`：
- `BEGIN; CREATE TABLE customers ... ; CREATE TABLE licenses ... ; CREATE INDEX ...; COMMIT;`
- 含完整中文 docblock 说明每列用途
- 无 down 脚本（遵循仓库既定惯例）
- 预写好 `INSERT INTO sys_permission` 两行追加 `default:system:customers` / `:add` / `:revoke` 三个 permission code（迁移里手动补，因为业务上这些和表同生命周期）
- 再追加 `INSERT INTO sys_role_perm` 把三个 code 绑到 role_id=1（平台管理员）

### 3.3 为何使用 UUID 而非自增 int

- 后续发给客户的 license_key 基于独立随机串，不暴露 customer_id；**customers.id 外泄不泄密**，但也不必让客户看到递增数字推断用户规模
- 与现有表 `sys_user.id = integer identity` 不冲突，新表独立使用 UUID 是符合行业惯例的做法

---

## 4. License 格式与 HMAC 协议

### 4.1 license key 生成

```
key     = "ebt_" + base58(24 random bytes from crypto.randomBytes)
          → 4 + 33 = 37 字符左右；base58 避开 0 O I l 歧义字符
secret  = base64url(32 random bytes)
          → 43 字符 URL 安全字符集
secret_hash = sha256(secret) in hex → 64 字符
```

- key 存明文入库（方便管理员在后台页看到）
- secret **只在签发时返回一次**，UI 明示"离开本页后无法再看到"
- 库里只存 `secret_hash`

### 4.2 客户端如何用 secret 签名

install.sh 首次执行的 `precheck`：

```
POST https://www.feiyijt.com/api/v1/license/precheck
Headers:
  Content-Type: application/json
  X-License-Key: ebt_xxx
  X-Timestamp:   <unix-ms>
  X-Nonce:       <16 random bytes hex>
  X-Signature:   HMAC-SHA256(secret, "${method}\n${path}\n${timestamp}\n${nonce}\n${body_sha256}")
Body:  { "hostname": "...", "os": "...", "arch": "..." }
```

**签名算法**（Cloudflare / AWS 风格）：
- 规范串 = `POST\n/api/v1/license/precheck\n1714723456789\na3f5...\n<sha256-hex of body>`
- HMAC-SHA256(secret, 规范串) → hex lowercase
- `body_sha256` 空 body 约定为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`（空串 sha256）

**中心校验**：
1. 从 `license_key` 查 license，未找到 → 401
2. 若 `revoked_at` 非空 → 401（`{"error":"license_revoked"}`）
3. 若 `customer.status !== 'active'` → 401
4. 取 `secret_hash`，但**校验时不解原始 secret**——而是将**请求里附带的 secret 再 sha256 比 hash** 以复刻签名？—— ❌ 不行，请求里不传 secret 明文
5. **真正做法**：server 必须能知道原 secret 才能签名 ✋ 重算
   - 方案 A：secret 明文存库（加密存）。每次校验时解密
   - 方案 B：secret_hash 存 SHA256，server 不知道原 secret，无法签名验
   - **选方案 A**：secret 用 `LICENSE_SECRET_ENC_KEY`（env）AES-256-GCM 加密后存 `licenses.secret_cipher`（bytea 字段，schema 调整）
6. 重放防护：同一 (key, timestamp, nonce) 不得复用，维护 **内存 LRU nonce cache**（TTL 10 分钟），超 5 分钟偏差的 timestamp 直接拒

**调整 3.1 schema**：`licenses` 表新增 `secretCipher: bytea('secret_cipher').notNull()`，移除 `secretHash`（因为 A 方案不需要）。理由：HMAC 双向算法需要服务端拥有明文。

### 4.3 为什么 HMAC 而不是 JWT

- 不需要服务端签发后给客户带 token；license 本身是持久凭据
- HMAC 轻量，无需公钥基础设施
- 与 agent 复用：B 阶段 agent 注册 + WSS 握手全都走同一把 secret + HMAC

---

## 5. 后端 API 设计

### 5.1 新模块结构

```
nest-api/src/modules/
├── customer/
│   ├── customer.module.ts
│   ├── customer.controller.ts
│   ├── customer.service.ts
│   ├── customer.service.spec.ts
│   ├── customer.controller.spec.ts
│   └── dto/
│       ├── customer.dto.ts
│       └── customer.dto.spec.ts
└── license/
    ├── license.module.ts
    ├── license.controller.ts           # /license/precheck 供客户机调用
    ├── license.public.controller.ts     # 上条的别名：明确"无 JWT"的公共端点单独文件
    ├── license.service.ts
    ├── license.service.spec.ts
    └── dto/license.dto.ts
```

同时新增公共工具：

```
nest-api/src/common/
├── crypto/
│   ├── hmac.util.ts          # signHmac / verifyHmac
│   ├── hmac.util.spec.ts
│   ├── aes-gcm.util.ts       # encrypt / decrypt 固定主密钥
│   ├── aes-gcm.util.spec.ts
│   ├── base58.util.ts        # Bitcoin base58 编码（license key 生成）
│   ├── base58.util.spec.ts
│   └── license-key.util.ts   # 组合：生成 key + secret + cipher
└── nonce/
    ├── nonce-cache.service.ts   # 内存 LRU TTL 10 分钟
    └── nonce-cache.service.spec.ts
```

### 5.2 API 端点清单

| Method | Path | 认证 | Permission | 作用 |
|---|---|---|---|---|
| POST | `/customers/create` | JwtGuard+AuthGuard | `default:system:customers:add` | 新建客户 + 自动发一张 license；响应含 secret 明文（仅此一次） |
| POST | `/customers/list` | JwtGuard+AuthGuard | `default:system:customers` | 分页列表，可按 name/status/createdAt 搜索 |
| GET | `/customers/:id` | JwtGuard+AuthGuard | `default:system:customers` | 详情含 license list（**不返回 secret**） |
| PUT | `/customers/update` | JwtGuard+AuthGuard | `default:system:customers:edit` | 改 name/contact/remark（不改 license） |
| POST | `/customers/:id/revoke-license` | JwtGuard+AuthGuard | `default:system:customers:revoke` | 吊销 license（不物理删客户） |
| POST | `/customers/:id/reissue-license` | JwtGuard+AuthGuard | `default:system:customers:revoke` | 吊销旧 license 同时生成新 license，返回新 secret |
| GET | `/customers/:id/install-command` | JwtGuard+AuthGuard | `default:system:customers:reveal` | 客户每次需要重发安装命令时调用；返回 install.sh 一行命令（含 key 但**不含 secret**——secret 只在 create/reissue 时返回） |
| POST | `/api/v1/license/precheck` | **无 JWT** | 无 | 客户机 install.sh 调用，HMAC 签名校验 |

注意：
- `/api/v1/` 前缀**仅** precheck 端点用——因为这是对外公开接口，与内部管理接口保持物理和语义分离
- 内部管理接口沿用现有惯例，无 `/api/v1/` 前缀
- **全局 ValidationPipe 必须在 `main.ts` 里开启**——这是顺带修复的 repo bug，不开会导致 class-validator 被忽略

### 5.3 响应形状

遵循现有 `ResultData.success(...)` 惯例。

**POST /customers/create 响应：**
```json
{
  "code": 200,
  "msg": "SUCCESS",
  "data": {
    "customer": { "id": "uuid", "name": "...", "contact": "...", "status": "active", "createdAt": "..." },
    "license": {
      "id": "uuid",
      "licenseKey": "ebt_abcd1234...",
      "licenseSecret": "xYz123...",       // ⚠️ 仅此一次出现
      "installCommand": "curl -fsSL https://www.feiyijt.com/install.sh | LICENSE_KEY=ebt_abcd1234... LICENSE_SECRET=xYz123... sh",
      "issuedAt": "..."
    },
    "warning": "license_secret 只会在此处显示一次，请立即复制保存"
  }
}
```

**POST /api/v1/license/precheck 响应：**
- 成功 200：`{ code: 200, msg: "SUCCESS", data: { customer_name: "...", server_time: 1714723456789 } }`
- 签名错 401：`{ code: 401, msg: "signature_invalid", data: null }`
- 吊销 401：`{ code: 401, msg: "license_revoked", data: null }`
- 客户 suspended 401：`{ code: 401, msg: "customer_suspended", data: null }`
- 时间偏移过大 401：`{ code: 401, msg: "clock_skew", data: null }`
- Nonce 复用 401：`{ code: 401, msg: "nonce_replayed", data: null }`

### 5.4 环境变量

新增到 `.env` 样例 + Joi schema：

```env
# License secret 加密主密钥（base64, 32 bytes = 44 字符 base64）
LICENSE_SECRET_ENC_KEY=<openssl rand -base64 32>

# 允许的签名时间窗口（秒），默认 300
LICENSE_CLOCK_SKEW_SEC=300

# Nonce 缓存容量和 TTL
LICENSE_NONCE_CACHE_SIZE=10000
LICENSE_NONCE_TTL_SEC=600
```

---

## 6. install.sh 设计

### 6.1 存放位置

- 源码：仓库 `scripts/install.sh`
- 生产投放：宿主机 `/opt/maer-energy/public/install.sh`
- 分发路径：`https://www.feiyijt.com/install.sh` → cardshop nginx 通过 `alias /var/www/feiyijt-public/install.sh;`

### 6.2 命令行契约

```bash
# 标准形式（从 UI 复制）
curl -fsSL https://www.feiyijt.com/install.sh | LICENSE_KEY=ebt_xxx LICENSE_SECRET=yyy sh

# 交互模式（无环境变量，脚本 read 两次）
curl -fsSL https://www.feiyijt.com/install.sh | sh

# 仅验证（不装 Docker）
curl ... | VERIFY_ONLY=1 sh

# 重装
curl ... | sh -s -- --reinstall

# 卸载（本阶段保留接口，留给 B 阶段实现真实逻辑）
curl ... | sh -s -- --uninstall
```

### 6.3 执行步骤（本阶段）

1. **参数解析**：`set -eu`；trap ERR 处理；参数/env 解析
2. **系统自检**：root?、systemd?、发行版识别（cat /etc/os-release）、arch（uname -m）、磁盘（df / 可用 ≥ 2GB）、内存（free / ≥ 512MB）
3. **网络自检**：`curl -sf https://www.feiyijt.com/api/v1/health` 返 200
4. **License 交互**（若无 env）：`read -r LICENSE_KEY; stty -echo; read -r LICENSE_SECRET; stty echo`
5. **License precheck**：HMAC 签名 + 发 POST。Bash 里的 HMAC：
   ```bash
   body='{"hostname":"'"$(hostname)"'","os":"'"$os"'","arch":"'"$arch"'"}'
   body_sha=$(printf '%s' "$body" | openssl dgst -sha256 -hex | cut -d' ' -f2)
   ts=$(date +%s%3N)   # milliseconds
   nonce=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
   canonical="POST\n/api/v1/license/precheck\n$ts\n$nonce\n$body_sha"
   sig=$(printf '%b' "$canonical" | openssl dgst -sha256 -hmac "$LICENSE_SECRET" -hex | cut -d' ' -f2)
   curl -sS -X POST -H "X-License-Key: $LICENSE_KEY" -H "X-Timestamp: $ts" -H "X-Nonce: $nonce" -H "X-Signature: $sig" -H "Content-Type: application/json" -d "$body" https://www.feiyijt.com/api/v1/license/precheck
   ```
   返回非 200 → 打印错误 + exit 1
6. **装 Docker**（若 `docker info` 失败）：`curl -fsSL https://get.docker.com | sh`，新加坡源直连
7. **落地 license**：
   ```
   mkdir -p /etc/energybot && chmod 700 /etc/energybot
   cat > /etc/energybot/license.conf <<EOF
   LICENSE_KEY=$LICENSE_KEY
   LICENSE_SECRET=$LICENSE_SECRET
   SERVER_URL=https://www.feiyijt.com
   CUSTOMER_NAME=$CUSTOMER_NAME_FROM_PRECHECK
   INSTALLED_AT=$(date -Iseconds)
   EOF
   chmod 600 /etc/energybot/license.conf
   ```
8. **输出成功信息**（彩色）：
   ```
   ╔════════════════════════════════════════════╗
   ║  ✅ EnergyBot 准备就绪                       ║
   ║  客户：$CUSTOMER_NAME                        ║
   ║  License 已写入 /etc/energybot/license.conf ║
   ║                                              ║
   ║  ⏭  下一步：在控制台配置机器人 Token        ║
   ║  🔗  https://www.feiyijt.com/               ║
   ║                                              ║
   ║  ℹ️  Agent 进程功能开发中（预计 2 周）        ║
   ║      当前阶段已完成凭据落地，agent 发布后    ║
   ║      本服务器将自动接入控制台                ║
   ╚════════════════════════════════════════════╝
   ```

### 6.4 失败回滚

任何步骤失败：
- 若步骤在 "落地 license" 之前 → 简单退出，不留痕
- 若已落 license 但后续失败 → 保留 license 文件（下次 `--reinstall` 重用）
- 全程 `tee /var/log/energybot-install.log`

### 6.5 幂等

- `docker info` 成功 → 跳 Docker 安装
- `/etc/energybot/license.conf` 存在 → 若 key 与当前一致视为幂等成功；若 key 不一致 → 报错要求 `--uninstall` 再重装
- `precheck` 每次都走（验证 license 仍有效）

### 6.6 shellcheck 约束

- 通过 `shellcheck --severity=warning scripts/install.sh` 无 warning
- 用 POSIX `sh` 而非 `bash`——适配 Alpine 等 minimal 系统
- 所有变量展开加双引号
- `set -eu`（不开 `pipefail`，因为要兼容 POSIX sh；改用显式检查）

### 6.7 跨发行版要点

| 发行版 | 要处理 |
|---|---|
| Ubuntu / Debian | apt-based；get.docker.com 脚本覆盖 |
| CentOS 8 / Rocky / Alma | dnf；get.docker.com 覆盖 |
| 阿里 Linux 3 | yum；get.docker.com 支持 |
| openSUSE | zypper；get.docker.com 支持 |

arch：amd64 / arm64 均适用（阶段 A 不拉镜像，发行版兼容即可）。

---

## 7. 前端 UI 设计

### 7.1 放置位置

根据调研结论，放在 `/default/system/customers`，属管理员后台：
- 路由文件：`ui/src/app/pages/system/system-routing.ts` 新加一条
- 页面：`ui/src/app/pages/system/customers/customers.component.ts` + `.html`
- 新建/重发 modal：`ui/src/app/widget/biz-widget/system/customer-modal/`
- HTTP service：`ui/src/app/core/services/http/system/customer.service.ts`

### 7.2 客户管理列表页

- `<app-page-header>` 标题 "客户管理" + 描述 "为外部客户颁发部署凭据"
- 搜索表单：`name` 模糊 + `status` 枚举
- "新增客户" 按钮（带 `*appAuth="'default:system:customers:add'"`）
- 表格列：客户名 / 联系方式 / 状态（Badge） / License 状态（有 / 已吊销） / 创建人 / 创建时间 / 操作
- 操作列：
  - 详情（drawer）
  - 重发安装命令（drawer 含复制按钮，**只带 key 不带 secret**，注明"仅 secret 可用时"）
  - 吊销 license（`NzModalService.confirm`）
  - 重置 license（`NzModalService.confirm` → 抽屉显示新 secret 与命令，**只此一次**）

### 7.3 新增客户 modal

- 表单：name（required, min 2）、contact（optional）、remark（optional textarea）
- 提交后：关闭 modal → 打开**一次性凭据抽屉**（新组件 `license-credential-drawer`）
- 抽屉内容：
  - 大字显示 `licenseKey`（等宽字体） + 复制按钮
  - 大字显示 `licenseSecret` + 复制按钮 + 🔴 红色提醒 "secret 只此一次可见"
  - 完整 `installCommand`（等宽 + 复制按钮）
  - 底部"我已妥善保存" CTA 按钮 → 才允许关闭

### 7.4 一次性凭据组件（新）

`ui/src/app/shared/biz-components/license-credential-drawer/`

功能：
- 展示 key / secret / install command
- 每个字段支持 "复制" + "已复制" 反馈
- 使用 `@angular/cdk/clipboard`
- 关闭抽屉需确认（防误关）
- 不做 "点击后显示" 遮罩（因为本身就是刚生成的信息，用户此时最需要立即看到；遮罩反而增加一次操作）

### 7.5 菜单注册（开发期走 MSW mock）

- `src/mocks/business/menu.ts`：在系统管理 fatherId=6 下加一条 `{ path: '/default/system/customers', code: 'default:system:customers', menuName: '客户管理', icon: 'user-add' }`
- `src/mocks/business/permission.ts`：给 role 1 加三条 code（`default:system:customers`, `:add`, `:revoke`, `:reveal`, `:edit`）
- `public/i18n/*.json`：加 `menu.default:system:customers` 等 key
- 生产时：上述数据由 `20260503-customers-and-licenses.sql` migration 同时 INSERT

### 7.6 i18n

新增键（所有 4 种语言）：
- `menu.default:system:customers`: "客户管理" / "Customer Management" / "客戶管理" / "Quản lý khách hàng"
- `customer.secret.warning`: "License Secret 仅此一次可见，请立即复制保存" / ...
- `customer.action.revoke.confirm`: "吊销后该客户所有服务器将断开连接，确定吗？"
- `customer.action.reissue.confirm`: "重置会生成新的 license secret，旧 secret 立即失效"
- `customer.status.active`: "活跃"
- `customer.status.suspended`: "已暂停"
- `customer.license.revoked`: "已吊销"

---

## 8. 网络接入（§5 修订版）

接入 cardshop nginx 共享 443 + Cloudflare 终结 TLS。

### 8.1 Cloudflare 配置

- `www.feiyijt.com` A 记录指 `47.82.151.0`，proxied on（橙云）
- SSL/TLS mode = Full (strict)
- Network → WebSockets = On（为 B 阶段预留）
- Origin Server → Create Certificate：SAN `*.feiyijt.com, feiyijt.com`，15 年期
- 证书落宿主机：`/etc/nginx/ssl/feiyijt.com.crt` 644 root；`/etc/nginx/ssl/feiyijt.com.key` 600 root

### 8.2 cardshop nginx 新配置

新建文件：`/etc/nginx/conf.d/www-feiyijt.conf`（docker exec 进 cardshop-app 容器写入，或 bind-mount）

```nginx
server {
  listen 80;
  listen 443 ssl;
  server_name www.feiyijt.com;

  ssl_certificate     /etc/nginx/ssl/feiyijt.com.crt;
  ssl_certificate_key /etc/nginx/ssl/feiyijt.com.key;

  client_max_body_size 10m;

  # 一键安装脚本（本阶段 A 核心交付）
  location = /install.sh {
    alias /var/www/feiyijt-public/install.sh;
    default_type text/x-shellscript;
    add_header Cache-Control "no-store";
  }

  # Angular UI（maer-energy-ui 容器内的 /ng-antd-admin/）
  location / {
    proxy_pass http://host.docker.internal:18080/ng-antd-admin/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Real-IP $remote_addr;
  }

  # REST API
  location /api/ {
    proxy_pass http://host.docker.internal:13001/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 60s;
  }

  # B 阶段预留：WSS
  location /ws/ {
    proxy_pass http://host.docker.internal:13001/ws/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }
}
```

### 8.3 cardshop-app bind-mount

修改 cardshop-app compose 或 docker run，新增 volume：
```yaml
volumes:
  - /opt/maer-energy/public:/var/www/feiyijt-public:ro
```

若 cardshop 用 `docker run`（非 compose），则 `docker update --add-volume` 不可用，需 `docker stop && rm && run` 重建。预期 downtime ≤ 30s，选低峰时段。

### 8.4 maer-energy compose 收口

`docker-compose.yml` 中：
- `ui` 服务 `ports: ["0.0.0.0:18080:80"]` → `ports: ["127.0.0.1:18080:80"]`
- `api` 已经是 `127.0.0.1:13001`，不动

这样外网无法直接访问 18080（18080 只本机可达），只能走 cardshop nginx 反代。

老访问 `http://47.82.151.0:18080/ng-antd-admin/` 将失效——但这个 URL 本来就是你开发时用的临时地址，切完你通过 `https://www.feiyijt.com/` 访问。

---

## 9. 测试策略

### 9.1 后端单元测试

每个新文件都有 `.spec.ts`：

| 测试对象 | 重点验证 |
|---|---|
| `base58.util.spec.ts` | 编码往返；拒绝非法字符；长度 |
| `aes-gcm.util.spec.ts` | 加解密往返；密文不同每次（IV 随机）；错误 key 解密失败 |
| `hmac.util.spec.ts` | 签名确定性；timing-safe 比较；空 body 处理 |
| `license-key.util.spec.ts` | key 格式正则；secret 长度；两次生成不重复 |
| `nonce-cache.service.spec.ts` | 添加、重复检测、TTL 过期、LRU 淘汰 |
| `license.service.spec.ts` | precheck：成功、签名错、时钟偏移、吊销、客户 suspended、nonce 重放 |
| `license.controller.spec.ts` | HTTP 层：对请求 header 的提取、响应 shape、异常转换 |
| `customer.service.spec.ts` | 新建 + 自动发 license、吊销、重发、列表分页、update |
| `customer.controller.spec.ts` | 权限（通过 guard mock）、DTO 校验、状态码 |
| `customer.dto.spec.ts` | class-validator 规则（name minlength, etc.） |

所有用 jest 直接 `new Service(mockConn as never)` 风格，与现有 `energy-rental.service.spec.ts` 一致。

### 9.2 前端单元测试

| 测试对象 | 重点验证 |
|---|---|
| `customer.service.spec.ts` | HTTP 调用 URL 正确；参数正确；POST list 形状 |
| `customers.component.spec.ts` | 渲染列表；搜索触发 getDataList；操作按钮点击打开 modal |
| `customer-modal.component.spec.ts` | 表单校验；提交返回值；取消行为 |
| `license-credential-drawer.component.spec.ts` | 显示三段凭据；复制按钮；关闭确认 |

期望 262 → 290+ specs 全绿。

### 9.3 install.sh 测试

- `shellcheck --severity=warning scripts/install.sh` 零 warning
- 在 macOS 上本地 **mock** precheck endpoint，用 nc 或 node express 起个 server 跑几种场景验证脚本行为（成功 / 401 / 5xx / 网络断开）
- 写 `scripts/install.sh.bats.txt` 记录手工测试步骤（不引入 bats 依赖，纯 markdown）

### 9.4 E2E（本阶段跳过）

E2E playwright 的 "管理员新建客户 → 看到 license" 流程推到 B 阶段。

---

## 10. 上线流程

### 10.1 分阶段部署

**阶段 0：本地验证**
1. 所有 jest + karma spec 全绿
2. `npm run build`（nest-api）+ `npm run build`（ui）成功
3. `shellcheck scripts/install.sh` 零 warning
4. 手工 curl precheck 在本地起的 mock server 通

**阶段 1：准备凭据**（不动生产）
1. 生成 `LICENSE_SECRET_ENC_KEY`：`openssl rand -base64 32`
2. 写入生产 env：`/opt/maer-energy/shared/api.env` 加一行 `LICENSE_SECRET_ENC_KEY=...`
3. 用户准备 CF Origin Cert + DNS 记录（见 §8.1）
4. 用户把 cert 两个文件发给我，我上传到 `/etc/nginx/ssl/feiyijt.com.{crt,key}`

**阶段 2：应用数据库 migration**
1. SSH 到生产：`docker exec maer-energy-postgres psql -U energybot -d energybot < /tmp/20260503-customers-and-licenses.sql`
2. 验证：`\dt customers licenses` 看到两表；`SELECT ... FROM sys_permission WHERE code LIKE '%customers%'` 看到三条

**阶段 3：部署新 API + UI（流量尚未切换）**
1. 按现有流程：`rsync` → `docker compose -p maer-energy build ui api` → `up -d --force-recreate`
2. 新 UI 走 `127.0.0.1:18080`，外部还访问不到；原 `47.82.151.0:18080` 断开是预期
3. API 仍通过 `127.0.0.1:13001` 对本机可达；`curl -H "Authorization: ..." localhost:13001/customers/list` 验证管理端 OK
4. 在本机 `curl -X POST localhost:13001/api/v1/license/precheck ...` 验证 HMAC 对齐

**阶段 4：激活 cardshop nginx**
1. 修改 cardshop-app bind-mount（docker-compose edit 或 docker rm+run），加 `/opt/maer-energy/public:/var/www/feiyijt-public:ro`
2. 把 `www-feiyijt.conf` 放进 cardshop-app 容器 `/etc/nginx/conf.d/`
3. `docker exec cardshop-app nginx -t` 通过
4. `docker exec cardshop-app nginx -s reload`
5. `curl https://www.feiyijt.com/` 获取 UI → 通过
6. `curl https://www.feiyijt.com/install.sh` 看到脚本内容 → 通过
7. `curl -X POST https://www.feiyijt.com/api/v1/license/precheck ...` 走真实链路签名校验 → 通过

**阶段 5：用户验收**
1. 登录 `https://www.feiyijt.com/`，进入"客户管理"（需是 role=1 平台管理员）
2. 点"新增客户"，填"测试客户 A"
3. 看到凭据抽屉，复制 install 命令
4. 找一台隔离的 VPS 或 docker run 一个 ubuntu 容器，粘贴运行
5. 看到"✅ EnergyBot 准备就绪"
6. 回后台，点"吊销 license"，再在远端跑 `--reinstall` → 期望 401 错误

**阶段 6：关 18080 裸端口（30 天后）**
- 阿里云安全组关 18080
- 删除老访问指引

### 10.2 回滚策略

任何阶段失败：
- 阶段 2 失败 → SQL 里写了完整 `DROP TABLE customers, licenses; DELETE FROM sys_permission WHERE code LIKE '%customers%'; DELETE FROM sys_role_perm WHERE perm_id IN (...)` 回滚脚本，放 `nest-api/sql/rollback/20260503-customers-and-licenses.rollback.sql`
- 阶段 3 失败 → 恢复 `dist.bak-<ts>`（既有流程）
- 阶段 4 失败 → cardshop nginx.conf 回退 + reload

---

## 11. 安全注意事项

| 风险 | 防护 |
|---|---|
| secret 明文入库 | AES-256-GCM 加密 + `LICENSE_SECRET_ENC_KEY` 独立管理；日志脱敏 |
| secret 请求过程泄漏 | 全程 HTTPS + HMAC 不传 secret 本身 |
| 重放攻击 | X-Timestamp 5 分钟窗口 + X-Nonce 10 分钟 LRU 缓存 |
| 管理员权限误授 | `default:system:customers:*` 只绑 role_id=1；前端 `*appAuth` + 后端 guard 双重 |
| install.sh 被篡改 | HTTPS 分发 + 宿主机只读 mount + SHA256 指纹（未来可加，本阶段不做） |
| 一次性 secret 泄漏窗口 | 管理员只能在创建/重置时看到；DB 不存明文；UI 做防截图提示（本阶段可省略） |
| 暴力穷举 license_key | key 熵 ≥ 192 bits 远超可猜空间；加 rate-limit（未来做，本阶段 precheck 未做） |

---

## 12. 不做的事（明确划界）

- ❌ agent 进程、WSS 通道、docker.sock 管 bot 容器 → B 阶段
- ❌ bot token 在 UI 配置 / 下发 → B 阶段
- ❌ 客户自助注册门户 / 付费 / 账单 → 未来产品化阶段
- ❌ 多租户 RBAC（让客户管理自己的子账号） → 未来
- ❌ 客户日志 / 状态 / 指令历史上报 → B 阶段
- ❌ license SHA256 指纹校验 install.sh 防篡改 → 未来
- ❌ rate-limit / WAF rule for precheck → 待观察攻击量再补

---

## 13. 后续工作（提前列出以防遗忘）

B 阶段新增：
- `agents` 表 + `agent_commands` 表
- agent Go 模块（`agent/cmd/agent/main.go`）+ Dockerfile + GitHub Actions + ghcr
- `/api/v1/agent/register` 首次握手端点
- WSS `/ws/agent` + NestJS WebSocket gateway + connection manager
- UI "机器人详情" 页：token 配置（reveal-once 写 + 加密传输）、启停按钮、实时状态
- cmd 协议完整实现
- install.sh 增加拉 agent 镜像 + systemd unit 部分

---

## 14. 相关文件清单

**本阶段新增**：
- `nest-api/src/modules/customer/` (7 文件)
- `nest-api/src/modules/license/` (5 文件)
- `nest-api/src/common/crypto/` (8 文件)
- `nest-api/src/common/nonce/` (2 文件)
- `nest-api/sql/20260503-customers-and-licenses.sql`
- `nest-api/sql/rollback/20260503-customers-and-licenses.rollback.sql`
- `ui/src/app/pages/system/customers/customers.component.{ts,html,spec.ts}`
- `ui/src/app/widget/biz-widget/system/customer-modal/customer-modal.component.{ts,html,spec.ts}`
- `ui/src/app/widget/biz-widget/system/customer-modal/customer-modal.service.ts`
- `ui/src/app/shared/biz-components/license-credential-drawer/` (3 文件)
- `ui/src/app/core/services/http/system/customer.service.{ts,spec.ts}`
- `scripts/install.sh`
- `deploy/www-feiyijt.conf`（将放入 cardshop nginx）
- `docs/superpowers/specs/2026-05-03-license-and-install-design.md`（本文）
- `docs/superpowers/plans/2026-05-03-license-and-install-plan.md`（实现计划）
- `docs/客户运维手册.md`

**本阶段修改**：
- `nest-api/src/drizzle/schema.ts` — 加两表
- `nest-api/src/main.ts` — 启用 ValidationPipe（顺带修 repo bug）
- `nest-api/src/modules/api-modules.module.ts` — 注册两新模块
- `nest-api/src/common/config/config.module.ts` — Joi schema 加 `LICENSE_SECRET_ENC_KEY`
- `nest-api/src/enum/config.enum.ts` — 加 LICENSE_* 常量
- `ui/src/app/pages/system/system-routing.ts` — 加 customers 路由
- `ui/src/mocks/business/menu.ts` — 加客户管理菜单节点
- `ui/src/mocks/business/permission.ts` — 给 role 1 加 permissions
- `ui/public/i18n/{zh_CN,en_US,zh_TW,vi_VN}.json` — 加 i18n key
- `ui/src/app/config/actionCode.ts` — 加 customer action codes
- `docker-compose.yml` — ui 端口 0.0.0.0 → 127.0.0.1
- `.env.example` — 加 LICENSE_* 说明

---

## 15. 规格自检

| 检查项 | 结果 |
|---|---|
| 占位符 | 无 `TBD` / `TODO`；所有决策已定 |
| 矛盾 | §4.1 最初写 secret_hash，§4.2 修正为 secret_cipher 并解释原因 |
| 范围 | 本规格只覆盖子系统 A；B 阶段明确划出 |
| 模糊性 | install.sh 的 bash vs sh 已在 §6.6 定为 POSIX sh |
| 秘密管理 | `LICENSE_SECRET_ENC_KEY` 生成与投放明确；Origin Cert 由用户准备 |
| 安全 | HMAC + 时钟 + nonce + AES-GCM + 权限四重 |
| 回滚 | 每阶段都有回滚脚本 |
| 测试覆盖 | 后端每文件 .spec.ts；前端 4 新 spec；shellcheck |
| 向前兼容 B | licenses 表、HMAC 协议、precheck 端点，B 全部复用 |
