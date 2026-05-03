# Bot Designer 生产部署手册

**目标**：部署 Bot Designer v2（可视化菜单 + 消息模板）到生产
**目标服务器**：47.82.151.0（root）
**访问方式**：IP 直接暴露，无 HTTPS
**版本**：本手册基于 `main` 分支 HEAD

---

## ⚠️ 首次部署必读

如果这是**首次按本手册部署**（即服务器上此前无 Docker、无 `/opt/maer-energy/`）：

- 必须先完成 [附录 A：服务器初始化](#附录-a服务器初始化首次部署)
- 完成后回到 Step 1 继续

如果是**升级部署**：直接从 Step 1 开始。

### 架构概览

生产栈由 4 个容器组成，编排在 `docker-compose.prod.yml`：

| 服务       | 对外 | 端口                 | 说明                                     |
| ---------- | ---- | -------------------- | ---------------------------------------- |
| `ui`       | ✅   | `${UI_PORT:-80}:80`  | Angular SPA + nginx，反代 `/site/api/`   |
| `nest-api` | ❌   | `3000`（容器内）     | NestJS 管理后台 API                      |
| `go-bot`   | ❌   | 无                   | Telegram Bot，**polling 模式**（非 webhook） |
| `postgres` | ❌   | `5432`（容器内）     | PostgreSQL 16，数据存 `postgres-data` volume |

> go-bot 使用 polling（主动调 `getUpdates` 并 `deleteWebhook`），因此 IP 直暴、无 HTTPS 也能正常运作。参考 `go-bot/internal/telegram/bot.go:298`。

---

## 📋 前置清单（本地）

执行部署前在本地确认：

- [ ] `git status` 干净
- [ ] 与 `origin/main` 同步：`git pull origin main`
- [ ] 所有单元测试通过：
  - `cd ui && npm test -- --watch=false --browsers=ChromeHeadless`
  - `cd nest-api && npm test`
  - `cd go-bot && go test ./...`
- [ ] UI 生产构建通过：`cd ui && ./node_modules/.bin/ng build --configuration=production`
- [ ] 主题审计通过：`cd ui && npm run audit:designer-theme`
- [ ] 已推送到远端：`git push origin main`

---

## Step 1：SSH 登录 + 备份数据库

```bash
ssh root@47.82.151.0
cd /opt/maer-energy

# 1.1 备份
mkdir -p backups
BACKUP="/opt/maer-energy/backups/designer-$(date +%Y%m%d-%H%M%S).sql"
docker compose -f current/docker-compose.prod.yml exec -T postgres \
  pg_dump -U admin energybot > "$BACKUP"
ls -lh "$BACKUP"
# 确认文件 > 1KB 且非空
```

> ⚠️ **首次部署无旧数据，此步跳过**。

---

## Step 2：拉取新 release

```bash
RELEASE_TS=$(date +%Y%m%d-%H%M%S)
RELEASE_DIR="/opt/maer-energy/releases/$RELEASE_TS"
git clone --depth 1 --branch main https://github.com/XingZiH/energyBot.git "$RELEASE_DIR"
cd "$RELEASE_DIR"
git log -1 --oneline  # 记录部署的 commit
```

---

## Step 3：配置环境变量

根 `.env.example` 已包含全部变量清单（postgres、JWT、Telegram、TRON、能量供应商等）。

```bash
# 3.1 从示例复制（仅首次）
cd "$RELEASE_DIR"
cp .env.example .env

# 3.2 生成强随机 secret
JWT_NEW=$(openssl rand -base64 48)
PG_PASS=$(openssl rand -base64 32 | tr -d '/+=')
echo "JWT_SECRET=$JWT_NEW"              # 记录到密码管理器
echo "POSTGRES_PASSWORD=$PG_PASS"       # 记录到密码管理器

# 3.3 编辑 .env 文件，替换所有 REPLACE_ME
nano .env
# 必填：
#   POSTGRES_PASSWORD=<PG_PASS>
#   JWT_SECRET=<JWT_NEW>
#   TELEGRAM_BOT_TOKEN=<@BotFather 获取>
#   TRON_API_KEY=<TronGrid 获取>
#   PLATFORM_RECEIVE_ADDRESS=<平台收款地址>
# 按 ENERGY_PROVIDER 选填 JUSTLEND_* 或 CATFEE_* 组
# UI_PORT=80（或 8080 等）
```

> ⚠️ **首次部署必须用新生成的随机值**，不要复用历史中的密码（如 `123456`）或旧 JWT。此前仓库里出现过的 secret 视为已泄露。

**升级部署**：把现有 `/opt/maer-energy/.env` 复制到新 `$RELEASE_DIR/.env` 即可，无需重新生成。

```bash
# 升级部署
cp /opt/maer-energy/.env "$RELEASE_DIR/.env"
```

---

## Step 4：构建镜像

```bash
cd "$RELEASE_DIR"
docker compose -f docker-compose.prod.yml build
# 首次构建约 5-10 分钟（下载 node:24-alpine、nginx、golang 基础镜像）

# 查看镜像
docker images | grep energybot
# 预期三个：energybot-ui / energybot-api / energybot-bot
```

---

## Step 5：启动 postgres + 执行 SQL 迁移

> ⚠️ **nest-api 不会自动建表**。此项目**未使用** Drizzle `drizzle-kit migrate` / Prisma `migrate deploy` 等自动迁移机制（侦察 `nest-api/drizzle.config.ts` 只配置了 kit 的 push 模式，`src/main.ts` 无 migrate 调用）。表结构**必须**手动按顺序导入下述 SQL。

### 5.1 启动 postgres 容器

```bash
docker compose -f docker-compose.prod.yml up -d postgres
sleep 10
docker compose -f docker-compose.prod.yml logs postgres | tail -10
# 预期看到 "database system is ready to accept connections"
```

### 5.2 导入基线 schema（仅首次部署）

```bash
# 5.2.1 主基线（租户、菜单、权限等 277 张表/种子数据）
cat nest-api/ng-antd-admin-db.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U admin -d energybot

# 5.2.2 能量租赁业务表
cat nest-api/sql/energy-rental-init.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U admin -d energybot

cat nest-api/sql/energy-addresses-init.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U admin -d energybot

cat nest-api/sql/energy-rental-bot-runtime.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U admin -d energybot

# 5.2.3 2026-04-30 扩展（Bitcart 充值 + Bot Designer 列）
cat nest-api/sql/20260430-bitcart-recharge-migration.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U admin -d energybot

cat nest-api/sql/20260430-bot-designer-config.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U admin -d energybot
```

> 升级部署（库已有数据）：跳过 5.2，只执行 5.3。

### 5.3 Bot Designer v2 迁移

```bash
# 5.3.1 unique 约束 —— 幂等，任何部署都执行
cat nest-api/sql/20260502-agent-bot-configs-unique.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U admin -d energybot
```

```bash
# 5.3.2 v1 数据清空 —— 仅升级部署执行，首次部署跳过
# ⚠️ 会清空所有 agent 的 menuConfig / messageConfig
# 若需保留 v1 数据，先手动备份或修改脚本
cat nest-api/sql/20260503-reset-designer-config.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U admin -d energybot
```

### 5.4 验证表结构

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U admin -d energybot -c "\dt" | head -40
# 预期看到 agent_bot_configs、energy_packages、energy_orders 等
```

---

## Step 6：启动全部服务

```bash
cd "$RELEASE_DIR"
docker compose -f docker-compose.prod.yml up -d
sleep 15

# 检查状态
docker compose -f docker-compose.prod.yml ps
# 预期 4 服务全部 Up；postgres 显示 (healthy)
# nest-api / go-bot / ui 目前无 healthcheck，只看 Up 即可

# 查看日志（任一出错停下排查）
docker compose -f docker-compose.prod.yml logs --tail=30 nest-api
docker compose -f docker-compose.prod.yml logs --tail=30 go-bot
docker compose -f docker-compose.prod.yml logs --tail=30 ui
```

**go-bot 启动预期**：日志里应出现 `telegram polling started`（见 `go-bot/internal/telegram/bot.go:311`）。如果看到 `deleteWebhook failed` 持续重试，检查 `TELEGRAM_BOT_TOKEN` 是否正确。

---

## Step 7：切换 current 软链

```bash
# 7.1 记录旧 release（用于回滚）
OLD_RELEASE=$(readlink /opt/maer-energy/current 2>/dev/null || echo "(首次部署)")
echo "旧 release: $OLD_RELEASE"

# 7.2 切换
ln -sfn "$RELEASE_DIR" /opt/maer-energy/current
```

> 由于 compose 服务是通过 `docker compose -f <path>` 启动的，切软链本身不会让容器换镜像。真正让容器跑新版的动作是 Step 6 的 `up -d`（Docker 看到镜像/env 变化会 recreate）。软链只是给后续运维命令一个稳定入口。

---

## Step 8：烟雾测试

```bash
# 8.1 HTTP 可达
curl -f http://47.82.151.0/healthz
# 预期输出: ok

curl -fI http://47.82.151.0/
# 预期: 200 OK，Content-Type: text/html

# 8.2 API 反代（路径是 /site/api/，由 ui nginx 反代到 nest-api:3001）
# [需用户确认] nest-api 是否有公共健康端点；目前未侦察到 /health，
# 若 /site/api/ 返回 404 而非 502，说明反代链路通
curl -sI http://47.82.151.0/site/api/ | head -1
```

### 8.3 Bot 响应

- 在 Telegram 给你的 bot 发 `/start`
- 预期返回欢迎菜单（由 Bot Designer v2 配置渲染）

### 8.4 Web UI 登录

- 浏览器打开 `http://47.82.151.0/`
- 用管理员账号登录（默认账号请查基线 SQL 或后台密码管理器）
- 进入「机器人配置」页面
- 三个 tab（欢迎语 / 菜单 / 消息模板）全部能切换、数据能加载

---

## Step 9：清理旧 releases（可选）

```bash
# 保留最近 3 个
cd /opt/maer-energy/releases
ls -t | tail -n +4 | xargs -r rm -rf
```

---

## 🔄 回滚流程

出问题时的快速回滚：

```bash
# 1. 切回旧 release 目录
ln -sfn "$OLD_RELEASE" /opt/maer-energy/current

# 2. 用旧 compose 重启（会拉起旧镜像对应的容器）
cd /opt/maer-energy/current
docker compose -f docker-compose.prod.yml up -d

# 3. 若需回滚数据到 Step 1 的备份：
cat /opt/maer-energy/backups/designer-YYYYMMDD-HHMMSS.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U admin -d energybot
```

> ⚠️ 数据回滚是**全库覆盖**，只在数据结构破坏、无法用 UI 修复时使用。

---

## 附录 A：服务器初始化（首次部署）

```bash
# A.1 SSH 上服务器
ssh root@47.82.151.0

# A.2 安装 Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version
docker compose version

# A.3 创建目录
mkdir -p /opt/maer-energy/{releases,backups}
cd /opt/maer-energy

# A.4 防火墙开 80 端口（按实际发行版选一种）
ufw allow 80/tcp 2>/dev/null || true
firewall-cmd --add-port=80/tcp --permanent 2>/dev/null && firewall-cmd --reload || true
# 阿里云/腾讯云额外在控制台「安全组」放行 80/tcp

# A.5 安装 git（部分系统镜像没自带）
command -v git >/dev/null || (apt-get update && apt-get install -y git) || yum install -y git

# A.6 回到 Step 1 继续
```

---

## 附录 B：FAQ

### Q1 容器起不来？

```bash
docker compose -f docker-compose.prod.yml logs <service>
```

常见原因：

- `.env` 里有 `REPLACE_ME` 未替换 → 填真实值后 `up -d --force-recreate`
- postgres 密码变了但 volume 还是老密码 → 下方 Q6

### Q2 postgres 数据持久化在哪？

Docker named volume `postgres-data`：

```bash
docker volume ls | grep postgres-data
docker volume inspect energybot_postgres-data   # 看物理路径
```

### Q3 镜像构建卡在 `npm install`？

网络问题。应急改国内镜像源（破坏构建复现性，用完**必须**回退）：

```dockerfile
RUN npm config set registry https://registry.npmmirror.com
```

### Q4 修改 `.env` 后如何生效？

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate <service>
# 或全部
docker compose -f docker-compose.prod.yml up -d --force-recreate
```

### Q5 Telegram Bot Token 如何更换？

```bash
nano /opt/maer-energy/current/.env   # 改 TELEGRAM_BOT_TOKEN
docker compose -f docker-compose.prod.yml up -d --force-recreate go-bot
```

### Q6 更换 `POSTGRES_PASSWORD` 后 postgres 起不来？

Postgres 仅在**初始化空数据目录**时读 `POSTGRES_PASSWORD`，事后改 env 无效。正确做法：

```bash
# 1. 备份
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U admin energybot > /opt/maer-energy/backups/before-rotate.sql

# 2. 进容器改密码
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U admin -d postgres -c "ALTER USER admin WITH PASSWORD '新密码';"

# 3. 改 .env 到相同新值
# 4. recreate nest-api / go-bot（它们的 DATABASE_URL 会用新密码）
docker compose -f docker-compose.prod.yml up -d --force-recreate nest-api go-bot
```

### Q7 go-bot 日志一直刷 `getUpdates failed`？

- 检查 `TELEGRAM_BOT_TOKEN` 是否有效
- 检查出口网络是否能访问 `api.telegram.org`（国内服务器常被 GFW 拦截；必要时加代理或用香港/海外节点）

---

## 附录 C：监控建议

部署后第一天建议监控：

```bash
# 错误日志
docker compose -f docker-compose.prod.yml logs --tail=200 nest-api | grep -i error
docker compose -f docker-compose.prod.yml logs --tail=200 go-bot  | grep -i error

# 数据库连接数
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U admin -d energybot -c "SELECT count(*) FROM pg_stat_activity;"

# 容器资源
docker stats --no-stream
```

---

## 附录 D：Secret 轮换记录

首次部署请**记录**（用密码管理器，**不要**提交到仓库）：

| Secret                  | 生成日期   | 下次轮换   | 备注                    |
| ----------------------- | ---------- | ---------- | ----------------------- |
| `POSTGRES_PASSWORD`     | YYYY-MM-DD | +90 天     |                         |
| `JWT_SECRET`            | YYYY-MM-DD | +90 天     | 轮换会让所有 token 失效 |
| `TELEGRAM_BOT_TOKEN`    | YYYY-MM-DD | 按需       | 来自 @BotFather         |
| `TRON_API_KEY`          | YYYY-MM-DD | 按需       | TronGrid 控制台         |
| `JUSTLEND_PAYER_PRIVATE_KEY` | YYYY-MM-DD | 极少轮换   | 丢失等同资金风险        |

建议每 90 天轮换一次高频密钥。`POSTGRES_PASSWORD` 轮换步骤见 [附录 B Q6](#q6-更换-postgres_password-后-postgres-起不来)。
