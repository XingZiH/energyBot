# B3 开发进度 handoff #1 — T0 基础设施完成

**更新时间**：2026-05-05（本次会话）
**分支**：main（用户批准直接 commit，无 PR 流程）
**上一个 tag**：`v1.1.2-b1`（i18n 补丁）
**下一个预期 tag**：`v1.2.0-b3`（B3 GA）

## 本次会话产出

### 澄清决策（13 轮 QA）

B3 目标：**让「开启机器人」真正启动一个 Telegram bot 进程响应消息**。具体决策：

| 决策 | 选择 |
|---|---|
| Bot 运行位置 | agent 作 supervisor fork **独立二进制** `energybot-bot` |
| 功能范围 | **搬并改造**旧 `/go-bot/` 9000 行业务代码，不重写，不做功能取舍 |
| 业务数据库 | 客户机器本地 SQLite，驱动 `mattn/go-sqlite3`（cgo） |
| 历史数据 | **不迁移**，客户清零重来 |
| 进程数 | 1 agent : 1 bot（B1 同构，不为 N bot 预留） |
| 二进制分发 | `energybot-agent` + `energybot-bot` **绑定分发**（install.sh 一把装）|
| 配置下发 | **push 式**：控制台保存 → nest 经 WSS 调 `agent.applyConfig` RPC |
| Token 加密 | 主站 AES-GCM + agent 本地二重加密（license_secret 派生 key）|
| 状态回报 | **复用心跳**加字段（botStatus/pid/uptime/configVersion/lastTgPollAt）|
| 升级路径 | 重跑 `install.sh`（与 B1 一致）|
| 测试覆盖 | 与 B1 同权重（Go 单测 + Nest e2e + UI + 冷冻烟测）|

### 协议扩展（新增）

| method (server→agent) | params | result |
|---|---|---|
| `agent.applyConfig` | `{configJson, version}` | `{applied, configVersion}` |
| `agent.startBot` | `{}` | `{pid, startedAt}` |
| `agent.stopBot` | `{graceful, timeoutSec}` | `{stopped, exitCode}` |

心跳 `params` 扩展：`bot: {status, pid, uptimeSec, configVersion, lastTgPollAt}`。

### T0 代码产出（已 commit）

创建 `/go-bot-v2/` 工程：
- `cmd/bot/main.go` —— 60 行骨架，打开 SQLite + 等 signal，验证 cgo 链路
- `packaging/build.sh` —— docker buildx 跨编译 linux/{amd64,arm64}
- `go.mod` —— module `github.com/anomalyco/energybot-bot`，依赖 mattn/go-sqlite3 v1.14.44
- `README.md` —— 工程说明
- `.gitignore` —— dist/ 不进 git（与 go-agent 一致）

**验证通过**：
- amd64 ELF 3.5M / arm64 ELF 3.3M（动态链接 cgo）
- docker 跑 amd64 产物 `--version` 输出 `v1.1.2-b1-1-g3dbf2b3e` ✅
- 交叉编译链路稳定（docker buildx + golang:1.26-bookworm + apt `gcc-aarch64-linux-gnu`）

**glibc 兼容**：产物需要客户机 glibc ≥ 2.31（bookworm 基线）。Ubuntu 20.04+ / Debian 11+ 都 OK；18.04 / CentOS 7 需 install.sh 加 precheck。

## B3 完整执行 todo（T0–T9）

| T | 描述 | 状态 | 工期（剩） |
|---|---|---|---|
| T0 | 基础设施：Makefile/docker/ 交叉编译 + sqlite 驱动验证 | ✅ 完成 | 0 |
| T1 | go-bot-v2 骨架：复制 /go-bot/ 内部包、改 module 名、删 pgx 依赖 | ⏳ 待做 | 1 天 |
| T2 | SQLite schema + pgx→sqlite 方言改写 + 原有 bot 测试过绿 | ⏳ 待做 | 1.5 天 |
| T3 | agent BotSupervisor：spawn/kill/status 解析 + 单测 | ⏳ 待做 | 1 天 |
| T4 | agent RPC 分派器 + 3 handler + 本地 AES-GCM 二重加密 | ⏳ 待做 | 1 天 |
| T5 | nest-api agent-rpc.service + bot-config REST + bot_configs DB schema | ⏳ 待做 | 1 天 |
| T6 | UI 保存按钮真 commit + 移除 B3 warning + 显示推送结果 | ⏳ 待做 | 0.5 天 |
| T7 | install.sh 扩展（分发 bot 二进制 + sha256 + /var/lib 目录 + glibc precheck）| ⏳ 待做 | 0.5 天 |
| T8 | 端到端联调：保存配置 → applyConfig → startBot → TG getMe → /start 响应 | ⏳ 待做 | 1 天 |
| T9 | 生产冷冻部署 + 3 场景烟测 + tag v1.2.0-b3 | ⏳ 待做 | 0.5 天 |
| **合计剩余** | | | **~8 天** |

## 下会话开场指引

下个会话收到「继续 B3」时：

1. 读本 handoff
2. 把 `T1 go-bot-v2 骨架` 作为起点 `in_progress`
3. 执行路径：
   - `git mv /go-bot/internal/* /go-bot-v2/internal/`（或 cp 保留旧工程作参考——推荐 **cp**，handoff 决策为**复制不移动**）
   - 全局替换 import 路径 `ng-antd-admin/go-bot/` → `github.com/anomalyco/energybot-bot/`
   - 删 `go.mod` 里 `github.com/jackc/pgx/v5` 与 TRON `fbsobreira/gotron-sdk`（T2 重新以 SQLite 驱动为主，TRON 暂不动）
   - 跑 `go build ./...`，修编译错直到过
4. T1 完成后 commit，进 T2

## 参考文件

- `docs/superpowers/specs/2026-05-04-subsystem-b1-wss-channel-design.md` §18（B3 范围预告）
- `go-agent/internal/client/client.go` L427（心跳 method）
- `go-agent/packaging/build.sh`（CGO=0 方案，bot 要 CGO=1 差异参考）
- `go-bot/internal/telegram/bot.go`（1820 行主交互，T1 重点搬运）
- `go-bot/internal/executor/executor.go`（1423 行 TRON 执行器）
- `nest-api/src/modules/agent/agent.gateway.ts` L167（handleMessage 过滤 notification，新 RPC 要在这里加 dispatch）

## 用户偏好（本会话新增）

- 用户明确要求「直接写不要再 plan」→ **本会话跳过了 spec 文档和正式 plan 文档**，改用本 handoff + todowrite 自约束
- 接受业务停摆：从 B1 上线（2026-05-04 14:30）起 Telegram bot 业务中断，不做快修恢复，直冲 B3
- 继续 amend/commit 到 main 的快路径（不走 PR）
