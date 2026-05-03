# 实现计划：License 颁发 + 一键部署脚本

**依据规格**：`docs/superpowers/specs/2026-05-03-license-and-install-design.md`
**起草日期**：2026-05-03
**执行方式**：一次会话连续执行，不按 PR 拆分（用户明确要求）
**验证关卡**：每个模块完成立即跑对应单测，最终全量验证

---

## 任务批次

### Batch 1 · 后端基础设施（并行可做，无相互依赖）

1. 加密工具套件
2. Schema 变更
3. 配置与 env

### Batch 2 · License + Customer 业务（依赖 Batch 1）

4. License 模块（含 precheck 端点）
5. Customer 模块（CRUD + 发 license）
6. Migration SQL

### Batch 3 · 前端（可与 Batch 2 并行，通过 mock API 先行）

7. License/Customer HTTP service
8. Customer 列表页 + modal
9. 凭据展示抽屉
10. 路由 / 菜单 / i18n 接线

### Batch 4 · 部署脚本

11. install.sh 主体
12. shellcheck 通过
13. 本地 mock server 集成测试

### Batch 5 · 生产部署

14. CF 配置 + Origin Cert
15. cardshop nginx 接入
16. maer-energy 端口收口
17. 用户验收

---

## 详细任务

### 任务 1 — base58 工具

**文件**：`nest-api/src/common/crypto/base58.util.ts` + `.spec.ts`

**内容**：Bitcoin base58 字母表（剔除 0 O I l）的 encode/decode 纯函数。

**接受标准**：
- 空输入 → 空串
- 已知向量 `Buffer.from("hello")` ↔ `Cn8eVZg`
- `decode(encode(x))` 往返 =
- 非法字符抛错

**spec**：10+ cases。

---

### 任务 2 — HMAC 工具

**文件**：`nest-api/src/common/crypto/hmac.util.ts` + `.spec.ts`

**内容**：
- `signCanonicalRequest(secret, method, path, timestamp, nonce, body)` — 生成规范串 + HMAC-SHA256(hex lowercase)
- `verifyCanonicalRequest(secret, sig, ...args)` — timingSafeEqual 验证
- 空 body 约定用 `EMPTY_BODY_SHA256` 常量

**接受标准**：
- 与 `scripts/install.sh` 里 `openssl dgst -sha256 -hmac` 结果一致（交叉验证）
- timing-safe 比较（用 `crypto.timingSafeEqual`）
- 对长度不等的 sig 返回 false 而非抛错

**spec**：8+ cases。

---

### 任务 3 — AES-GCM 工具

**文件**：`nest-api/src/common/crypto/aes-gcm.util.ts` + `.spec.ts`

**内容**：
- `encrypt(plaintext: string, key: Buffer): Buffer` — key 必须 32 bytes；返回 `iv(12) + ciphertext + tag(16)` 组合 Buffer
- `decrypt(ciphertext: Buffer, key: Buffer): string`
- 从 base64 env 解析 key 的 helper `loadKeyFromBase64(s: string): Buffer`

**接受标准**：
- 加密同明文两次结果不同（IV 随机）
- 往返 roundtrip
- 错误 key → 抛错
- 篡改密文任意字节 → 抛错（GCM tag 验）

**spec**：8+ cases。

---

### 任务 4 — License Key 生成器

**文件**：`nest-api/src/common/crypto/license-key.util.ts` + `.spec.ts`

**内容**：
- `generateLicenseKey(): string` — `"ebt_" + base58(crypto.randomBytes(24))`
- `generateLicenseSecret(): string` — `base64url(crypto.randomBytes(32))`
- `LICENSE_KEY_REGEX` — 验 key 格式

**接受标准**：
- 100 次生成唯一
- Key match regex
- Secret 43-44 字符 base64url

**spec**：6+ cases。

---

### 任务 5 — Nonce Cache

**文件**：`nest-api/src/common/nonce/nonce-cache.service.ts` + `.spec.ts`

**内容**：
- `@Injectable() NonceCacheService`
- `checkAndStore(key: string, ttlSec: number): boolean` — 返回 true 若首次，false 若已存在
- 内存 Map + 过期时间戳；超容量按 LRU 淘汰
- 不持久化（进程重启 nonce 失效——5 分钟时钟偏移窗口可接受这个风险）

**接受标准**：
- 首次 true / 重复 false
- TTL 过期后允许相同 key
- 容量上限 LRU 淘汰最旧
- 并发安全（JS 单线程天然）

**spec**：6+ cases。

---

### 任务 6 — Schema 变更

**文件**：`nest-api/src/drizzle/schema.ts`（追加）

**内容**：见规格 §3.1，按最终决定用 `secretCipher: customType<{...}>({...})` 存 bytea。由于 drizzle 原生没有 bytea 直接映射到 Buffer 的简便 API，查阅现有 schema 用法决定：
- 方案：用 drizzle `customType` 定义一个 `bytea` 列类型
- 或：用 `varchar` 存 base64 编码后的密文（更简单）

采用 **base64 编码存 varchar** 方案，字段名 `secretCipher: varchar('secret_cipher', { length: 200 }).notNull()`。原因：
- 避 drizzle bytea 类型不方便的问题
- 200 字节足够：32 明文 + 12 IV + 16 tag = 60 bytes raw → base64 ~84 chars
- 日志/备份/迁移时 text 更易处理

**接受标准**：
- schema.ts 包含 `customersTable` + `licensesTable` 定义
- 所有必须列 `.notNull()`；可选列无此
- `updatedAt` 带 `{ precision: 3 }`

---

### 任务 7 — Migration SQL

**文件**：`nest-api/sql/20260503-customers-and-licenses.sql` + `nest-api/sql/rollback/20260503-customers-and-licenses.rollback.sql`

**内容**：BEGIN/COMMIT 包裹；CREATE TABLE；CREATE INDEX；INSERT INTO sys_permission 三条；INSERT INTO sys_role_perm 三条给 role 1。

**接受标准**：
- 语法通过 `psql --dry-run`（由于生产环境跑之前会有 review）
- 含完整中文 docblock 说明
- Rollback 含反向 DELETE/DROP

---

### 任务 8 — 配置

**文件**：
- `nest-api/src/enum/config.enum.ts`（加 LICENSE_SECRET_ENC_KEY 常量）
- `nest-api/src/common/config/config.module.ts`（加 Joi 校验）
- `.env.example`（加说明）

**接受标准**：启动时若 env 缺少 `LICENSE_SECRET_ENC_KEY` → Joi 报错阻止启动。

---

### 任务 9 — License Module

**文件**：
- `nest-api/src/modules/license/license.module.ts`
- `nest-api/src/modules/license/license.service.ts` + `.spec.ts`
- `nest-api/src/modules/license/license.public.controller.ts` + `.spec.ts`
- `nest-api/src/modules/license/dto/license.dto.ts`

**LicenseService 职责**：
- `generate(customerId, issuedBy): { key, secret, installCommand }` — 调用 license-key.util + aes-gcm 加密写 DB
- `revoke(licenseId)` — 设 revokedAt，返回 void
- `verifyPrecheck({ key, timestamp, nonce, signature, method, path, body })` — 综合校验
- `reissue(customerId, issuedBy)` — revoke + generate
- `findActiveByKey(key)` — 含 `customer` 关联

**LicensePublicController 职责**：
- `POST /api/v1/license/precheck` — 无 guard，解析 headers + body，调 `verifyPrecheck`，返回 customer_name 或错误码

**spec 覆盖**：
- precheck 六种错误码（key 不存在 / revoked / customer suspended / clock_skew / sig_invalid / nonce_replayed）+ 一种成功
- generate / revoke / reissue 功能
- 边界：secret 为空 / timestamp 非数字 / signature 长度错等

---

### 任务 10 — Customer Module

**文件**：
- `nest-api/src/modules/customer/customer.module.ts`
- `nest-api/src/modules/customer/customer.service.ts` + `.spec.ts`
- `nest-api/src/modules/customer/customer.controller.ts` + `.spec.ts`
- `nest-api/src/modules/customer/dto/customer.dto.ts` + `.spec.ts`

**CustomerService**：
- `create(dto, issuedBy)` 事务：insert customer + 调 LicenseService.generate
- `list(params)` 分页 + 过滤
- `findById(id)` 含 licenses
- `update(dto)` 改 name/contact/remark
- `revokeLicense(customerId)` 调 LicenseService.revoke
- `reissueLicense(customerId, issuedBy)`
- `getInstallCommand(customerId)` 返回仅带 key 的安装提示字符串（secret 需从 DB 解密后返回，安全考虑：**仅 reveal 权限可用**）

**CustomerController**：
- 每端点 `@UseGuards(JwtGuard, AuthGuard) @Permission(...)`
- DTO 校验

**spec 覆盖**：服务 15+ cases，控制器 8+ cases，DTO 10+ cases。

---

### 任务 11 — 注册模块

**文件**：`nest-api/src/modules/api-modules.module.ts`（修改）

加入 `CustomerModule` 和 `LicenseModule`。

### 任务 12 — 启用 Global ValidationPipe

**文件**：`nest-api/src/main.ts`（修改）

`app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))`。

注意这会影响所有现有端点（之前 DTO 校验不生效）——**风险**：已写了 DTO 但实际运行时容忍的脏数据将被拒。必须：
- 先跑整套 jest 看有无 spec 失败
- 若失败，具体分析补 DTO 或调 ValidationPipe 选项

---

### 任务 13 — 前端 HTTP Service

**文件**：
- `ui/src/app/core/services/http/system/customer.service.ts` + `.spec.ts`

方法：`list / getDetail / create / update / revokeLicense / reissueLicense / getInstallCommand`。

spec：4+ case 覆盖 URL / 请求体 / 返回形状。

---

### 任务 14 — Customer 列表页

**文件**：
- `ui/src/app/pages/system/customers/customers.component.ts` + `.html` + `.spec.ts`

按调研结论：`app-page-header` + 搜索卡 + `card-table-wrap` + `ant-table`。操作列 viewChild template。

spec：6+ cases。

---

### 任务 15 — Customer Modal

**文件**：
- `ui/src/app/widget/biz-widget/system/customer-modal/customer-modal.component.ts` + `.html` + `.spec.ts`
- `ui/src/app/widget/biz-widget/system/customer-modal/customer-modal.service.ts`

继承 `BasicConfirmModalComponent`。Reactive 表单：name (required 2-120) / contact (optional) / remark (optional textarea)。

spec：4+ cases。

---

### 任务 16 — License 凭据抽屉

**文件**：
- `ui/src/app/shared/biz-components/license-credential-drawer/license-credential-drawer.component.ts` + `.html` + `.spec.ts`
- `ui/src/app/shared/biz-components/license-credential-drawer/license-credential-drawer.service.ts`

职责：
- Input：`{ customerName, licenseKey, licenseSecret, installCommand }`
- UI：三段等宽 + 复制按钮 + 红色警告
- 关闭前 `NzModalService.confirm("确定已妥善保存？")`

spec：4+ cases。

---

### 任务 17 — 路由 + 菜单 + i18n + permission

**文件修改**：
- `ui/src/app/pages/system/system-routing.ts` — 加 customers 路由条目
- `ui/src/mocks/business/menu.ts` — 加菜单节点
- `ui/src/mocks/business/permission.ts` — 给 role 1 加 codes
- `ui/src/app/config/actionCode.ts` — 加 code 常量
- `ui/public/i18n/zh_CN.json` + 3 个其他 locale — 加 key

---

### 任务 18 — install.sh

**文件**：`scripts/install.sh`

按规格 §6 全实现。

**验证**：
- `shellcheck --severity=warning scripts/install.sh` 零 warning
- 本地起 mock server（`scripts/mock-precheck-server.mjs`，只在本地手工跑，不进 CI）测试：成功 / 401 / 5xx 路径
- 本地在 docker ubuntu 容器中试跑 `VERIFY_ONLY=1 LICENSE_KEY=... LICENSE_SECRET=... sh scripts/install.sh`（如果时间允许）

---

### 任务 19 — 全量本地验证

1. `cd nest-api && npm test` — jest 全绿（增量约 80 case）
2. `cd nest-api && npm run build` — 无 error
3. `cd ui && npx ng test --watch=false --browsers=ChromeHeadless` — 262 → ~290 全绿
4. `cd ui && npm run build` — 成功
5. `shellcheck scripts/install.sh` — 零 warning
6. `cd nest-api && npm run lint` — 零 error

---

### 任务 20 — Commit 与推送

按改动性质分粒度 commit：
1. `feat(nest-api): 新增加密工具套件与 nonce 缓存`
2. `feat(nest-api): 启用全局 ValidationPipe 与 License/Customer 模块`
3. `feat(nest-api): 新增 customers 与 licenses 表 migration`
4. `feat(ui): 新增客户管理页面与 license 凭据抽屉`
5. `feat(scripts): 新增一键部署 install.sh`
6. `docs: 添加子系统 A 设计文档与实现计划`
7. `chore(deploy): 新增 www.feiyijt.com nginx 配置`

推 `main`。

---

### 任务 21 — 生产部署

流程见规格 §10。

关键节点：
- **用户提供 Origin Cert** 后我才能动 cardshop nginx
- Migration 在生产 Postgres 跑之前用 `--dry-run` 或 `BEGIN; ... ROLLBACK;` 预演
- cardshop-app 重启前警示用户（有 ≤30s 服务中断）
- 部署后立即在后台建一个"测试客户 A"走完整链路验收

---

## 依赖顺序

```
1. base58 util ─┐
2. HMAC util    ├→ 4. license-key util ──┐
3. AES-GCM util ┘                        │
5. Nonce cache ─────────────────────────┤
6. Schema ──────────────────────────────┤
7. Migration ───────────────────────────┤
8. Config ──────────────────────────────┤
                                         ↓
                             9. License Module
                                         ↓
                            10. Customer Module
                                         ↓
                             11. 注册 + 12. ValidationPipe
                                         ↓
                                        jest 全绿
                                         ↓
               ┌────────────────────────┼─────────────┐
       13. HTTP svc         14. 列表页        16. 凭据抽屉
               │                         │             │
               └──── 17. 路由+菜单 ──────┘─── 15. Modal┘
                              ↓
                          karma 全绿
                              ↓
                      18. install.sh
                              ↓
                     shellcheck 全绿 + mock 手测
                              ↓
                       19. 全量本地验证
                              ↓
                       20. Commit + 推
                              ↓
                       21. 生产部署
```

---

## 不变量

整个实施期间必须保持：
1. 现有 262 specs 全绿——不得引入 regression
2. 现有 API 端点行为不变——ValidationPipe 引入若让任何现有 spec 失败必须就地修 DTO
3. 生产 `47.82.151.0:18080` 在切换前保持可用
4. 生产 cardshop-app 服务不受影响（改 nginx 时 `nginx -t` 通过再 reload）
