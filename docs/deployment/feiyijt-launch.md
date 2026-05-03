# feiyijt.com 上线手册（子系统 A：License 颁发）

**目标**：把当前生产（`http://47.82.151.0:18080/ng-antd-admin/`）切到 `https://www.feiyijt.com/`，同时交付客户侧一键部署脚本。

**前置**：
- 所有代码已 merge 到 `main` 并 push（本手册前的 5 个 commit `8494256d → 896c1e0b → 部署 commit`）
- 阿里云生产机：`47.82.151.0`，Ubuntu 24.04，root 可登录
- 宿主机 80/443 被 `cardshop-app` 容器（nginx）占用

---

## 阶段 0：本地预检（已完成）

```sh
# nest-api
cd nest-api && npx jest && npm run build      # ✅ 201 pass / 2 已知基线失败 / 零 error

# ui
cd ui && npx ng test --watch=false && npx ng build   # ✅ 292/292 / 零 error

# install.sh
shellcheck --severity=warning --shell=sh scripts/install.sh    # ✅ 零 warning
```

---

## 阶段 1：Cloudflare 配置（由用户在 CF 控制台完成）

1. **DNS**
   - A 记录 `www` → `47.82.151.0`，proxied（橙云）
   - A 记录 `@`（裸 feiyijt.com）→ 同上，proxied

2. **SSL/TLS**
   - 模式：**Full (strict)**
   - Edge Certificates → Always Use HTTPS：On
   - Origin Server → Create Certificate：
     - 选 ECC（或 RSA 2048）
     - SAN：`*.feiyijt.com, feiyijt.com`
     - 有效期：15 年
   - 下载两个文件（`.pem` 与 `.key`），**立刻本地保存**

3. **Network**
   - WebSockets：On（为子系统 B 预留）

---

## 阶段 2：上传 Origin Cert 到宿主机

```sh
# 本地：传文件上去（scp 需本地有 cert）
scp feiyijt.com.crt root@47.82.151.0:/etc/nginx/ssl/feiyijt.com.crt
scp feiyijt.com.key root@47.82.151.0:/etc/nginx/ssl/feiyijt.com.key

# 生产机：修权限
ssh root@47.82.151.0
mkdir -p /etc/nginx/ssl
chmod 644 /etc/nginx/ssl/feiyijt.com.crt
chmod 600 /etc/nginx/ssl/feiyijt.com.key
chown root:root /etc/nginx/ssl/feiyijt.com.*
```

**验证**：`openssl x509 -in /etc/nginx/ssl/feiyijt.com.crt -noout -subject -dates` 看 CN/日期正确。

---

## 阶段 3：准备 License 主密钥

```sh
# 生产机：生成 base64(32 字节)
KEY=$(openssl rand -base64 32)
echo "LICENSE_SECRET_ENC_KEY=$KEY"

# 写入 .env（根据现有部署文件位置调整）
#   - 若仓库 .env 已存在：追加一行
#   - 若用 /opt/maer-energy/shared/api.env：追加到那里，并在 compose 里 env_file 引用
# 当前仓库模式：根目录 .env 被 docker-compose.prod.yml 自动读取
cat >> /opt/maer-energy/current/.env <<EOF
LICENSE_SECRET_ENC_KEY=$KEY
EOF

# ⚠ 备份这个 key 到密码管理器；丢失后所有 license 凭据都无法解密！
```

**验证**：`grep LICENSE_SECRET_ENC_KEY /opt/maer-energy/current/.env` 看到一行。

---

## 阶段 4：部署代码 + 应用 migration

### 4.1 拉新代码 + 构建新镜像

按现有部署流程（参考 `scripts/deploy.sh` 或手工）：

```sh
# 本地：push 代码
git push origin main

# 生产机：
cd /opt/maer-energy/current
git pull origin main
cp -r ui/dist dist.bak-$(date +%Y%m%d-%H%M%S)   # 就地备份
docker compose -p maer-energy -f docker-compose.prod.yml build ui nest-api
```

### 4.2 应用数据库 migration

```sh
# 生产机：
docker cp nest-api/sql/20260503-customers-and-licenses.sql \
  maer-energy-postgres-1:/tmp/migration.sql

docker exec -i maer-energy-postgres-1 \
  psql -U admin -d energybot -f /tmp/migration.sql

# 验证
docker exec -it maer-energy-postgres-1 \
  psql -U admin -d energybot -c '\dt customers licenses'
# 期望：看到两张表
```

**失败回滚**：
```sh
docker cp nest-api/sql/rollback/20260503-customers-and-licenses.rollback.sql \
  maer-energy-postgres-1:/tmp/rollback.sql
docker exec -i maer-energy-postgres-1 \
  psql -U admin -d energybot -f /tmp/rollback.sql
```

### 4.3 重启服务（此时外网还访问不了 UI）

```sh
docker compose -p maer-energy -f docker-compose.prod.yml up -d --force-recreate ui nest-api

# 等待就绪
sleep 10
docker logs maer-energy-nest-api-1 --tail 50 | grep -i "nest application"
# 期望：Nest application successfully started on port 3001

# 此时：
# - 外网 47.82.151.0:18080 已断开（端口绑 127.0.0.1，预期）
# - 本机可测：
curl -sf http://127.0.0.1:18080/ng-antd-admin/ | head -1    # UI 返回 <!doctype html>
curl -sf http://127.0.0.1:13001/api/v1/license/precheck -X POST -d ''   # 期望 400（缺 headers），证明端点活
```

---

## 阶段 5：激活 cardshop nginx 反代

### 5.1 上传 install.sh 到宿主机对外目录

```sh
# 生产机：
mkdir -p /opt/maer-energy/public
cp /opt/maer-energy/current/scripts/install.sh /opt/maer-energy/public/install.sh
chmod 644 /opt/maer-energy/public/install.sh

# 可选：打指纹（子系统 A 不校验，仅便于排查）
sha256sum /opt/maer-energy/public/install.sh | awk '{print $1}' \
  > /opt/maer-energy/public/install.sh.sha256
```

### 5.2 bind-mount 到 cardshop-app

查看 cardshop-app 容器现状：

```sh
docker inspect cardshop-app --format '{{json .Mounts}}' | python3 -m json.tool
```

编辑 cardshop 的 compose（假设 `/opt/cardshop/docker-compose.yml`），在 `cardshop-app` 服务的 `volumes:` 里加：

```yaml
    volumes:
      # （保留现有所有挂载）
      - /opt/maer-energy/public:/var/www/feiyijt-public:ro
      - /opt/maer-energy/current/deploy/www-feiyijt.conf:/etc/nginx/conf.d/www-feiyijt.conf:ro
      - /etc/nginx/ssl:/etc/nginx/ssl:ro
```

同时在 `cardshop-app` 服务加（Linux 下 host.docker.internal 需要显式声明）：

```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

### 5.3 重启 cardshop-app

```sh
cd /opt/cardshop
docker compose up -d --force-recreate cardshop-app

# 等 10 秒后测 nginx 配置合法
docker exec cardshop-app nginx -t
# 期望：configuration file /etc/nginx/nginx.conf test is successful
```

**若 `nginx -t` 失败**：立刻回退 compose 改动（`git checkout -- docker-compose.yml`），`docker compose up -d` 恢复。

### 5.4 逐项验证

```sh
# A. install.sh 可拉
curl -fsSL https://www.feiyijt.com/install.sh | head -1
# 期望：#!/bin/sh

# B. UI 可打开
curl -fsSL https://www.feiyijt.com/ -o /dev/null -w '%{http_code}\n'
# 期望：302（重定向到 /ng-antd-admin/）
curl -fsSL https://www.feiyijt.com/ng-antd-admin/ -o /dev/null -w '%{http_code}\n'
# 期望：200

# C. API 通
curl -s https://www.feiyijt.com/api/v1/license/precheck \
  -X POST -H 'Content-Type: application/json' -d ''
# 期望：{"code":400,"msg":"bad_request","data":null}
# 说明：到了后端且走了 DTO + guard，只是 header 缺失；这证明全链路通

# D. 老域名已断
curl -sS --max-time 5 http://47.82.151.0:18080/ng-antd-admin/ 2>&1 | tail -3
# 期望：Connection refused 或超时（18080 只 127.0.0.1 绑定）
```

---

## 阶段 6：端到端验收

1. 浏览器访问 `https://www.feiyijt.com/` → 自动跳 `/ng-antd-admin/login/login-form`
2. 用 role=1 超管账号登录
3. 左侧菜单找到 **系统管理 → 客户管理**（本次新增）
4. 点 **新增客户**，填：
   - 客户名：`测试客户 A`
   - 联系人：`test@example.com`
5. 提交后弹出凭据抽屉：
   - license key（`ebt_xxx`）
   - license secret（32 字节 base64url）
   - install 命令（完整一行 `curl -fsSL https://www.feiyijt.com/install.sh | LICENSE_KEY=... sh`）
6. **勾选"已安全保存"**，点关闭。
7. 复制 install 命令，在一台可丢弃的 Linux VM（Ubuntu 22.04 VPS / 本地 Docker ubuntu）里粘贴运行：
   ```sh
   # VM 内部：
   curl -fsSL https://www.feiyijt.com/install.sh | LICENSE_KEY=... LICENSE_SECRET=... sh
   ```
   期望输出末尾：
   ```
   [ OK ] License 有效 — 客户：测试客户 A
   [ OK ] Docker 已就绪（或 Docker 安装完成）
   [ OK ] License 已写入 /etc/energybot/license.conf
   ╔═══════════════════════════════════════╗
   ║  EnergyBot 自托管 agent 基础配置完成   ║
   ╚═══════════════════════════════════════╝
   ```
8. 回 UI 客户管理页，点 **吊销 license**
9. 在 VM 里重新跑一遍 install 命令（`sh -s -- --reinstall` 或直接再粘一遍）：
   ```
   [ERR ] License 已被吊销。请联系管理员。
   ```
   exit code 非 0 → 验收通过 ✅

---

## 阶段 7：30 天观察期后，收紧防护

```sh
# 阿里云安全组：关 18080 入站规则（当前已是 127.0.0.1，这步更像"安全冗余"）
# 同时更新内部文档：
#   - 旧：http://47.82.151.0:18080/ng-antd-admin/
#   - 新：https://www.feiyijt.com/

# 删除老 dist.bak 快照
ls -lah /opt/maer-energy/current/dist.bak-* 2>/dev/null
# 保留最近 3 份，其他删
```

---

## 回滚策略

### 阶段 4 失败（migration 坏了）
```sh
# 1. 回退代码
cd /opt/maer-energy/current && git reset --hard <上一个 commit>
# 2. 恢复 dist.bak
rm -rf ui/dist && cp -r dist.bak-<ts> ui/dist
# 3. 跑 rollback SQL（见 4.2 回滚片段）
# 4. docker compose restart
```

### 阶段 5 失败（nginx 配置错）
```sh
# cardshop compose 回滚
cd /opt/cardshop && git checkout -- docker-compose.yml
docker compose up -d cardshop-app
# 验证老访问仍可（只是 feiyijt.com 进不来，非致命）
```

### 彻底放弃上新域名
- 把 docker-compose.prod.yml ui 端口改回 `0.0.0.0:${UI_PORT:-80}:80`
- 原 `47.82.151.0:18080` 恢复可访问
- 已创建的 customers 记录不影响原系统（两条新表与旧功能独立）

---

## 常见故障排查

| 症状 | 可能原因 | 排查 |
|---|---|---|
| install.sh 404 | bind-mount 未生效 | `docker exec cardshop-app ls /var/www/feiyijt-public/` |
| install.sh 首行不是 `#!/bin/sh` | 文件被改动 | `head -1 /opt/maer-energy/public/install.sh` |
| precheck 502 | nest-api 未启 / host.docker.internal 不通 | `docker exec cardshop-app curl -v http://host.docker.internal:13001/api/v1/license/precheck -X POST` |
| precheck 401 `clock_skew` | VM 时间不同步 | `timedatectl` 查状态，`systemctl enable --now systemd-timesyncd` |
| precheck 401 `signature_invalid` | 客户端 secret 错 / LICENSE_SECRET_ENC_KEY 与颁发时不一致 | 先看是不是最近轮换过 key；若是则所有已颁发 license 都要重发 |
| UI 白屏 | baseHref 不对 | `curl -s https://www.feiyijt.com/ng-antd-admin/ | grep base` 看是否 `<base href="/ng-antd-admin/"` |
| 客户管理菜单看不到 | role=1 权限未授 | mock 数据是写死在前端；生产真数据应通过 migration 自动授权——见 `20260503-customers-and-licenses.sql` 末尾 INSERT INTO sys_role_perm |

---

## 涉及文件清单

- **代码**：`896c1e0b ← 33ab9423 ← 6752312b ← 957dbb02`（共 4 commit）
- **配置**：
  - `docker-compose.prod.yml`：ui 127.0.0.1:18080，api 127.0.0.1:13001，加 LICENSE_SECRET_ENC_KEY
  - `.env.example`：新增 LICENSE_SECRET_ENC_KEY 占位
  - `deploy/www-feiyijt.conf`：cardshop nginx 虚拟主机
  - `scripts/install.sh`：客户侧安装脚本
  - `scripts/install.sh.testing.md`：手工测试清单
- **生产机文件**：
  - `/etc/nginx/ssl/feiyijt.com.{crt,key}` —— CF Origin Cert（用户上传）
  - `/opt/maer-energy/public/install.sh` —— 对外静态脚本（部署时拷贝）
  - `/opt/maer-energy/current/.env` —— 追加 LICENSE_SECRET_ENC_KEY
  - `cardshop-app` 容器：volumes + extra_hosts 改动
