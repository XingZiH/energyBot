# energybot-bot

子系统 B3 —— Bot 运行时（agent supervisor 启动的 Telegram Bot 子进程）。

## 与 `/go-bot/` 的关系

| 工程 | 角色 | 部署方式 | 数据库 | 配置来源 | 状态 |
|---|---|---|---|---|---|
| `/go-bot/` (旧) | A 版生产 bot | docker 容器（单实例多租户） | 主站 PostgreSQL | env 变量 | **B1 上线后停跑，仅作业务逻辑参考** |
| `/go-bot-v2/` (本工程) | B 版自托管 bot | agent supervisor spawn 子进程 | 客户机器本地 SQLite | 控制台 → WSS → agent → SQLite | **B3 开发中** |

业务逻辑（TRON 能量代理、catfee、订单、Telegram 交互）从 `/go-bot/internal/` 搬运后改造（pgx → SQLite、env → SQLite 配置）。

## 构建

```bash
# 本地 Mac 跑（dev/调试）
go build -o dist/energybot-bot ./cmd/bot

# 跨平台产 Linux amd64+arm64（生产）
./packaging/build.sh
```

`packaging/build.sh` 走 docker buildx + `golang:1.26-bookworm` 容器，用 apt 装 `gcc-aarch64-linux-gnu` 做 cgo 交叉编译。需 docker daemon 在跑。

产物：

```
dist/energybot-bot-linux-amd64       # 动态链接 ELF，需要客户机 glibc ≥ 2.31
dist/energybot-bot-linux-arm64
dist/energybot-bot-sha256.txt        # install.sh 校验
```

体积 ~3.5M（cgo 内嵌 SQLite C 源；后续 T2-T8 加业务后预计 8-12M）。

## 启动

仅由 `energybot-agent` 调 `agent.startBot` RPC 后 spawn，不应直接由人启动。供调试时手动起：

```
energybot-bot --db=/var/lib/energybot-agent/bot.db
```

## 退出码

- `0` 正常退出（SIGINT / SIGTERM）
- `1` 运行期错误
- `2` 启动期错误（DB 打不开、配置缺失）

## 当前阶段：T0 基础设施

仅有 main.go 骨架，验证 cgo 交叉编译链路打通。下一阶段 T1 开始搬业务代码。

参考文档：
- `docs/superpowers/specs/2026-05-04-subsystem-b1-wss-channel-design.md` §18（B3 范围预告）
- `docs/handoffs/`（最新一份 handoff 含 B3 完整执行 todo）
