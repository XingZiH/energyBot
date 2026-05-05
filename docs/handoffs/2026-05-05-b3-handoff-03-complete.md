# B3 开发进度 handoff #3 — T5/T6/T7/T8 完成、B3 功能代码冻结

**更新时间**：2026-05-05（本次会话第二次）
**分支**：main（用户批准直接 commit）
**上一个 handoff**：`docs/handoffs/2026-05-05-b3-handoff-02-t2.1-complete.md`
**上一个 tag**：`v1.1.2-b1`（i18n 补丁）
**本次候选 tag**：`v1.2.0-b3-rc1`（功能冻结，待主站发布 bot 二进制 + 真实 ssh 冒烟后升 GA）

## 本次会话总结

### 交付 4 个 commit（+2431 行，仅 feat/test）

| SHA | 里程碑 | 内容 |
|---|---|---|
| `b17fcd93` | T5a | go-agent `internal/supervisor` 包（Manager + ExecLauncher + fakeProcess 测）+ client Dispatcher + main.go 接入；+1123 行 |
| `1942d65f` | T5b+T5c | nest-api `AgentRegistry.sendToAgent` + `MyBotActionController/Service` + UI 启停/重载按钮；+893 行 |
| `e016cc11` | T6+T7 | UI 删 agent-bot-config 页 B3 warning + `install.sh v1.1.0-b3` 增 glibc precheck 和 bot 二进制下载；+85 行 |
| `5f01304b` | T8 | `manager_integration_test.go`（7 用例，`//go:build integration`）+ 修 fakeProcess race（`sync.Mutex` + `wasKilled()` getter）；+330 行 |

### 端到端链路已打通（未在真客户机 ssh 跑过）

```
UI 按钮点击
  → POST /api/my-bot/:licenseId/{start,stop,reload}
  → MyBotActionService 校验 ownership + agent 在线
  → AgentRegistry.sendToAgent(agentId, method, params)
  → WSS jsonrpc notification
  → go-agent Dispatcher 路由到 supervisor.Manager
  → ExecLauncher.Launch(EBT_BOT_BINARY, args...) / proc.Signal SIGTERM / proc.Kill
  → 下一轮心跳 Snapshot 带回 status/pid/configVersion/uptime
  → nest-api 落 agents 表 bot_* 列
  → UI 2s 后重拉 my-bot 看到新状态
```

## T8 测试矩阵（新增 7 集成用例 + 修 fakeProcess race）

### 默认套件（不带 tag）

```
go test -count=1 ./internal/supervisor/...   →  10/10 PASS
go test -count=1 -race ./...                  →  8/8 packages 全绿
```

### 集成套件（带 tag）

```
go test -tags=integration -count=1 ./internal/supervisor/...   →  17/17 PASS（10 单测 + 7 集成）
go test -tags=integration -count=1 -race ./internal/supervisor/...  →  PASS
```

| # | 集成用例 | 覆盖点 |
|---|---|---|
| 1 | `StartSpawnsRealProcessAndReportsPid` | ExecLauncher 真 fork，PID > 0，`os.FindProcess + Signal(0)` 探活成功 |
| 2 | `StopSendsSIGTERMAndProcessExitsCleanly` | `/bin/sleep 30` 收 SIGTERM 秒级退，status=stopped，进程已 reap |
| 3 | `StopTimesOutAndForceKillsStubbornProcess` | `trap '' TERM; while :; do sleep 0.05; done` 忽略 SIGTERM，grace 超时（300ms）走 SIGKILL |
| 4 | `ProcessSelfExitNonZeroBecomesError` | `sh -c 'exit 7'` 自然崩，watch goroutine 标 status=error + lastError 非空 |
| 5 | `ReloadSpawnsNewProcessWithDifferentPid` | Reload = Stop + Start，新 PID ≠ 旧 PID |
| 6 | `SetConfigVersionPropagatesToSnapshot` | ConfigVersion=42 透传到心跳 |
| 7 | `ConcurrentStartIsIdempotent` | N=10 并发 Start 无 panic/race，status=running，PID 单一 |

### 关键坑（留给未来）

- **sh `-c` 末尾命令会 exec 替换**：`sh -c 'sleep 30'` 实际会变成 sleep 进程自身，trap 失效。测试必须用 `while` 循环保留 shell 身份：`trap '' TERM; while :; do sleep 0.05; done`。
- **trap 安装 race**：`cmd.Start` 返回时 shell 尚未解析完 `trap` 这条 builtin，Stop 若立即发 SIGTERM 会抢在 trap 之前到达并终止 shell。集成用例 3 在 Start 后 `Sleep(150ms)` 等 trap 生效才 Stop。
- **fakeProcess race**：既存 `manager_test.go` 中 `fakeProcess.killed/signalLog` 被 Stop goroutine 写、测试主 goroutine 读，无锁。本次加 `sync.Mutex` + `wasKilled() / signalsCopy()` getter 修复，`-race` 从红转绿。与 T8 无直接关系但顺手清理。

## 覆盖的 B3 任务清单（PBI 视角）

| # | 任务 | SHA | 状态 |
|---|---|---|---|
| T0 | go-bot-v2 工程 + docker 跨编译 | `533b7671` | ✅ |
| T1 | 搬迁 /go-bot/ 9252 行 + 改 import | `ee27b8c8` | ✅ |
| T2.1 | SQLite schema 0001 + storage 包 | `8e0a8a73` | ✅ |
| T2.2 | pgx → database/sql 类型适配 | `603fff2e` | ✅ |
| T2.3+T2.4 | SQL 方言 + 单 agent 视角改造 | `1f86eb16` | ✅ |
| T3 | go-agent 心跳 bot 字段 | `68cb9f62` | ✅ |
| T4 | nest-api 接收 bot 字段落库 | `ac14ad3a` | ✅ |
| T5a | go-agent supervisor + Dispatcher | `b17fcd93` | ✅ |
| T5b | nest-api 下行 notification + 校验 | `1942d65f` | ✅ |
| T5c | UI 启停/重载按钮 | `1942d65f` | ✅ |
| T6 | 去 B3 "开发中" warning | `e016cc11` | ✅ |
| T7 | install.sh 装 bot 二进制 + glibc precheck | `e016cc11` | ✅ |
| T8 | 本地 e2e 测试矩阵 | `5f01304b` | ✅ |
| T9 | 文档收尾 + tag rc1 | *本文件* | 🟡 进行中 |
| T10（原计划外）| 主站发布 bot 二进制 + 真实 ssh 冒烟 | ⏳ 待做 | 功能 GA 的前置 |

## 关键决策记录（接续 handoff #2）

### T5b API 设计
- 权限：沿用 `default:account:my-bot`，不新增码；admin 在后台挂同码即可
- ownership 校验失败统一 `ForbiddenException`（防 licenseId 枚举攻击，非 404）
- agent 离线 → `ServiceUnavailableException`（503，前端可展示"agent 已离线"）

### T5c UI 防抖
- 按 `licenseId` 粒度 `actionInFlight = Set<string>`，同一 license 在途不允许重复点击
- **不做乐观 UI**：action 成功后 2s setTimeout 重拉 my-bot（等 agent 心跳完成一轮）；避免 agent 启动失败时显示"运行中"误导客户

### T7 install.sh 容错
- glibc 解析：`ldd --version | grep -oE '[0-9]+\.[0-9]+' | head -n 1`（避免匹配到包版本号末尾如 `2.35-0ubuntu3.7` 的 `3.7`）
- glibc < 2.31 / musl libc / 下载失败 → `SKIP_BOT_INSTALL=1`，agent 仍装但 `EBT_BOT_BINARY=""`，心跳里 bot 字段缺省走 B2 兼容模式（nest-api T4 已兜底 null）
- 不主动删旧 bot 二进制（覆盖重装场景），只在 `--uninstall` 里清单统一删

### T8 测试策略
- **不编译真 bot 跑 e2e**：bot 启动会 fatal on missing DB/Telegram token；假造 DB + token 的成本 > 收益
- shell 子进程足以验证 supervisor ↔ OS 信号路径（ExecLauncher/Manager 状态机/Wait/Signal/Kill 全覆盖）
- 真 bot e2e 留到 T10（主站发布二进制 + ssh 部署阶段）

## 当前阻塞 / 下一步

### 阻塞

**主站尚未发布 `/bin/energybot-bot-linux-{amd64,arm64}` 下载端点**。`install.sh v1.1.0-b3` 已写好下载逻辑，但 URL 返 404 时会走 SKIP 分支——客户机装完只有 agent 没有 bot，**启动按钮会失败**（EBT_BOT_BINARY 为空时 supervisor.Start 返 error）。

### 发布 GA 的前置清单

- [ ] `go-bot-v2/packaging/build.sh` 跑一遍 docker buildx 产 `linux-amd64/arm64` + macOS（开发用）三个产物
- [ ] 主站 `/public/bin/` 或 CDN 上传 `energybot-bot-linux-amd64` + `energybot-bot-linux-arm64` 两个文件
- [ ] 测试机 `43.119.5.98` 跑 install.sh v1.1.0-b3 验证下载 + 启动 bot 成功
- [ ] 真实 Telegram bot token 跑通一次消息（账户 owner 绑定的 bot）
- [ ] 观察心跳 30s × 3 轮，确认 status/pid/uptime 正常
- [ ] 停机测试：UI 点停 → 进程真消失；UI 点重载 → 新 PID
- [ ] 生产 `47.82.151.0` 发布新 install.sh（或覆盖 agent 二进制 + 旧 bot 停机切 B3）

### 关键风险

- **生产 bot 业务停摆已第 1 天**（2026-05-04 14:30 起）。每多等一天，客户投诉压力越大
- 建议先在测试机完整跑通 T10 冒烟，再定生产切换窗口
- 若 T10 发现问题：agent 可独立回滚到 `v1.1.2-b1`（install.sh --uninstall → 装旧版），bot 业务仍停摆但 agent/心跳/webhook 可用

## 相关文件索引

### 本会话新增 / 修改

- `go-agent/internal/supervisor/{manager,process_exec,manager_test,manager_integration_test}.go`
- `go-agent/internal/client/dispatcher.go`（Dispatch 路由）
- `go-agent/cmd/agent/main.go`（supervisor.Manager wire）
- `nest-api/src/modules/agent/{agent.registry,my-bot-action.controller,my-bot-action.service,my-bot.service}.ts` + `.spec.ts`
- `nest-api/src/modules/agent/util/jsonrpc.util.ts`
- `ui/src/app/pages/account/my-bot/my-bot.component.{ts,html,scss}`
- `ui/src/app/core/services/http/account/my-bot.service.ts`
- `ui/src/app/pages/energy-rental/agent-bot-config/agent-bot-config.component.html`
- `scripts/install.sh`（v1.1.0-b3）

### 手法模板（后续 B4+ 参考）

- **go 集成测试隔离**：`//go:build integration` + 同 package 直写私有字段（stopGrace）。验证链路不增加接口面
- **RPC 下行**：`AgentRegistry.sendToAgent(agentId, method, params)` + `jsonRpcNotification` helper，已泛化可复用
- **UI 按 resource 粒度防抖**：`actionInFlight: Set<string>` > boolean，方便列表场景批量控件

## 技术债（B3 新增，进 B1 累积清单）

| 优先级 | 债务 | 备注 |
|---|---|---|
| P1 | supervisor.Manager 无 context.Context 取消机制 | Stop 阻塞在 waitDone，无法外部打断；B4+ systemd 停机时需加 |
| P2 | ExecLauncher 的 stdout/stderr pump 同步写 logger | 高流量 bot 可能拖慢 Wait；需加 buffered channel + drop policy |
| P2 | stopGrace 硬编码 10s 无 setter | 测试通过直写字段绕过；B4 应走 config |
| P3 | install.sh 不支持 agent 单独升级（必须连 bot 一起重装） | B4 加 `--agent-only` / `--bot-only` flag |
| P3 | T8 集成测试依赖 `/bin/sh /bin/sleep`，Windows 不能跑 | 当前 agent 只支持 linux/darwin，不阻塞 |

## 签名

本次会话按 `writing-plans` + `verification-before-completion` 精神走。所有 commit 前都跑了对应 verification（`go test -race` / `npm test` / `ng build` 按 scope），无带病 commit。
