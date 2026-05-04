# Changelog

All notable changes to EnergyBot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

本项目尚未打首个正式 tag，`1.1.0-b1` 对应子系统 B1（WSS Agent 通道）所有 commit 落 main、待生产部署的状态。正式 `1.0.0` 会在 A 版 + B1 双双在生产验证后回填。

## [Unreleased]

- 生产部署 B1：按 `docs/deployment/b1-launch.md` 阶段 0–12 在 `www.feiyijt.com` 执行。
- 子系统 A 历史客户升级：通知存量客户按 `docs/deployment/b1-customer-notice.md` 重跑 `install.sh`。

## [1.1.0-b1] - 2026-05-04

子系统 B1 —— **WSS 反向通道 + 我的 Bot**。为 A 版 license 颁发链路补上「客户终端 → 主站」的长连接，让控制台第一次能实时看到客户机器上的 agent 存活状态与主机指标。

**范围（26 个 commit，仓库四象限齐动）：**

- `nest-api/`：新增 `src/modules/agent/`（Gateway / Service / Registry / Controller / OfflineScheduler + DTO + util）
- `go-agent/`：全新工程，Go 1.26.2 + gorilla/websocket + gopsutil v4 + uber-go/zap，跨平台交叉编译
- `ui/`：新增「我的 Bot」页 `/account/my-bot`
- `scripts/` + `deploy/`：`install.sh` 新增 `install_agent()`，`www-feiyijt.conf` 新增 `/agent` `/bin/` `/systemd/` 三个 location

### Added

**nest-api —— 反向通道后端（`src/modules/agent/`，10 个源文件 + 5 个 spec）**

- `AgentGateway`（`25f329b9`）：`@nestjs/platform-ws` WS 入口，路径 `/agent`；握手 5 个 `X-*` header 校验 + `agents` 表 upsert + 注册到内存；JSON-RPC 2.0 over frames；连接关闭时级联清理内存 + DB markOffline。
- `AgentRegistry`（`9ebbd543`）：内存态 `licenseId → { ws, lastHb, bootTime, connectedAt }`；实现**后来者赢** + **300 ms 抗抖动**：同 `licenseId` 二次连接若 `bootTime` 相同且间隔 < 300 ms 视为抖动拒绝新连接，否则踢旧连接（close code `4001`）。
- `AgentService`（`634bbe75`）：DB 层，`upsertOnlineByHandshake` 原子 `INSERT ... ON CONFLICT (license_id) DO UPDATE`；`updateHeartbeat` 20 s 去抖（仅每 20 s 写一次 DB，期间只刷内存）；`markOfflineByLicense`；`listForUser(userId)` 走 `userId → customerId → agents`。
- `AgentOfflineScheduler`（`155bbcf9`）：`@Cron('*/30 * * * * *')`，扫 `last_heartbeat_at < now() - 90s AND status = 'online'` 批量置 `offline` 并清理内存。
- `AgentController` + `MyBotService`（`36c4caa5`）：`GET /agent/my-bot` → `MyBotAgentView[]`（status / hostName / publicIp / kernel / agentVersion / bootTime / lastHeartbeatAt / uptimeSeconds / cpuPercent / memUsedBytes / memTotalBytes / loadavg1，全 ISO 时间）。
- `jsonrpc.util`（`b5cad41b`）：JSON-RPC 2.0 parse / error / result 辅助；自定义错误码常量 `AgentRpcErrorCode`（`482ca8be` 重构为枚举并与 WS close code 对齐）。
- `LicenseService.verifyPrecheckForHandshake`（`387a5e05`）：复用 A 版 HMAC 5 分钟时钟偏移 + nonce 缓存校验，但返回 `{ licenseId, customerId, customerName }` 而非 HTTP 响应体；同时 `4961a080` 抽公共 `runPrecheckCore` helper 消除与 HTTP 路径的重复。
- `AgentModule`（`d750f505`）：装配 + `main.ts` `useWebSocketAdapter(WsAdapter)`；`WeakMap<WebSocket, HandshakeCtx>` 消除 `as any`。
- `agents` 表（`d09d1dca`）：新建 `nest-api/sql/20260504-agents-table.sql` + rollback；`UNIQUE(license_id)`、`INET public_ip`、心跳 5 字段（`last_heartbeat_at` / `cpu_percent` / `mem_used_bytes` / `mem_total_bytes` / `loadavg1`）；同步 `schema.ts` 的 `agentsTable`；菜单权限新增 `default:account:my-bot`。
- HMAC 跨端 fixture（`5defc962`）：`nest-api/test/fixtures/hmac-pairs.json` 10 组，供 Nest + Go 互测同一输入字节级一致。
- 依赖（`ba9bbedb`）：`@nestjs/platform-ws` + `ws` + `@nestjs/schedule`；`ScheduleModule.forRoot()` 挂到 `AppModule`。

**go-agent/ —— 新工程**

- 工程骨架（`78918b81`）：`go.mod`（module `github.com/anomalyco/energybot-agent`）+ 目录结构 + `internal/auth/hmac.go`；HMAC-SHA256 canonical request `METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(body)`；`hmac_test.go` 吃 `nest-api/test/fixtures/hmac-pairs.json` 做跨端一致性断言。
- `internal/jsonrpc`（`87fc9e3d`）：Request / Response / Notification / ErrorObj 结构体 + 编解码 + 错误码常量，与 nest 端对齐。
- `internal/host`（`3ab824f6`）：gopsutil v4 封装，`Collector` interface（真实实现 + mock）采集 hostName / bootTime / kernel / cpuPercent / memUsed / memTotal / loadavg1。
- `internal/client`（`12590fc1`）：WebSocket 客户端，Dial 带 5 个 `X-*` 签名 header；read loop / write loop 分离；指数退避重连 `1s → 2s → 4s → ... → 60s cap`；close code `1000` / `4001` 正常退出，`4003` 触发 `os.Exit(42)`（被 systemd `RestartPreventExitStatus=42` 吸收）；mock server 单测 6 个包全 `-race -count=3` 绿。
- `internal/client/heartbeat.go`（`39702180`）：30 s ticker → 采集 host metrics → `agent.heartbeat` JSON-RPC notification。
- `cmd/agent/main.go` + `internal/config` + `internal/log` + Ready API + 交叉编译（`8e9d096b`）：读 `EBT_LICENSE_KEY` / `EBT_LICENSE_SECRET` / `EBT_API_URL`（默认 `wss://www.feiyijt.com/agent`）；SIGTERM 优雅关闭；zap 日志；`packaging/build.sh` 输出 `dist/energybot-agent-linux-{amd64,arm64}`（`-trimpath -ldflags="-s -w"`，~3 MB）；`packaging/systemd/energybot-agent.service`（`User=energybot-agent` + `ProtectSystem=strict` + `ReadWritePaths` 白名单 + `RestartPreventExitStatus=42`）。

**ui —— 「我的 Bot」页**

- `ui/src/app/pages/account/my-bot/*`（`5f14f621`）：lazy route `/account/my-bot`；`MyBotComponent` 采用 `OnPush` + signal + `takeUntilDestroyed`，照抄 `my-license` 风格；无 agent → `nz-empty` 引导去「我的 License」；1 个 agent → `nz-descriptions` + CPU/内存 `nz-progress` dashboard；多 agent → `nz-table` + 展开行详情；404「当前账号未绑定客户」→ `nz-alert info` 兜底。
- `MyBotService`（`5f14f621`）：`findMine()` → `GET /my-bot` 返 `MyBotAgentView[]`，契约与后端一致。

**scripts / deploy —— 部署产物**

- `scripts/install.sh` 新增 `install_agent()`（`94194799`）：检测 `uname -m` → 选 amd64 / arm64 → `curl` 下载 `https://www.feiyijt.com/bin/energybot-agent-linux-${arch}` → `sha256sum -c` 校验 → 写 `/etc/energybot-agent/agent.env`（`EBT_LICENSE_KEY` + `EBT_LICENSE_SECRET`）→ 从 `/systemd/energybot-agent.service` 拉 unit → `systemctl daemon-reload` → `enable --now`。
- `deploy/www-feiyijt.conf` 新增 3 个 location（`94194799`）：
  - `location = /agent`：精确匹配 WS 反代，透传 `X-License-Key` / `X-Timestamp` / `X-Nonce` / `X-Signature` / `X-Agent-Version` 5 个 header；`proxy_read_timeout 3600s` / `proxy_send_timeout 3600s`；`Upgrade` + `Connection`。
  - `location /bin/`：`alias /var/www/feiyijt-public/bin/`；`default_type application/octet-stream`；`Content-Disposition attachment`。
  - `location /systemd/`：`alias /var/www/feiyijt-public/systemd/`；`text/plain`。

**文档**

- `docs/superpowers/specs/2026-05-04-subsystem-b1-wss-channel-design.md`（`11dc50aa`，994 行）：设计规格。
- `docs/superpowers/plans/2026-05-04-subsystem-b1-wss-channel-implementation.md`（`73368710`，1617 行 + `8c34d4b0` 任务 7 brainstorm 增订 88 行）：实现计划。
- `docs/deployment/b1-launch.md`（`c2bea33f`，670 行）：生产部署 runbook，阶段 0–12 + 4 个附录，覆盖 SSH → git pull → 二进制 rsync → sha256 校验 → SQL migration → docker compose → nginx reload → 烟测 → 回滚 → 已知问题。

### Changed

- `scripts/install.sh`：`do_uninstall` 扩展为先 `systemctl disable --now energybot-agent` → 清 `bin/env/unit` → `daemon-reload` → 再清 `license.conf`；保留 `/var/log` 与系统用户（`94194799`）。
- `scripts/install.sh`：`print_banner` 去掉「Agent 开发中」占位，改为展示 Agent 运行状态行并把引导语改指「我的 Bot」页（`94194799`）。
- `scripts/install.sh`：`trap` 里 `$LINENO` 在 POSIX `sh` 下未定义造成报错后多打一条 `parameter not set` 噪声，改为显式判空（`ad921c35`）。
- `nest-api/src/main.ts`：`app.useWebSocketAdapter(new WsAdapter(app))`（`d750f505`）。
- `nest-api/src/modules/license/license.service.ts`：precheck 抽 `runPrecheckCore` 公共 helper，HTTP 路径与 handshake 路径共用校验、统一错误码（`4961a080`）。
- `nest-api/package.json`：`lint` 脚本拆为只读（CI）与 `lint:fix`（本地）两套（`b7172cb4`）。

### Removed

- 无。`deploy/www-feiyijt.conf` 里原有 `/ws/` 预留 location **刻意保留**未合并到 `/agent`，用于后续 B2/B3 不同路径的通道；详见 `docs/deployment/b1-launch.md` §12.5。

### Security

- 握手安全沿用 A 版 License HMAC：5 个 `X-*` header（`X-License-Key` / `X-Timestamp` / `X-Nonce` / `X-Signature` / `X-Agent-Version`），canonical request `METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(body)`，时钟偏移窗口 5 min，nonce 单次有效。
- `agents.boot_time` + 300 ms 抗抖动 + `UNIQUE(license_id)`：同一 license 二次连接走「后来者赢」，旧连接收 close code `4001` 主动断开，避免双连接竞争写同一行。
- systemd hardening：`User=energybot-agent`（专用系统用户，不 login）+ `ProtectSystem=strict` + `ReadWritePaths=/var/lib/energybot-agent /var/log/energybot-agent` 白名单 + `NoNewPrivileges=true` + `ProtectHome=true`。
- agent 二进制分发走 `https://www.feiyijt.com/bin/` + `sha256sum -c`，install.sh 下载后校验不通过直接 `exit 1`。

### Known Issues

- **A 版老客户不会自动升级到 B1**。A 版 `install.sh` 装完就结束，没有自更新通道；客户需要从控制台「我的 License」复制新的一键安装命令、在自己服务器上重跑 `install.sh` 才能获得 B1 agent。老的 docker 容器与 bot 数据不受影响。详见 `docs/deployment/b1-launch.md` §12.1 与 `docs/deployment/b1-customer-notice.md`。
- **macOS 下 opencode CLI SSH 到 `47.82.151.0` 被 kex exchange 阶段服务器主动 close**。人类终端（Terminal / iTerm2）正常，仅 opencode 包装的 SSH 调用异常；B1 生产部署因此改为人类运维按 runbook 手工执行。详见 §12.2。
- **`install.sh` 错误提示「脚本在第 ? 行」变量展开失败**（非阻塞）。POSIX `sh` 下 `$LINENO` 在子 shell trap 里偶尔未定义，`ad921c35` 已缓解但个别路径仍会打 `?`；后续统一走 `$BASH_SOURCE` + bash shebang 修复。详见 §12.3。
- **Cloudflare Free 计划 WSS 并发上限 100**。B1 初期客户数远低于此阈值，达量前需升级 Pro 或切自建入口。详见 §12.4。

## [1.0.0-a] - 2026-05-03

子系统 A —— **License 颁发**，首次生产上线 `www.feiyijt.com`。

### Added

- `nest-api`：License / Customer 业务模块 + 全局 `ValidationPipe` + License 颁发底层基础设施（HMAC 签名 / nonce 缓存 / 时钟偏移校验）。
- `ui`：客户与 License 管理后台 + 凭据抽屉；终端客户「我的 License」自助页；注册 / 后台建账号时自动开通 license + 存量补齐 CLI。
- `scripts/install.sh`：一键安装脚本 + 手工测试清单。
- `deploy/www-feiyijt.conf`：生产 nginx 反代配置，共享 docker network + 容器名上游。
- `docs/deployment/feiyijt-launch.md`：A 版上线手册。

### Fixed

- `NonceCacheService` 移除 constructor 整数参数，避免 DI 注入失败（`01defe85`）。
- `ui` production build 缺 `baseHref` 导致 `index.html` 指向 `/` 根路径（`cc8c7949`）。
- `ui/nginx.conf` 与 `Dockerfile` 约定对齐，server-only + 正确上游名（`379fac17`）。

## [0.x] - pre-release

A 版之前的探索期：Bot Designer MVP（MenuDesigner、TelegramPreview、消息模板编辑器、Playwright E2E）+ 三服务生产级 Dockerfile + `docker-compose.prod.yml` + Bot Designer 用户手册。共计 10+ commit，均在 A 版上线前折叠为「功能雏形」，不纳入 SemVer 轨道。
