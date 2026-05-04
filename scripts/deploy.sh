#!/usr/bin/env bash
# Bot Designer 生产部署脚本
#
# 用法（在服务器上，/opt/maer-energy/ 目录执行）：
#   bash deploy.sh                   升级部署（默认：备份 + reset v1）
#   bash deploy.sh --skip-backup     首次部署跳过备份
#   bash deploy.sh --skip-reset-v1   保留现有 v1 designer 数据
#   bash deploy.sh --skip-backup --skip-reset-v1   纯首次部署
#
# 前置条件：
#   - 已完成首次 schema 初始化（详见 docs/deploy-bot-designer.md Step 5.2）
#   - /opt/maer-energy/.env 已存在且填好所有 REPLACE_ME
#
# 本脚本对应手册 Step 2-7，Step 1（备份）只在非首次部署时执行，
# Step 5.2（基线 schema 导入）**不在** 脚本范围内，必须手动先做。

set -euo pipefail

# ---------- 参数 ----------
SKIP_BACKUP=0
SKIP_RESET_V1=0
for arg in "$@"; do
  case $arg in
    --skip-backup)   SKIP_BACKUP=1 ;;
    --skip-reset-v1) SKIP_RESET_V1=1 ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数：$arg" >&2
      exit 2
      ;;
  esac
done

# ---------- 常量 ----------
ROOT_DIR="/opt/maer-energy"
SHARED_ENV="$ROOT_DIR/.env"
REPO_URL="https://github.com/XingZiH/energyBot.git"
BRANCH="main"

RELEASE_TS="$(date +%Y%m%d-%H%M%S)"
RELEASE_DIR="$ROOT_DIR/releases/$RELEASE_TS"
OLD_RELEASE="$(readlink "$ROOT_DIR/current" 2>/dev/null || echo "")"

log()  { printf '\033[1;36m[%s] %s\033[0m\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '\033[1;33m[%s] ⚠️  %s\033[0m\n' "$(date +%H:%M:%S)" "$*"; }
die()  { printf '\033[1;31m[%s] ❌ %s\033[0m\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

# ---------- 前置检查 ----------
[[ "$(id -u)" -eq 0 ]] || warn "未用 root 执行，docker 命令可能失败"
command -v docker >/dev/null || die "未安装 docker"
docker compose version >/dev/null 2>&1 || die "未安装 docker compose v2"
[[ -f "$SHARED_ENV" ]] || die "$SHARED_ENV 不存在，请先参考 .env.example 创建"
if grep -q "REPLACE_ME" "$SHARED_ENV"; then
  die "$SHARED_ENV 还有 REPLACE_ME 未替换"
fi

cd "$ROOT_DIR"
mkdir -p releases backups

log "开始部署：$RELEASE_TS"
log "旧 release：${OLD_RELEASE:-(首次部署)}"

# ---------- Step 1: 备份 ----------
if [[ $SKIP_BACKUP -eq 0 && -n "$OLD_RELEASE" ]]; then
  log "备份数据库..."
  BACKUP="$ROOT_DIR/backups/designer-$RELEASE_TS.sql"
  docker compose -f "$ROOT_DIR/current/docker-compose.prod.yml" exec -T postgres \
    pg_dump -U admin energybot > "$BACKUP"
  if [[ ! -s "$BACKUP" ]]; then
    die "备份文件为空：$BACKUP"
  fi
  log "备份完成：$BACKUP ($(du -h "$BACKUP" | cut -f1))"
else
  log "跳过备份（--skip-backup 或首次部署）"
fi

# ---------- Step 2: 拉代码 ----------
log "克隆到 $RELEASE_DIR..."
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$RELEASE_DIR"
cd "$RELEASE_DIR"
COMMIT="$(git log -1 --pretty=format:'%h %s')"
log "部署 commit：$COMMIT"

# ---------- Step 3: 复制 .env ----------
cp "$SHARED_ENV" "$RELEASE_DIR/.env"
log "复制 .env 完成"

# ---------- Step 4: 构建镜像 ----------
log "构建镜像（首次约 5-10 分钟）..."
docker compose -f docker-compose.prod.yml build

# ---------- Step 5: postgres + migration ----------
log "启动 postgres..."
docker compose -f docker-compose.prod.yml up -d postgres

# 等 postgres healthy（不直接 sleep，更稳）
log "等待 postgres healthy..."
for i in {1..30}; do
  status="$(docker compose -f docker-compose.prod.yml ps --format json postgres 2>/dev/null \
            | grep -o '"Health":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
  if [[ "$status" == "healthy" ]]; then
    log "postgres healthy"
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    die "postgres 60 秒内未 healthy，检查 docker compose logs postgres"
  fi
done

log "执行 SQL 迁移：20260502-agent-bot-configs-unique（幂等）"
cat nest-api/sql/20260502-agent-bot-configs-unique.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U admin -d energybot -v ON_ERROR_STOP=1

# B1 agents 表 + 菜单 + 授权（幂等，用 IF NOT EXISTS / INSERT ... WHERE NOT EXISTS）
log "执行 SQL 迁移：20260504-agents-table（B1，幂等）"
cat nest-api/sql/20260504-agents-table.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U admin -d energybot -v ON_ERROR_STOP=1

if [[ $SKIP_RESET_V1 -eq 0 && -n "$OLD_RELEASE" ]]; then
  warn "执行 v1 数据清空：20260503-reset-designer-config"
  cat nest-api/sql/20260503-reset-designer-config.sql | \
    docker compose -f docker-compose.prod.yml exec -T postgres \
      psql -U admin -d energybot -v ON_ERROR_STOP=1
else
  log "跳过 v1 清空（--skip-reset-v1 或首次部署）"
fi

# ---------- Step 6: 起全部服务 ----------
log "启动全部服务..."
docker compose -f docker-compose.prod.yml up -d
sleep 15

log "服务状态："
docker compose -f docker-compose.prod.yml ps

# ---------- Step 7: 切 current ----------
log "切换 current 软链 → $RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "$ROOT_DIR/current"

# ---------- 清理旧 release ----------
log "清理旧 release，保留最近 3 个..."
cd "$ROOT_DIR/releases"
# 保护 current 指向的目录
CURRENT_TARGET_BASENAME="$(basename "$(readlink "$ROOT_DIR/current")")"
ls -t | tail -n +4 | while read -r old; do
  if [[ "$old" != "$CURRENT_TARGET_BASENAME" ]]; then
    rm -rf "$old" && log "  删除 $old"
  fi
done

# ---------- 汇总 ----------
cat <<EOF

\033[1;32m✅ 部署完成\033[0m
  commit：     $COMMIT
  旧 release： ${OLD_RELEASE:-(首次部署)}
  新 release： $RELEASE_DIR

\033[1;36m烟雾测试：\033[0m
  curl -f http://47.82.151.0/healthz
  curl -fI http://47.82.151.0/
  浏览器访问  http://47.82.151.0/    登录后进入「机器人配置」
  Telegram 给 bot 发 /start

\033[1;33m回滚命令：\033[0m
  ln -sfn "${OLD_RELEASE:-<旧路径>}" $ROOT_DIR/current
  cd $ROOT_DIR/current && docker compose -f docker-compose.prod.yml up -d
EOF
