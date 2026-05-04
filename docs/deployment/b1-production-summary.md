# B1 生产上线总结

> **发版 tag**：`v1.1.1-b1`
> **上线日期**：2026-05-04 ~ 2026-05-05
> **生产域名**：`www.feiyijt.com`
> **release 路径**：`/opt/maer-energy/current → releases/20260504-143421`
> **上一个版本**：`v1.0.0-a`（2026-05-03 仅 License 颁发）

本文档记录子系统 B1（WSS 反向通道 + 我的 Bot）从开发完成到生产验证通过的完整交付记录，供后续版本参考复盘。

---

## 1. 交付范围

子系统 B1 为 A 版 license 颁发链路补上「客户终端 → 主站」的长连接：

- **新增 `agents` 表**：客户机器一机一行（UNIQUE license_id），含 bootTime / public_ip / host_name / uptime_seconds + 5 项 metrics
- **nest-api WS Gateway**：`/agent` 端点，握手复用 A 版 License HMAC，JSON-RPC 2.0 over WSS
- **Go agent**：Go 1.26.2 + gorilla/websocket + gopsutil v4 + uber-go/zap，跨平台交叉编译（amd64 / arm64）
- **控制台「我的 Bot」页**：`/account/my-bot`，客户视角看到自家 agent 存活状态与主机指标
- **install.sh 新增 `install_agent()`**：客户一键安装流程含下载二进制 + sha256 校验 + systemd service 注册 + .env 生成

总计 35 个 commit（B1 开发 26 个 merge 到 main + 上线阶段 9 个 hot-fix）。

## 2. 端到端验证结果

### 2.1 agent 握手 + 上线

- **测试机**：`43.119.5.98` Ubuntu 24.04 / uptime 36 天
- **执行**：`curl ...install.sh | bash` 一把过（带 CUSTOMER_KEY / LICENSE_KEY 环境变量）
- **DB 侧确认**：`SELECT * FROM agents WHERE license_id=4` 返回 `status=online`、`host_name=s906971`、`uptime_seconds=3132849`、`cpu_percent`/`mem_*`/`loadavg1` 实时刷新

### 2.2 离线回归（3 场景全绿）

| 场景 | 执行 | 预期 | 实测 | 路径 |
|---|---|---|---|---|
| 进程退出 | `systemctl stop energybot-agent` | ≤5s offline | ✅ 2s | WS close event 快路径 `agent.gateway.ts` handleDisconnect |
| 网络黑洞 | `iptables -I OUTPUT -d 47.82.151.0 -j DROP` | ~120s offline | ✅ ~103s | `AgentOfflineScheduler` 兜底 90s 阈值 + 30s cron 扫描 |
| 恢复网络 | iptables -D 删除规则 | ≤60s 重连 online | ✅ ~45s | agent 内置指数回退重连 |

### 2.3 控制台业务 API

- `POST /auth/signin` → 返回 JWT
- `GET /user/auth-code/:id` → 触发权限 cache 填充（`cacheManager.set('AUTHCODE:{userId}', codes[])`）
- `menu/*` CRUD 五步（create / list / GET :id / update / del）全 200 OK；DB 侧确认 del 为硬删除（`menu.service.ts:67` `conn.delete`），与业务语义一致

验证用测试用户：`b1test` / `test123456`，手工 SQL 挂超管角色（`sys_user_role` user_id=11, role_id=1）。

### 2.4 反代链路

- cardshop-app nginx `/site/api/*` 剥前缀转发到 nest-api：5000 端口
- `/agent` WSS：read_timeout 3600s；CF idle ~100s 但应用层 30s 心跳保活
- `/bin/*`、`/systemd/*`：静态文件分发 + sha256 校验
- CF Origin Cert 有效期到 2041-04-29

## 3. 生产架构切换

### 3.1 不可回头操作清单

均已执行并归档：

1. `pg_dump ng-antd-admin-db` → `backups/b1-migration-20260504-140808/`
2. `CREATE DATABASE energybot` + `pg_restore` → 18 表 / 3 customers / 3 licenses / 44 menus
3. 老 `maer-energy-bot` 容器 `stop+rm`（A 版每客户一个 Node bot 进程架构废弃，B3 重写）
4. 老 `shared/*.env` → `backups/legacy-shared-env-20260504-143120/` 归档
5. `deploy.sh` 跑完 11 步部署（release `20260504-143421`）
6. rsync agent 二进制 amd64/arm64（hb-fix 版）到 `/opt/maer-energy/public/bin/`
7. install.sh + systemd unit 到 `/opt/maer-energy/public/`
8. cardshop-app nginx `www-feiyijt.conf` + reload
9. cardshop-app docker network `disconnect maer-energy-net && connect maer-energy_frontend`
10. `/opt/cardshop/docker-compose.yml` 网络引用 sed（备份 `docker-compose.yml.bak-b1-20260504-145519`）

### 3.2 回滚预案（保留 30 天）

| 回滚点 | 操作 | 恢复时间 |
|---|---|---|
| release symlink | `ln -sfn releases/{prev} current && docker-compose up -d` | <5min |
| 数据库 | `DROP DATABASE energybot; pg_restore ng-antd-admin-db` | <10min |
| cardshop 网络 | `docker network connect maer-energy-net cardshop-app` + 恢复 docker-compose.yml.bak | <2min |
| 老 bot 容器 | 从 `backups/legacy-shared-env-...` 恢复 env + `docker run` A 版 bot 镜像 | <5min |

## 4. 上线过程实战发现的 2 个 bug

### 4.1 bootTime 校验窗口过窄误伤长 uptime 机器

**commit**：`a469ef3c`

- **现象**：测试机（uptime 36 天）跑 install.sh 后握手被 `-40001` 拒绝
- **根因**：`agent.gateway.ts` L62-74 bootTime 校验窗口原为 `now - 30d ~ now + 5min`；36 天 uptime 的 bootTime = `now - 36d` 落窗口外
- **修复**：窗口放宽到 `±10y`（仍做 sanity check 防止时钟完全错乱）
- **教训**：任何"时间相关的下限"都要考虑工业场景真实值（VPS / 服务器 uptime 可达数年）

### 4.2 agent heartbeat 用 notification 被服务端丢弃

**commit**：`b8340704`

- **现象**：agent 心跳日志显示发送正常但服务端 DB `last_heartbeat_at` 永不更新
- **根因**：agent 用 JSON-RPC notification（无 id）发心跳；服务端 `handleMessage` L167-168 `if (id == null) return;` 对所有 notification 过滤；B1 spec L217 本意要求 heartbeat 带 id（request 而非 notification），Go agent 实现偏离 spec
- **修复**：`buildHeartbeatRequest` 改用带 id 的 request；tick 成功路径加 INFO 日志便于生产排查
- **教训**：spec 与实现的偏离要靠**实际跑通端到端**才能发现；单元测试只验证单边行为无法覆盖协议契约

## 5. 技术债清单（26 项，待排期清理）

### P0（影响客户体验或数据准确性）

1. **`api` 容器 healthcheck 显示 unhealthy** 但功能正常（`wget` 误判）
2. **`agents.public_ip` 记录反代内网地址** 非客户真实 IP（需处理 `X-Forwarded-For`）
3. **`scripts/install.sh` 文件头注释仍写「子系统 A」**：实际已是 B1 完整流程
4. **B2/B3 未上线导致客户点 `/start` 无响应**：已知限制，待 B3 交付

### P1（运维体验优化）

5. `deploy.sh` 有 2 处 shellcheck 警告（SC2012、SC2086）
6. `ui/package.json` base-href 应参数化（现在 hardcode `/ng-antd-admin/`）
7. CF Free 并发 WS 上限 100：客户数达 80 前要决策升级 Pro 或切自建入口
8. nest-api 日志未接入集中收集（ELK / Loki 任选）
9. postgres 未设自动备份 cron（需要加 `pg_dump` + 上传到对象存储）

### P2（代码质量与规范）

10. ESLint 1194 个 baseline 警告未治理
11. nest-api JWT token 未支持 refresh（现在过期就重登录）
12. Go agent 缺单元测试覆盖率 < 30%
13. cardshop-app 反代配置散落在 `/opt/cardshop/`，未纳入 git
14. 缺 `.github/workflows/` CI（现在完全靠本地 `npm test` + `go test`）
15. 缺 E2E 测试（Playwright 基建有但未跑在 CI）

### P3（长期架构项）

16-26. go-agent 自更新通道、多 region 部署、license 吊销后 agent 自我终止、agent 日志回传、metrics 历史存储（Prometheus / VictoriaMetrics）、bot 配置下发、bot runtime 多租户隔离、灰度发布机制、客户端版本兼容矩阵、跨租户数据泄漏防护审计、审计日志全链路 trace

## 6. 下次发布前必做

1. 验证 `install.sh` 对**新装机器**（0 天 uptime）也工作：之前只测了长 uptime
2. 给 nest-api healthcheck 换非 `wget` 实现（或在 Dockerfile 装 curl）
3. 把 `agents.public_ip` 的取值逻辑从 `req.socket.remoteAddress` 改为 `X-Forwarded-For.split(',')[0]`（有 `X-Forwarded-For` 时用首个 IP，否则 fallback 到 socket）
4. `install.sh` 文件头注释改为「B1 Agent 安装脚本」
5. 写 agent 自更新通道的设计文档（P2 但必做）

## 7. 关键文件索引

| 路径 | 作用 |
|---|---|
| `docs/superpowers/specs/2026-05-04-subsystem-b1-wss-channel-design.md` | B1 规格文档（含 spec L217 heartbeat 协议定义） |
| `docs/superpowers/plans/2026-05-04-subsystem-b1-wss-channel-implementation.md` | 23 个任务实现计划（全部 [x] + SHA 标记完成） |
| `docs/deployment/b1-launch.md` | 上线 runbook 阶段 0–12 |
| `docs/deployment/b1-customer-notice.md` | A 版客户升级公告模板 |
| `docs/deployment/b1-production-blockers.md` | 上线前 10 处对齐清单 + 回滚预案 |
| `docs/deployment/b1-production-summary.md` | 本文档 |
| `CHANGELOG.md` | `[1.1.1-b1]` 条目 |
| `nest-api/src/modules/agent/agent.gateway.ts` | L62-74 bootTime 窗口；L167 id==null 过滤 |
| `go-agent/internal/client/client.go` | L427 buildHeartbeatRequest 带 id |
| `scripts/install.sh` | `install_agent()` 客户一键安装 |
| `scripts/deploy.sh` | 11 步幂等部署 |
| `docker-compose.prod.yml` | 生产三服务编排 |

---

> **下一里程碑**：`v1.2.0-b2`（Bot 配置下发） + `v1.3.0-b3`（go-bot runtime）  
> **客户升级推送节奏**：待单独讨论决策