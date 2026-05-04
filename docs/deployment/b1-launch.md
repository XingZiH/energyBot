# feiyijt.com 上线手册（子系统 B1：WSS 反向通道 + 我的 Bot）

**目标**：在子系统 A（`https://www.feiyijt.com/` 已跑通 License 颁发）之上，把 B1 全套上线：
- 服务端：`agents` 表 + AgentModule（WSS Gateway + 心跳去抖 + OfflineScheduler）+ `GET /my-bot`
- 前端：`/account/my-bot` 路由 + MyBotService（只读展示 agent 状态与主机 metrics）
- 客户端：新 Go agent（amd64 / arm64 两个二进制）+ systemd unit
- 分发：nginx 加 `/agent`（WSS upgrade）、`/bin/`、`/systemd/` 三条 location
- install.sh：从"只验 license"升级为"验 license + 装 agent"

> ⚠ **本次上线同时切换整个部署架构**（A 版→B1）。背景见 [b1-production-blockers.md](./b1-production-blockers.md)：
> - 生产切到 `docker-compose.prod.yml`（A 版是 `docker-compose.yml`，将被清理）
> - 生产 db 切到 `energybot`（A 版是 `ng-antd-admin-db`，将保留 30 天作备份后 drop）
> - 老 `maer-energy-bot` 容器**停用并删除**（硬编码配置，不可移植；Telegram 业务 B3 复活）
> - 老 `/opt/maer-energy/shared/*.env` 归档到 `backups/legacy-shared-env-*`
> - **Telegram 机器人服务临时中断**到 B3 go-bot 上线（已知代价，已确认）
> - `scripts/deploy.sh` 已加 `--skip-stop-legacy` 以外的默认清理行为，详见脚本头注释

**前置**：
- 子系统 A 已在生产跑通（`https://www.feiyijt.com/` 已是正式入口，Origin Cert、`LICENSE_SECRET_ENC_KEY`、cardshop-app nginx、客户管理菜单全部就绪）
- 本次 HEAD `94194799` 及其前 19 个 commit 已全部合入 `main`，待生产 `scripts/deploy.sh` 克隆新 release 拉取
- 阿里云生产机：`47.82.151.0`，Ubuntu 24.04，root 可登录（SSH 已恢复）

**当前本地 HEAD**：
```
94194799 feat(b1): install.sh 装 agent + nginx /agent /bin /systemd
分支：main
```

---

## 阶段 0：本地预检（已完成）

本次 B1 涉及的 20 个 commit（`5defc962 → 94194799`），按模块汇总：

| 模块 | 关键改动 |
|---|---|
| nest-api `modules/agent/*` | AgentGateway(WSS) + AgentRegistry(内存) + AgentService(DB 去抖 upsert) + AgentOfflineScheduler(90s 超时置 offline) + JSON-RPC 2.0 工具 + HMAC 跨端一致性 fixture |
| nest-api `modules/agent/my-bot.*` | `GET /my-bot` 端点 + MyBotService(userId → customerId → agents) |
| nest-api `src/main.ts` | `app.useWebSocketAdapter(new WsAdapter(app))` |
| nest-api `src/drizzle/schema.ts` | `agentsTable`（L419-436，UNIQUE license_id） |
| nest-api `sql/20260504-agents-table.sql` | 建表 + 菜单"我的 Bot"（code `default:account:my-bot`） + 所有 role 授权 |
| ui `pages/account/my-bot/` | 新路由 + MyBotService，展示 status/host/kernel/uptime/cpu/mem/loadavg/last_hb |
| go-agent/（新工程） | 6 包：jsonrpc / hmac / host (gopsutil v4) / client (WS 自动重连 + 30s 心跳 ticker) / config / log；交叉编译 linux/amd64 & linux/arm64 |
| go-agent/packaging/systemd/ | unit 文件，`User=energybot-agent`、`RestartPreventExitStatus=42`（license 吊销不重启） |
| scripts/install.sh | +`install_agent()` / 重写 `do_uninstall()` / 更新 `print_banner`；架构映射 x86_64→amd64、aarch64→arm64；退出码 12-15 |
| deploy/www-feiyijt.conf | +3 个 location：`= /agent`（WSS upgrade + 5 X-* HMAC headers 透传）、`/bin/`（alias 静态，Content-Disposition attachment）、`/systemd/`（alias 静态，text/plain） |

### 已完成的 4 项烟测

- [x] **nest-api 单元测试**：`pnpm jest --testPathPattern='agent'` → 50/50 全绿
- [x] **nest-api 构建**：`pnpm build` → 零 error（WsAdapter 装配成功）
- [x] **ui 构建**：`pnpm build` → 零 error（基线 style warning 保留）
- [x] **go-agent 测试 + race**：`go test -race -count=3 ./...` → 6 包全绿
- [x] **install.sh shellcheck**：`sh -n` + `shellcheck --severity=warning --shell=sh scripts/install.sh` → 零警告
- [x] **Docker 回归**：
  - `ubuntu:24.04` + 本地 HTTP staging 跑新版 install.sh → 如期在 `/bin/energybot-agent-linux-amd64` 404 时退出码 13（说明 install_agent 路径和返回码走对了）
  - `ubuntu:24.04` + 生产 install.sh → 子系统 A 老版行为仍正确：license 验签通过 + Docker 装好 + `/etc/energybot/license.conf` 落地

### 本地 staging 产物（待上传）

```
/var/folders/9k/_mz8gft91mx04ts2lzgl8rmh0000gn/T/opencode/b1-deploy/
├── bin/
│   ├── energybot-agent-linux-amd64     6.4M  sha256 0a7da806da1ccc7b97948a932e4bcd270cfa9480aa3ae22605972c33fe0aa135
│   ├── energybot-agent-linux-arm64     5.9M  sha256 1f836333ed563539c0b923688c8a025e8fdc14b90e81bf537754bd18032f836d
│   └── SHA256SUMS.txt
└── systemd/
    └── energybot-agent.service         819B
```

---

## 阶段 1：Cloudflare & 基础设施

**子系统 A 已就绪，本阶段复用不动。** 如需复核请参考 `docs/deployment/feiyijt-launch.md` 阶段 1 / 阶段 2。

**本次新增关注点**：
- **WebSockets** 必须在 CF Network 页保持 On（子系统 A 上线时已开启）。关闭会导致 `/agent` 握手阶段被 CF 截断为普通 HTTP。
- **CF Free 计划限 100 个并发 WebSocket**。B1 的每客户 1 长连，100 客户以上必须升级 Pro（目前公测期可容忍）。
- **CF Edge → Origin 的 WS idle 上限约 100s**，agent 30s 心跳在窗口内，不触发断开；若后续改心跳周期，需同步评估。

---

## 阶段 2：部署新 release

**生产部署模型说明**：`/opt/maer-energy/current` 是一个 **symlink**，指向 `/opt/maer-energy/releases/<timestamp>/` 下的某一版历史 release。每次部署 **不是** 在 `current` 里 `git pull`，而是 `scripts/deploy.sh` 克隆一个全新的 release 目录，构建、灌 migration、起服务，最后 `ln -sfn` 把 `current` 切到新目录、清理旧的。

### 2.1 登陆生产机

```sh
ssh -i ~/.ssh/ebt_deploy_key root@47.82.151.0
```

> ⚠ **已知问题**：当前 mac 下的 opencode 内 SSH 客户端被对端在 KEX exchange 阶段即 close，原因待查（人类终端 OK）。本 runbook 所有远端操作均在人类终端里手工执行。

### 2.2 记录当前 current symlink 指向（便于回滚）

```sh
readlink /opt/maer-energy/current
# 期望看到类似：/opt/maer-energy/releases/license-a-20260503-213420
# 把这行输出复制存好，记为 $PREV_RELEASE（回滚时要用）

# 当前 release 的 git HEAD（仅作记录参考）
cd /opt/maer-energy/current
git log -1 --oneline 2>/dev/null || echo "(release 目录不是 git 仓库，正常)"

# 顺手看下 releases 目录里还保留了哪些历史 release
ls -lt /opt/maer-energy/releases/
```

### 2.3 执行 deploy.sh 部署 B1

**⚠ 首次上线 B1 前的一次性前置（后续升级不需要）**：

```sh
# (a) 写 /opt/maer-energy/.env（A 版用 shared/*.env，B1 切到单文件）
#     参考 .env.example，值可从 /opt/maer-energy/shared/{db,api,bot}.env 搬
#     关键：POSTGRES_DB=energybot（不是老的 ng-antd-admin-db）
#     具体值映射见 b1-production-blockers.md 的 P0-3

# (b) 确认 postgres 卷存在（新 compose 用 external: true 复用）
docker volume inspect maer-energy-postgres-data >/dev/null
# 期望退出 0；失败说明卷名不对，停止部署

# (c) 确认当前 postgres 运行的是 17.x（不是 16 或其他）
#     新 compose 固定 postgres:17-bookworm，卷和镜像版本必须一致
docker exec maer-energy-postgres psql -U admin -d postgres -tAc "SHOW server_version_num;" | head -1 | cut -c1-2
# 期望输出 17
```

`scripts/deploy.sh`（约 240 行，仓库根目录）一键做完下面 11 步：

| 步骤 | 做什么 |
|---|---|
| Step 1 | 前置检查：docker / .env / postgres 卷存在 / postgres 主版本匹配 |
| Step 2 | **清理老 A 版资源**：停 `maer-energy-bot` 容器、`down` 老 `docker-compose.yml`、归档 `shared/*.env` 到 `backups/legacy-shared-env-*`（`--skip-stop-legacy` 跳过，不建议） |
| Step 3 | `pg_dump` 当前 db（`.env` 里 `POSTGRES_DB`）到 `/opt/maer-energy/backups/<db>-<ts>.sql` |
| Step 4 | `git clone --depth 1 --branch main` 到 `/opt/maer-energy/releases/<ts>/` |
| Step 5 | 从 `/opt/maer-energy/.env` 复制到新 release 目录 |
| Step 6 | `docker compose -p maer-energy -f docker-compose.prod.yml build` |
| Step 7 | 起 postgres + 等 healthy（最多 60s） |
| Step 8 | 幂等跑 SQL migration：`20260502-agent-bot-configs-unique.sql`、**`20260504-agents-table.sql`（B1）**、可选 `20260503-reset-designer-config.sql` |
| Step 9 | `docker compose up -d` 全量拉起（B1 阶段 = postgres + nest-api + ui；go-bot 在 compose 中已注释） |
| Step 10 | `ln -sfn <新 release> /opt/maer-energy/current`（`--no-push-symlink` 跳过） |
| Step 11 | 清理旧 release，保留最近 3 个 |

执行：

```sh
cd /opt/maer-energy
# deploy.sh 在仓库里，通过 current symlink 可拿到刚好够用的那份：
bash /opt/maer-energy/current/scripts/deploy.sh
# 或先打印看一眼再跑：
#   cat /opt/maer-energy/current/scripts/deploy.sh | less
```

**期望输出末尾**（见 `scripts/deploy.sh:158-173`）：

```
✅ 部署完成
  commit：     94194799 feat(b1): install.sh 装 agent + nginx /agent /bin /systemd
  旧 release： /opt/maer-energy/releases/license-a-20260503-213420
  新 release： /opt/maer-energy/releases/<新时间戳>

烟雾测试：
  curl -f http://47.82.151.0/healthz
  ...

回滚命令：
  ln -sfn /opt/maer-energy/releases/license-a-20260503-213420 /opt/maer-energy/current
  cd /opt/maer-energy/current && docker compose -f docker-compose.prod.yml up -d
```

**把"回滚命令"两行整段复制进备忘**，11.2 节会直接用到。

**若 deploy.sh 中途失败**：新 release 目录会留下不完整状态，`current` symlink 仍指向旧 release（`ln -sfn` 在 Step 7 才执行）。此时服务未受影响；按失败的 Step 走阶段 4 / 阶段 5 手动补救，或修完问题重跑 deploy.sh（新 release 目录换时间戳，旧的不完整 release 会在下下次部署时被 Step 7 清理里带掉）。

---

## 阶段 3：上传 agent 二进制 + systemd unit

**前置**：阶段 2 的 `deploy.sh` 已跑完，新 release 目录已存在、`current` 已切过去、服务已拉起。但 `/opt/maer-energy/public/bin/` 和 `/opt/maer-energy/public/systemd/` 是 **cardshop-app 的 bind-mount 源目录**（和 release 目录平级，不随 release 切换），deploy.sh 不会往里面放 agent 二进制，必须由本阶段单独 rsync。

**说明**：cardshop-app 容器 nginx 通过 bind-mount `/opt/maer-energy/public → /var/www/feiyijt-public:ro` 对外发文件。nginx `/bin/` 和 `/systemd/` 两条 location 都 alias 到该只读挂载，所以我们只要把文件放进宿主 `/opt/maer-energy/public/` 的子目录，立刻就能被 install.sh 拉到。

### 3.1 本地 rsync 上传（mac 终端执行）

```sh
# 先确保目标父目录存在（首次上线需要）
ssh -i ~/.ssh/ebt_deploy_key root@47.82.151.0 \
  'mkdir -p /opt/maer-energy/public/bin /opt/maer-energy/public/systemd'

# 传二进制（2 个架构 + SHA256SUMS.txt）
rsync -avz -e 'ssh -i ~/.ssh/ebt_deploy_key' \
  /var/folders/9k/_mz8gft91mx04ts2lzgl8rmh0000gn/T/opencode/b1-deploy/bin/ \
  root@47.82.151.0:/opt/maer-energy/public/bin/

# 传 systemd unit
rsync -avz -e 'ssh -i ~/.ssh/ebt_deploy_key' \
  /var/folders/9k/_mz8gft91mx04ts2lzgl8rmh0000gn/T/opencode/b1-deploy/systemd/ \
  root@47.82.151.0:/opt/maer-energy/public/systemd/
```

### 3.2 在生产机核对

```sh
ls -la /opt/maer-energy/public/bin/
# 期望 3 个文件：
#   energybot-agent-linux-amd64   6.4M  755
#   energybot-agent-linux-arm64   5.9M  755
#   SHA256SUMS.txt

ls -la /opt/maer-energy/public/systemd/
# 期望 1 个文件：
#   energybot-agent.service        819  644

# 指纹核对（必须和 runbook 0 节列的两个 SHA 一致）
cd /opt/maer-energy/public/bin
sha256sum energybot-agent-linux-amd64 energybot-agent-linux-arm64
# 期望：
#   0a7da806da1ccc7b97948a932e4bcd270cfa9480aa3ae22605972c33fe0aa135  energybot-agent-linux-amd64
#   1f836333ed563539c0b923688c8a025e8fdc14b90e81bf537754bd18032f836d  energybot-agent-linux-arm64

# 或者直接用 SHA256SUMS.txt 自校验：
sha256sum -c SHA256SUMS.txt
# 期望：两行 OK
```

**若指纹不匹配**：绝对不要继续。重新 rsync，或本地重新交叉编译后再传。

### 3.3 权限复核

bind-mount 是 ro，容器里读即可，宿主机文件权限只要 `other` 可读：

```sh
# 本地是 644（systemd unit）和 755（二进制），满足
stat -c '%a %n' /opt/maer-energy/public/bin/* /opt/maer-energy/public/systemd/*
```

---

## 阶段 4：执行 agents 表 migration

> ℹ **本章信息性**：阶段 2 的 `deploy.sh` 已在 Step 5 自动灌过 `nest-api/sql/20260504-agents-table.sql`（见 `scripts/deploy.sh:120-123`）。本章保留**事后人工验证命令**（诊断用）和**完整 SQL 参考**（附录化）。**正常走 deploy.sh 的部署不需要在这里手动执行 migration**。

本次新增 1 张表 + 1 条菜单 + N 条 role_perm 授权，全部在 `nest-api/sql/20260504-agents-table.sql`（105 行，一个事务，幂等：`CREATE TABLE IF NOT EXISTS` / `INSERT ... WHERE NOT EXISTS`）。

> 说明：项目虽引入了 drizzle-kit，但**当前没有启用 drizzle migration 目录**（`nest-api/drizzle/` 不存在）。线上迁移统一走 `nest-api/sql/*.sql`，由 `scripts/deploy.sh` 自动灌入（与子系统 A 阶段的做法一致）。

### 4.1 前置检查（deploy.sh 之前的状态，仅供对照 / 干跑时参考）

```sh
# 表还没建（deploy.sh 跑完后这里会返回 'agents'，不再是 NULL）
docker exec -i maer-energy-postgres \
  psql -U admin -d energybot -c "SELECT to_regclass('public.agents');"
# deploy.sh 之前期望：to_regclass 列是 NULL（空行）
# deploy.sh 之后期望：to_regclass = agents

# customers / licenses 必须已存在（子系统 A 的 FK 目标）
docker exec -i maer-energy-postgres \
  psql -U admin -d energybot -c '\dt public.customers public.licenses'
# 期望：两行

# 老菜单"我的 License"存在（与"我的 Bot" 并列）
docker exec -i maer-energy-postgres \
  psql -U admin -d energybot -c "SELECT id, menu_name, code, order_num FROM public.menu WHERE code LIKE 'default:account:%' ORDER BY order_num;"
# 期望至少看到 default:account:my-license
```

### 4.2 手动执行 migration（仅补救场景使用）

**正常不需要跑这段**。仅当 deploy.sh 在 Step 5 失败、或需要在不走 deploy.sh 的环境手动补灌时使用：

```sh
cd /opt/maer-energy/current

# 把 SQL 文件灌进 postgres 容器
docker cp nest-api/sql/20260504-agents-table.sql \
  maer-energy-postgres:/tmp/b1-agents.sql

docker exec -i maer-energy-postgres \
  psql -U admin -d energybot -f /tmp/b1-agents.sql
# 期望输出（末尾）：
#   BEGIN
#   CREATE TABLE
#   CREATE INDEX
#   CREATE INDEX
#   INSERT 0 1       （菜单。若之前已经 INSERT 过，会是 INSERT 0 0）
#   INSERT 0 N       （N = 现有 role 数量）
#   COMMIT
```

### 4.3 事后核对（deploy.sh 跑完后建议都过一遍）

```sh
docker exec -i maer-energy-postgres \
  psql -U admin -d energybot -c '\d public.agents'
# 期望：看到 17 列（id / license_id / customer_id / status / agent_version / public_ip /
#      host_name / kernel / boot_time / connected_at / last_heartbeat_at / uptime_seconds /
#      cpu_percent / mem_used_bytes / mem_total_bytes / loadavg_1 / updated_at / created_at /
#      deleted_at）以及 2 个索引：
#   idx_agents_customer_id
#   idx_agents_status (WHERE status <> 'never_seen')
# 以及 UNIQUE(license_id) 和对 licenses.id / customers.id 的 FK

docker exec -i maer-energy-postgres \
  psql -U admin -d energybot -c "SELECT id, menu_name, code, path, order_num FROM public.menu WHERE code = 'default:account:my-bot';"
# 期望 1 行：
#   menu_name = 我的 Bot
#   path      = /default/account/my-bot
#   order_num = 210

docker exec -i maer-energy-postgres \
  psql -U admin -d energybot -c "SELECT COUNT(*) FROM public.sys_role_perm WHERE perm_code = 'default:account:my-bot';"
# 期望 = 现有 role 数量（和 SELECT count(*) FROM public.role 一致）
```

### 4.4 完整建表 SQL（附录参考，实际以仓库文件为准）

为备查，下面是从 `nest-api/sql/20260504-agents-table.sql` 摘出的表结构主体：

```sql
CREATE TABLE IF NOT EXISTS public.agents (
    id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    license_id         INTEGER       NOT NULL UNIQUE REFERENCES public.licenses(id),
    customer_id        INTEGER       NOT NULL REFERENCES public.customers(id),
    status             VARCHAR(16)   NOT NULL DEFAULT 'never_seen', -- online | offline | never_seen
    agent_version      VARCHAR(32),
    public_ip          VARCHAR(64),
    host_name          VARCHAR(120),
    kernel             VARCHAR(120),
    boot_time          TIMESTAMP,
    connected_at       TIMESTAMP,
    last_heartbeat_at  TIMESTAMP,
    uptime_seconds     BIGINT,
    cpu_percent        NUMERIC(5, 2),
    mem_used_bytes     BIGINT,
    mem_total_bytes    BIGINT,
    loadavg_1          NUMERIC(6, 2),
    updated_at         TIMESTAMP,
    created_at         TIMESTAMP     NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agents_customer_id ON public.agents (customer_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON public.agents (status) WHERE status <> 'never_seen';
```

---

## 阶段 5：docker compose build + up

> ℹ **本章补救性**：阶段 2 的 `deploy.sh` 已在 Step 4（`scripts/deploy.sh:91-93`）完成镜像构建、Step 6（`scripts/deploy.sh:134-140`）完成 `up -d` 全量拉起。**正常部署不需要手动跑这段**，只在下列场景下进来用：
> - deploy.sh 在 Step 4/5/6 中途失败，需要在新 release 目录里手动补 build/up
> - 修完 code / env 后想单独 rebuild 某一两个服务（`nest-api` `ui`）而不重跑整条流水线
> - 事后想单独看某容器的启动日志

### 5.1 构建新镜像（补救用）

```sh
cd /opt/maer-energy/current
docker compose -p maer-energy -f docker-compose.prod.yml build nest-api ui
# 期望：两个镜像 build 成功，零 error
```

**关键注意**：nest-api 本次引入了 `@nestjs/platform-ws`（见 `src/main.ts:3` 和 `src/main.ts:12`），构建失败通常是依赖没装——此时先在本地 `pnpm install` 后 push lockfile，再重来。

### 5.2 重启服务

```sh
docker compose -p maer-energy -f docker-compose.prod.yml up -d --force-recreate nest-api ui
sleep 10
docker logs maer-energy-nest-api-1 --tail 80
```

**期望在日志里看到**：
- `Nest application successfully started on port 3001`
- `AgentModule` / `AgentGateway` / `AgentService` / `AgentOfflineScheduler` 一众模块被 `Nest` 加载
- 不能出现 `WsAdapter` 相关错误（比如找不到 `ws` 包）

### 5.3 在容器内快速探活

```sh
# REST（子系统 A 旧端点，确保没被 B1 改动搞挂）
docker exec maer-energy-nest-api-1 \
  curl -sf http://127.0.0.1:3001/api/v1/license/precheck -X POST -d '' -o /dev/null -w '%{http_code}\n'
# 期望：400（DTO 拒绝）

# WS handshake 路径（直连容器，绕过 nginx）
docker exec maer-energy-nest-api-1 \
  curl -sf -o /dev/null -w '%{http_code}\n' \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    -H 'Sec-WebSocket-Version: 13' \
    http://127.0.0.1:3001/agent
# 期望：401（HMAC headers 缺失），证明 Gateway 挂上了 /agent 路由
```

---

## 阶段 6：nginx conf 更新 + reload

### 6.1 推新 nginx 配置到 cardshop-app

`deploy/www-feiyijt.conf` 本次新增 3 个 location：`= /agent` / `/bin/` / `/systemd/`。文件在新 release 目录里，通过 `/opt/maer-energy/current` symlink 可稳定取到。

```sh
# 先备份容器里现有配置（出事回滚用）
docker exec cardshop-app cp /etc/nginx/conf.d/www-feiyijt.conf \
  /etc/nginx/conf.d/www-feiyijt.conf.bak-$(date +%Y%m%d-%H%M%S)

# 推新配置（用绝对路径，不依赖当前工作目录）
docker cp /opt/maer-energy/current/deploy/www-feiyijt.conf \
  cardshop-app:/etc/nginx/conf.d/www-feiyijt.conf

# 语法检查（失败不要 reload）
docker exec cardshop-app nginx -t
# 期望：
#   nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
#   nginx: configuration file /etc/nginx/nginx.conf test is successful

# reload（零停机）
docker exec cardshop-app nginx -s reload
```

**若 `nginx -t` 失败**：
```sh
# 回滚到刚才那份 bak
docker exec cardshop-app sh -c \
  'cp /etc/nginx/conf.d/www-feiyijt.conf.bak-* /etc/nginx/conf.d/www-feiyijt.conf && nginx -t && nginx -s reload'
```

### 6.2 持久化（可选但建议）

当前 cardshop-app 的 nginx 配置靠 `docker cp` 推入，容器重建即丢。若将来 `cardshop-app` 要 recreate，应在其 compose 的 `volumes:` 下 bind-mount：

```yaml
    volumes:
      - /opt/maer-energy/current/deploy/www-feiyijt.conf:/etc/nginx/conf.d/www-feiyijt.conf:ro
```

（此步骤子系统 A 阶段应已做过，本次确认即可。）

---

## 阶段 7：本机 smoke test（从公网视角）

在 mac 终端（或任意公网机器）上依次跑：

```sh
# 1. 二进制 amd64
curl -I https://www.feiyijt.com/bin/energybot-agent-linux-amd64
# 期望：HTTP/2 200
#       content-type: application/octet-stream
#       content-disposition: attachment
#       content-length: 6xxxxxx   （~6.4M）

# 2. 二进制 arm64
curl -I https://www.feiyijt.com/bin/energybot-agent-linux-arm64
# 期望：HTTP/2 200，content-length 5xxxxxx

# 3. systemd unit
curl -s https://www.feiyijt.com/systemd/energybot-agent.service | head -3
# 期望：
#   [Unit]
#   Description=EnergyBot Agent
#   Documentation=https://www.feiyijt.com

# 4. install.sh Last-Modified 应是今天
curl -I https://www.feiyijt.com/install.sh
# 期望 last-modified 是今天日期；content-type: text/x-shellscript

# 5. WS handshake 手测（需要 websocat；macOS brew install websocat）
websocat -H='X-License-Key: bogus' wss://www.feiyijt.com/agent
# 期望：立即断开，stderr 打印类似 "WebSocketError: received 401"
#       （Gateway 见缺 X-Timestamp / X-Nonce / X-Signature 直接拒）

# 6. 二进制确可执行（抽 amd64 在本机测 file 头）
curl -sSL -o /tmp/ebt-agent-amd64 https://www.feiyijt.com/bin/energybot-agent-linux-amd64
file /tmp/ebt-agent-amd64
# 期望：ELF 64-bit LSB executable, x86-64, ..., statically linked / Go BuildID
sha256sum /tmp/ebt-agent-amd64
# 期望：0a7da806da1ccc7b97948a932e4bcd270cfa9480aa3ae22605972c33fe0aa135
rm /tmp/ebt-agent-amd64
```

**任一失败**：先查 cardshop-app 日志（`docker exec cardshop-app tail -100 /var/log/nginx/www-feiyijt.error.log`），定位是 bind-mount 没生效、还是上游 api 连不上。

---

## 阶段 8：测试机 43.119.5.98 跑 install.sh

这是全链路验收的关键。测试机已有一套用于 B1 测试的 license 凭据：

```
LICENSE_KEY    = ebt_PkVCTcfGw4EJNiWfLpPbEDS28pGzg2PAy
LICENSE_SECRET = jgU7B_4TAKF8pLIcr-InCS323SwWT74WLhVCE4pQrtQ
```

### 8.1 先清老环境（若已跑过 A 阶段 install.sh）

```sh
ssh root@43.119.5.98 'curl -fsSL https://www.feiyijt.com/install.sh | sh -s -- --uninstall'
# 期望看到：
#   已删除 /etc/systemd/system/energybot-agent.service
#   已删除 /etc/energybot-agent/agent.env
#   已删除 /opt/energybot-agent/bin/energybot-agent
#   已删除 /etc/energybot/license.conf
#   卸载完成
```

（首次安装可跳过。）

### 8.2 执行安装

```sh
ssh root@43.119.5.98 "curl -fsSL https://www.feiyijt.com/install.sh \
  | LICENSE_KEY='ebt_PkVCTcfGw4EJNiWfLpPbEDS28pGzg2PAy' \
    LICENSE_SECRET='jgU7B_4TAKF8pLIcr-InCS323SwWT74WLhVCE4pQrtQ' \
    sh"
```

**期望的关键输出段**（完整输出见 `/var/log/energybot-install.log`）：
```
==> 采集系统信息
==> 检查网络 & 工具链
==> 签名 & 调用 precheck
[ OK ] License 有效 — 客户：<客户名>
==> 安装 Docker（若缺）
[ OK ] Docker 已就绪
==> 写入 License 文件
[ OK ] License 已写入 /etc/energybot/license.conf
==> 安装 energybot-agent
[INFO] 下载 agent 二进制：https://www.feiyijt.com/bin/energybot-agent-linux-amd64
[ OK ] agent 二进制已就位：/opt/energybot-agent/bin/energybot-agent
[ OK ] agent.env 已写入 /etc/energybot-agent/agent.env（权限 640 root:energybot-agent）
[INFO] 下载 systemd unit：https://www.feiyijt.com/systemd/energybot-agent.service
[ OK ] energybot-agent 服务已启动
```

### 8.3 验证 agent 进程 & 日志

```sh
ssh root@43.119.5.98 'systemctl status energybot-agent --no-pager'
# 期望：Active: active (running)，ExecStart 指向 /opt/energybot-agent/bin/energybot-agent

ssh root@43.119.5.98 'journalctl -u energybot-agent -n 100 --no-pager'
# 期望日志顺序（大意）：
#   config loaded (api_url=wss://www.feiyijt.com/agent ...)
#   connecting to wss://www.feiyijt.com/agent
#   hello sent
#   agent ready (handshake ok, server assigned agent_id=N)
#   heartbeat sent (每 30s 一次)
```

### 8.4 从服务端视角核对

```sh
# 服务端：agents 表里应多一行
docker exec -i maer-energy-postgres \
  psql -U admin -d energybot -c \
  "SELECT id, license_id, customer_id, status, agent_version, host_name, last_heartbeat_at FROM public.agents ORDER BY created_at DESC LIMIT 5;"
# 期望：看到一行 status=online、host_name=<测试机 hostname>、last_heartbeat_at 在 30s 内
```

---

## 阶段 9：控制台验证「我的 Bot」

1. 浏览器打开 `https://www.feiyijt.com/ng-antd-admin/`
2. 以**测试机对应 license 的客户账号**登录（不是超管；超管没有绑定 customer，会走空态）
3. 左侧菜单应出现「账户」→「我的 Bot」（若没有，说明菜单权限 migration 没刷到该账号角色，回 4.3 复查）
4. 页面应展示：
   - 顶栏状态徽标：**online**（绿色）
   - Host：测试机 hostname
   - Kernel：如 `Linux 5.15.x-generic`
   - Agent 版本：语义版本号（Go agent 编译时注入）
   - Uptime / CPU% / Mem / Loadavg1：非空
   - Last heartbeat：`X 秒前`，X ≤ 30

**若状态长时间 never_seen**：
- 测试机 journalctl 里没 `agent ready` → WSS 握手失败，看 nest-api 容器日志
- 服务端 agents 表里 license_id 无记录 → license 不匹配或签名失败

---

## 阶段 10：回归测试：离线检测

验证 OfflineScheduler（90s 心跳超时 → 置 offline）+ 重连恢复 online 的闭环。

```sh
# 1. 停止测试机 agent
ssh root@43.119.5.98 'systemctl stop energybot-agent'

# 2. 等 90 秒（30s 心跳 + 30s scheduler tick + 30s safety）
sleep 90

# 3. 刷新「我的 Bot」页 → 状态应是 offline（红色）
#    或命令行核对：
docker exec -i maer-energy-postgres \
  psql -U admin -d energybot -c \
  "SELECT id, status, last_heartbeat_at FROM public.agents WHERE license_id = (SELECT id FROM licenses WHERE license_key='ebt_PkVCTcfGw4EJNiWfLpPbEDS28pGzg2PAy');"
# 期望：status = 'offline'

# 4. 重启 agent
ssh root@43.119.5.98 'systemctl start energybot-agent'
sleep 45

# 5. 复查
docker exec -i maer-energy-postgres \
  psql -U admin -d energybot -c \
  "SELECT id, status, last_heartbeat_at FROM public.agents WHERE license_id = (SELECT id FROM licenses WHERE license_key='ebt_PkVCTcfGw4EJNiWfLpPbEDS28pGzg2PAy');"
# 期望：status = 'online'，last_heartbeat_at 更新
```

---

## 阶段 11：回滚 plan

**原则**：B1 新功能整体回滚，不要半回滚。回滚顺序倒着来：先 stop agent → 切 nginx → 降服务 → 落 SQL。

### 11.1 快速"关掉 B1 功能，保留基础设施"（轻回滚）

若只是页面或 gateway 出小毛病、但二进制和 DB 都 OK，可只切 symlink 回旧 release：

```sh
# $PREV_RELEASE 是阶段 2.2 记录的 readlink 输出，例如：
#   /opt/maer-energy/releases/license-a-20260503-213420
ln -sfn "$PREV_RELEASE" /opt/maer-energy/current
cd /opt/maer-energy/current
docker compose -f docker-compose.prod.yml up -d --force-recreate
# 这两行就是 deploy.sh 末尾打印的"回滚命令"（见 scripts/deploy.sh:172-173）
```

nginx conf 仍带 `/agent /bin/ /systemd/` 三条 location 不影响子系统 A（前两条是静态，/agent 因 nest-api 回退后无该路由会 404，对客户侧无感）。

### 11.2 全量回滚（硬回退）

```sh
# 1) 通知已装 agent 的测试机停服务（阻止心跳继续打 DB）
ssh root@43.119.5.98 'systemctl stop energybot-agent'

# 2) nginx：回到子系统 A 版本
docker exec cardshop-app sh -c 'cp /etc/nginx/conf.d/www-feiyijt.conf.bak-<时间戳> /etc/nginx/conf.d/www-feiyijt.conf && nginx -t && nginx -s reload'

# 3) 切 current symlink 回旧 release + 重启（照搬 deploy.sh 末尾 L172-173）
ln -sfn "$PREV_RELEASE" /opt/maer-energy/current
cd /opt/maer-energy/current
docker compose -f docker-compose.prod.yml up -d --force-recreate

# 4) DB 回滚（agents + 菜单 + 授权）
#    注意：rollback SQL 必须从旧 release 目录里取（新 release 可能已被 Step 7 的清理机制带走）
docker cp /opt/maer-energy/current/nest-api/sql/rollback/20260504-agents-table.rollback.sql \
  maer-energy-postgres:/tmp/b1-rollback.sql
docker exec -i maer-energy-postgres \
  psql -U admin -d energybot -f /tmp/b1-rollback.sql
# 期望：BEGIN / DELETE M / DELETE 1 / DROP TABLE / COMMIT
# 若旧 release 里没有 rollback 文件（B1 之前的老版本），从 backups 里还原：
#   cat /opt/maer-energy/backups/designer-<新 release 时间戳>.sql | \
#     docker exec -i maer-energy-postgres psql -U admin -d energybot

# 5) 清宿主对外目录（可选，不清也无害，反正 nginx location 不在了）
rm -rf /opt/maer-energy/public/bin /opt/maer-energy/public/systemd
```

### 11.3 单客户封禁（不触发大回滚）

若某客户 agent 异常，可在后台吊销其 license，agent 会收到 WS close code 4003 → Go 端 exit 42 → systemd `RestartPreventExitStatus=42` 生效不自动重启：

```sh
# 服务端吊销（后台 UI 操作；或直接 SQL）
docker exec -i maer-energy-postgres psql -U admin -d energybot -c \
  "UPDATE public.licenses SET revoked_at = now(), revoked_reason = '临时封禁排障' WHERE license_key = 'ebt_xxxxxxx';"
```

---

## 阶段 12：已知遗留问题（上线注意）

以下事项不是 blocker，但需在"周知"文档里登记。

### 12.1 子系统 A 老客户不会自动升级为 agent

A 阶段已装过 `install.sh` 的客户，本次上线不会触发他们重跑脚本（脚本是 pull 模型）。需要：
- 在「客户管理」页加个"需要升级"标记（或发群公告/邮件通知），引导客户重跑一次：
  ```sh
  curl -fsSL https://www.feiyijt.com/install.sh | LICENSE_KEY=... LICENSE_SECRET=... sh -s -- --reinstall
  ```
- 老 license 在 B1 之前没连过 WSS，`agents` 表里对应行 status 保持 `never_seen`，不是 bug。

### 12.2 mac opencode 内 SSH 不通

opencode 容器里 `ssh ... root@47.82.151.0` 在 KEX exchange 阶段被对端 close，人类终端无此现象。本 runbook 所有远端操作都假设在人类终端执行。排查方向：opencode 内 openssh 客户端版本 / 代理 / MTU / KexAlgorithms 差异。记为**技术债 T-001**。

### 12.3 install.sh 日志行号变量展开

`/var/log/energybot-install.log` 里偶见 `脚本在第 ? 行以退出码 13 终止`——POSIX dash 下 trap 上下文里 `$LINENO` 不展开（脚本里已用 `${LINENO:-?}` 兜底避免 `parameter not set` 噪声）。非阻塞，记为**技术债 T-002**，后续可用 `__LINE_LAST` 模式在每段结尾手动 set。

### 12.4 Cloudflare Free 计划 WS 上限

CF Free 计划全账号并发 WebSocket ≤ 100。B1 是每客户 1 长连，**超过 100 个在线客户**必须升级 CF Pro 或改用隧道/自建边缘。监控指标：`SELECT count(*) FROM public.agents WHERE status='online'` 定期抓，接近 80 就要准备。

### 12.5 `/ws/` 预留 location 未清理

阶段 A 的 nginx conf 里留了 `/ws/` 预留（见 `deploy/www-feiyijt.conf` L114-125），B1 实际落地到 `= /agent`。两者不冲突（路径不同），但 `/ws/` 当前是空占位，后续可根据实际规划删除或换用途。

---

## 附录 A：本次改动涉及的文件清单

- **数据库**：
  - `nest-api/sql/20260504-agents-table.sql`（forward）
  - `nest-api/sql/rollback/20260504-agents-table.rollback.sql`
- **nest-api 代码**：
  - `src/drizzle/schema.ts`（新增 `agentsTable` L419-436）
  - `src/main.ts`（`WsAdapter` 装配）
  - `src/modules/agent/`（新模块：gateway / registry / service / offline-scheduler / my-bot.controller / my-bot.service + specs + util）
- **前端**：
  - `ui/src/app/pages/account/my-bot/`（组件 + service + spec）
  - `ui/src/app/pages/account/account-routing.ts`（补路由）
- **Go agent**（新工程）：
  - `go-agent/cmd/energybot-agent/main.go`
  - `go-agent/internal/{jsonrpc,hmac,host,client,config,log}/`
  - `go-agent/packaging/systemd/energybot-agent.service`
- **脚本/配置**：
  - `scripts/install.sh`（+`install_agent`，重写 `do_uninstall`，刷新 `print_banner`）
  - `deploy/www-feiyijt.conf`（+3 个 location）

## 附录 B：生产机文件落位一览

**`/opt/maer-energy/` 目录结构**（B1 上线后稳态）：

```
/opt/maer-energy/
├── current                 -> releases/<最新 release 时间戳>/   （symlink，部署时由 deploy.sh 原子切换）
├── releases/               （历史 release 目录，deploy.sh 保留最近 3 个）
│   ├── license-a-20260503-213420/   （B1 之前的最后一版，可作 $PREV_RELEASE）
│   ├── <B1 时间戳>/                  （本次部署新 release，git clone 全量代码）
│   └── ...
├── backups/                （deploy.sh Step 1 产物：pg_dump 全量备份）
│   └── designer-<ts>.sql
├── shared/                 （暂存 shared 只读素材；.env 通过 ../. env 形式保存）
├── .env                    （shared env；由 deploy.sh Step 3 复制到每个 release 目录，含所有 DB/LICENSE/CF secret）
└── public/                 （cardshop-app bind-mount `:ro` 源，nginx alias 直发）
    ├── install.sh          （子系统 A 已落地）
    ├── bin/                （B1 新增）
    │   ├── energybot-agent-linux-amd64
    │   ├── energybot-agent-linux-arm64
    │   └── SHA256SUMS.txt
    └── systemd/            （B1 新增）
        └── energybot-agent.service
```

**关键点**：
- `current` **是 symlink，不是 git 仓库**。不要在 `/opt/maer-energy/current` 里跑 `git pull` / `git reset`——每次部署都是新 release 目录，`git` 历史只在该 release 自身的 `.git/` 里。
- `releases/<ts>/` 目录是 `git clone --depth 1` 出来的浅克隆，里面有 `scripts/deploy.sh`。下一次部署从 `current/scripts/deploy.sh` 起动（见阶段 2.3）。
- `public/` **不随 release 切换**（cardshop-app 一直挂宿主机这个目录），B1 的 agent 二进制和 systemd unit 必须单独 rsync（阶段 3），deploy.sh 不碰它。
- Postgres 数据卷由 docker compose 管理，**不在 `/opt/maer-energy/` 树下**；DB 迁移历史见 `public.agents` 表 + 2 索引 + 菜单 `default:account:my-bot` + N 条 `sys_role_perm`（B1 新增）。

## 附录 C：客户侧文件落位（由 install.sh 写入）

- `/opt/energybot-agent/bin/energybot-agent`（755 root:root）
- `/etc/energybot-agent/agent.env`（640 root:energybot-agent；含 `EBT_LICENSE_KEY` / `EBT_LICENSE_SECRET` / `EBT_API_URL=wss://www.feiyijt.com/agent` / `EBT_LOG_LEVEL`）
- `/etc/systemd/system/energybot-agent.service`（644 root:root）
- `/var/lib/energybot-agent/`（runtime 数据目录，systemd `ReadWritePaths` 白名单）
- `/var/log/energybot-agent/`（预留；当前日志主要走 journald）
- 系统用户 `energybot-agent`（`--system --no-create-home --shell /usr/sbin/nologin`）

## 附录 D：Agent 退出码约定

| 退出码 | 含义 | systemd 是否重启 |
|---|---|---|
| 0 | 正常退出（kill -TERM） | 是（Restart=always） |
| 42 | WS 收到 close 4003（license 吊销/被替换连接） | **否**（`RestartPreventExitStatus=42`） |
| 其他 | 各类错误（config 不合法 / 连不上服务端 / panic 恢复后退出） | 是（5s 后重启） |
