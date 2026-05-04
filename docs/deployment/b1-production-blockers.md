# B1 生产上线阻塞清单

> 日期：2026-05-04
> 状态：**B1 代码侧完结（23/23 任务 commit），生产上线暂停**
> 原因：生产 A 版环境与 repo main 存在 10 处底层不对齐，超出 B1 scope

本文档记录本次会话通过 SSH 排查发现的所有阻塞项，作为下一个部署会话的输入。

---

## 一、本次会话做了什么

### 已完成（commit 已推 main）
- B1 所有代码 + 测试 + 文档已合入 main（HEAD `ee0ed48d`）
- `scripts/deploy.sh` Step 5 追加 `20260504-agents-table.sql` migration
- `docs/deployment/b1-launch.md` 对齐 release symlink 部署模式（删除 `git pull` 写法）

### 已在生产上做的不可回头操作
- **`pg_dump` 老库 `ng-antd-admin-db`**：备份位置 `/opt/maer-energy/backups/b1-migration-20260504-140808/`
  - `ng-antd-admin-db.dump`（custom format，53 KB）
  - `ng-antd-admin-db.sql`（plain SQL，54 KB）
- **`CREATE DATABASE energybot`**：已创建
- **`pg_restore ng-antd-admin-db.dump → energybot`**：已恢复，18 张表 / 3 customers / 3 licenses / 44 menus 全部到位
- **应用层未切换**：api / bot / ui **仍读 `ng-antd-admin-db`**，新 `energybot` 是冷副本
- 会话 token 预算紧张，决定不继续生 strava 上线

### 下次会话的起点
`/opt/maer-energy/current` 仍指向 `releases/license-a-20260503-213420`；Docker 容器状态不变；两 db 并存；无客户影响。

---

## 二、repo main 与生产 A 版的不对齐项

排序：`P0 阻塞` → `P1 必处理` → `P2 建议统一`

### P0-1：postgres 镜像版本降级

- **生产**：`postgres:17-bookworm`（已跑 PG 17.9，volume `maer-energy-postgres-data` 是 v17 数据）
- **repo**：`docker-compose.prod.yml` L17 写 `postgres:16-alpine`
- **后果**：直接 `docker compose -f docker-compose.prod.yml up -d postgres` 会导致 PG 16 尝试挂 PG 17 数据卷 → **启动失败，数据"可能"需要 pg_upgrade 降级，事实上 PG 不支持大版本降级**
- **解决**：改 L17 `postgres:17-bookworm`，与生产对齐

### P0-2：postgres 卷名不一致

- **生产**：`maer-energy-postgres-data`（17 年来累积数据在此）
- **repo**：`docker-compose.prod.yml` L109 只写 `postgres-data:`（Compose 会生成 `maer-energy_postgres-data` 或项目前缀）
- **后果**：切 compose 后**挂空卷 → 起空数据库**
- **解决**：改 L109-110：
  ```yaml
  volumes:
    postgres-data:
      name: maer-energy-postgres-data
      external: true
  ```

### P0-3：`/opt/maer-energy/.env` 不存在

- **生产**：用 `shared/db.env` / `shared/api.env` / `shared/bot.env` 三个分拆文件，`docker-compose.yml`（非 prod 版）用 `env_file:` 引用
- **repo**：`scripts/deploy.sh` L55 断言 `/opt/maer-energy/.env` 存在，缺失就 die；`docker-compose.prod.yml` 用 `${VAR}` 从此文件读
- **后果**：直接跑 deploy.sh 第一步就 die
- **解决**：写一份 `.env` 合并生成脚本或手工 `.env`，值来源：
  - `POSTGRES_USER=admin`（shared/db.env）
  - `POSTGRES_PASSWORD=04ZYME6sO9OF-jBx-NX3ur_K75Y4Ligy0WRuwlQi`（shared/db.env）
  - `POSTGRES_DB=energybot`（迁移后的新值，原 shared/db.env 是 `ng-antd-admin-db`）
  - `JWT_SECRET=EIpWsyfiy@R@X#qn17!StJNdZK1fFF8iV6ffN!goZkqt#JxO`（shared/api.env 里叫 `SECRET`）
  - `LICENSE_SECRET_ENC_KEY=a1VHEvcyKWZ71PlvuCTpKbu9jZsOX4KB93FodI5MAOU=`（shared/api.env）
  - `TELEGRAM_BOT_TOKEN` / `TRON_*` / `PLATFORM_*` / `ENERGY_*` / `JUSTLEND_*` / `CATFEE_*` —— **⚠ 见 P0-4，A 版生产不存在这些**

### P0-4：A 版 bot 二进制硬编码 token / db name

- **生产**：`maer-energy-bot` 容器 env 里**无**任何 Telegram/TRON 配置；镜像层也**无**；**容器无 mount**；配置**硬编码在 `/usr/local/bin/energy-bot` 二进制内**
- **证据**：`docker logs` 显示 `bot[redacted]/getUpdates` 在跑 Telegram 但 `docker inspect` env 空；日志报 `database=ng-antd-admin-db` 也是硬编码
- **后果**：新 compose 里 go-bot 服务要求 env 注入，但生产不知道历史值；且 A 版二进制**不可移植复用**
- **解决**：
  1. **停掉 A 版 bot** `docker stop maer-energy-bot`（已决定），后续不启动
  2. 新 compose 的 `go-bot` 服务**也暂不启动**（仅 api + ui + postgres + agent 通道）
  3. B3（go-bot 业务迁移）时专门处理 env 来源

### P0-5：compose file 命名差异

- **生产**：`/opt/maer-energy/current/docker-compose.yml`（非 prod 后缀）
- **repo**：`docker-compose.prod.yml`（deploy.sh 用的是这个）
- **后果**：过渡期**新 release 的 compose** 与**旧 release 的 compose** 结构、服务名、网络名都不同
  - 旧：服务名 `api`，build `./api`，单网络
  - 新：服务名 `nest-api`，build `./nest-api`，双网络 `backend`+`frontend`
- **后果**：`docker compose -p maer-energy down` 然后 `up -d` 之间**容器/网络会全部被 recreate** → 比只重启 api/ui 更侵入
- **解决**：
  - deploy.sh 里明确 `-p maer-energy -f docker-compose.prod.yml`
  - 先 `docker compose -p maer-energy -f OLD_COMPOSE down --remove-orphans` 清理老环境
  - 再 `docker compose -p maer-energy -f NEW_COMPOSE up -d`

### P0-6：A 版 release 目录无 `scripts/`

- **生产**：`/opt/maer-energy/releases/license-a-20260503-213420/scripts/deploy.sh` **不存在**（该 release 打出来时 repo 里没 scripts/ 目录，或未随 release 拷贝）
- **后果**：无法直接在 current 上跑 `bash current/scripts/deploy.sh`
- **解决**：deploy.sh 首次使用时，要么：
  - 从 main 先下载 deploy.sh 到 `/opt/maer-energy/scripts/deploy.sh`（脱离 release 目录），或
  - 手动 `git clone` 一个临时目录跑 deploy.sh

### P1-1：shared/*.env 与 `.env` 模型双轨

- **生产**：`shared/{db,api,bot}.env` 是 bind mount 进容器的 `env_file`
- **repo**：`docker-compose.prod.yml` 用 `environment:` + `${VAR}` 从 host `.env` 插值
- **后果**：两种 env 模型并存，**shared/*.env 在新 compose 下完全被忽略** → 人为维护两份
- **解决**：上线后清理 `shared/*.env`，统一用 `/opt/maer-energy/.env`

### P1-2：migration 目录假设

- **生产**：`/opt/maer-energy/current/nest-api/sql/` 有 3 个 A 版 migration（`migration.sql` `migration-unique.sql` 等）
- **repo**：`nest-api/sql/` 有 B1 的 `20260504-agents-table.sql` + rollback
- **deploy.sh L120-123**：按日期顺序跑 `sql/*.sql`
- **后果**：A 版老 migration **会再跑一遍**，可能因 `CREATE TABLE IF NOT EXISTS` 兜底而幂等，但**要逐条核对**
- **解决**：把 migration 改成记录式（`schema_migrations` 表），或审查每个 sql 是否幂等

### P1-3：菜单 seed 路径

- **生产**：A 版的 44 条菜单是 release 时某种 seed 塞进去的
- **repo**：`20260504-agents-table.sql` L52 追加「我的 Bot」菜单 + L75 授权 role_id=1
- **后果**：依赖 `menu` 表 `order_num` 字段排序，但生产无文档说明 order_num 冲突规则
- **解决**：累积技术债 #3，独立处理

### P2-1：bot.env 里的 DATABASE_URL 遗留

- **生产**：`shared/bot.env` 只有 `DATABASE_URL=postgresql://admin:...@postgres:5432/ng-antd-admin-db?schema=public`
- **repo**：新 compose 里 go-bot 的 DATABASE_URL 从 `.env` 拼 `${POSTGRES_DB}`
- **切 db 后**：老 `shared/bot.env` 的 DATABASE_URL 失效（指 `ng-antd-admin-db` 已不再用）
- **解决**：上线后删除 `shared/*.env`

### P2-2：`docker-compose.yml.bak` 残留

- **生产**：`/opt/maer-energy/current/docker-compose.yml.bak` 存在
- **解决**：清理

---

## 三、下次会话的推荐流程

**前置**（10 min）：
1. 读本文档
2. 改 `docker-compose.prod.yml`：
   - L17 `postgres:17-bookworm`
   - L109-110 加 `name: maer-energy-postgres-data`+`external: true`
   - 暂时 **注释掉 go-bot 服务**（附 TODO 链接 B3）
3. 写 `scripts/generate-env.sh`：从 `shared/*.env` 读取 + 手工补 `.env` 里 B1 不需要的字段（Telegram/TRON 留空或占位）
4. commit + push

**部署**（15-25 min）：
1. 写 `/opt/maer-energy/.env`：`POSTGRES_DB=energybot`（切新 db），其他从 shared/*.env 复用
2. **停 A 版 bot**：`docker stop maer-energy-bot && docker rm maer-energy-bot`
3. `git clone --depth 1 --branch main https://github.com/XingZiH/energyBot.git /opt/maer-energy/releases/b1-YYYYMMDD-HHMMSS/`
4. `cd` 新 release，`docker compose -p maer-energy -f docker-compose.prod.yml build nest-api ui`
5. 跑 B1 migration：`docker exec -i maer-energy-postgres psql -U admin -d energybot < sql/20260504-agents-table.sql`
6. 原子切换：
   ```bash
   docker compose -p maer-energy -f /opt/maer-energy/current/docker-compose.yml down --remove-orphans
   ln -sfn /opt/maer-energy/releases/b1-YYYYMMDD-HHMMSS /opt/maer-energy/current
   docker compose -p maer-energy -f /opt/maer-energy/current/docker-compose.prod.yml up -d postgres nest-api ui
   ```
7. 烟测 `/api/v1/license`、`/my-bot`、`/agent` ws 上行

**Agent 静态资源**（5 min）：
8. 本地 rsync agent 二进制 + systemd unit 到 `/opt/maer-energy/public/{bin,systemd}/`
9. nginx conf 更新（cardshop-app 容器内 `nginx -s reload`）

**验证**（10 min）：
10. 测试机 43.119.5.98 跑 `install.sh`
11. 控制台「我的 Bot」验 online
12. 离线回归（`systemctl stop energybot-agent` 观察 90s 后 offline）

---

## 四、回滚预案

如果新 release 的 nest-api/ui 起不来：

```bash
# 切回老 release
ln -sfn /opt/maer-energy/releases/license-a-20260503-213420 /opt/maer-energy/current
docker compose -p maer-energy -f /opt/maer-energy/current/docker-compose.yml up -d
# 如需恢复 db（新 energybot 如写入了新数据，覆盖回老库）
docker exec maer-energy-postgres psql -U admin -d postgres -c "DROP DATABASE energybot;"
# shared/db.env 改回 POSTGRES_DB=ng-antd-admin-db
# 老 bot 容器恢复：docker start maer-energy-bot（如果还在）
```

备份随时可用：`/opt/maer-energy/backups/b1-migration-20260504-140808/`。

---

## 五、生产现状快照（2026-05-04 14:15 UTC+8）

```
current → releases/license-a-20260503-213420
容器：
  - maer-energy-ui (running, 21h)
  - maer-energy-api (running, 21h, healthy)
  - maer-energy-postgres (running, 22h, healthy) - PG 17.9
  - maer-energy-bot (running, 33h) - 硬编码配置

数据库：
  - ng-antd-admin-db (live, api/bot 正在读写)
  - energybot (冷副本，pg_restore 到位但应用未切)

卷：
  - maer-energy-postgres-data (v17)

.env：
  - /opt/maer-energy/.env 不存在
  - /opt/maer-energy/shared/{db,api,bot}.env 存在

备份：
  - /opt/maer-energy/backups/b1-migration-20260504-140808/
    - ng-antd-admin-db.dump (53 KB, custom format)
    - ng-antd-admin-db.sql (54 KB, plain SQL)

agent 静态资源：
  - /opt/maer-energy/public/bin/ 未部署
  - /opt/maer-energy/public/systemd/ 未部署

nginx（cardshop-app 容器内）：
  - /agent /bin /systemd location 未配置
```
