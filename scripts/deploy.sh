#!/usr/bin/env bash
# Bot Designer 生产部署脚本（B1 版）
#
# 用法（在服务器上，/opt/maer-energy/ 目录执行）：
#   bash deploy.sh                   升级部署（默认：备份 + 停老容器 + 迁移 + 切 symlink）
#   bash deploy.sh --skip-backup     首次部署跳过备份
#   bash deploy.sh --skip-reset-v1   保留现有 v1 designer 数据
#   bash deploy.sh --skip-stop-legacy 跳过老 A 版容器/compose 清理（不建议）
#   bash deploy.sh --no-push-symlink 不切 symlink（仅构建和起服务）
#   bash deploy.sh --help            显示本帮助
#
# 前置条件：
#   - 已安装 docker + docker compose v2
#   - /opt/maer-energy/.env 存在且已填好所有 REPLACE_ME
#   - postgres 卷 maer-energy-postgres-data 已存在（A 版部署即已创建）
#
# 本脚本功能：
#   Step 1: 前置检查（docker / .env / postgres 卷 / postgres 镜像版本匹配）
#   Step 2: 清理老 A 版容器和 compose（--skip-stop-legacy 跳过）
#   Step 3: 备份 postgres 数据库（--skip-backup 跳过）
#   Step 4: git clone 新 release
#   Step 5: 复制 .env
#   Step 6: 构建镜像
#   Step 7: 启动 postgres + 等 healthy
#   Step 8: 跑 SQL migration（幂等）
#   Step 9: 启动全部服务
#   Step 10: 切换 current symlink
#   Step 11: 清理旧 release（保留最近 3 个）

set -euo pipefail

# ---------- 参数 ----------
SKIP_BACKUP=0
SKIP_RESET_V1=0
SKIP_STOP_LEGACY=0
NO_PUSH_SYMLINK=0
for arg in "$@"; do
  case $arg in
    --skip-backup)      SKIP_BACKUP=1 ;;
    --skip-reset-v1)    SKIP_RESET_V1=1 ;;
    --skip-stop-legacy) SKIP_STOP_LEGACY=1 ;;
    --no-push-symlink)  NO_PUSH_SYMLINK=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"
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
POSTGRES_VOLUME="maer-energy-postgres-data"
POSTGRES_EXPECTED_MAJOR="17"
COMPOSE_PROJECT="maer-energy"
COMPOSE_FILE="docker-compose.prod.yml"

RELEASE_TS="$(date +%Y%m%d-%H%M%S)"
RELEASE_DIR="$ROOT_DIR/releases/$RELEASE_TS"
OLD_RELEASE="$(readlink "$ROOT_DIR/current" 2>/dev/null || echo "")"

log()  { printf '\033[1;36m[%s] %s\033[0m\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '\033[1;33m[%s] ⚠️  %s\033[0m\n' "$(date +%H:%M:%S)" "$*"; }
die()  { printf '\033[1;31m[%s] ❌ %s\033[0m\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

# ---------- Step 1: 前置检查 ----------
log "Step 1: 前置检查"
[[ "$(id -u)" -eq 0 ]] || warn "未用 root 执行，docker 命令可能失败"
command -v docker >/dev/null || die "未安装 docker"
docker compose version >/dev/null 2>&1 || die "未安装 docker compose v2"
command -v git >/dev/null || die "未安装 git"
command -v curl >/dev/null || die "未安装 curl"

[[ -f "$SHARED_ENV" ]] || die "$SHARED_ENV 不存在，请先参考 .env.example 创建"
if grep -q "REPLACE_ME" "$SHARED_ENV"; then
  die "$SHARED_ENV 仍有 REPLACE_ME 未替换"
fi

# 检查 postgres 卷存在（防止 compose 静默新建空卷）
if ! docker volume inspect "$POSTGRES_VOLUME" >/dev/null 2>&1; then
  die "postgres 卷 $POSTGRES_VOLUME 不存在。首次部署全新机器请先跑：docker volume create $POSTGRES_VOLUME"
fi

# 如果 postgres 已在跑，检查主版本匹配（防升级踩坑）
if docker ps --format '{{.Names}}' | grep -qx maer-energy-postgres; then
  CURRENT_PG_VERSION="$(docker exec maer-energy-postgres psql -U admin -d postgres -tAc 'SHOW server_version_num;' 2>/dev/null | head -1 | cut -c1-2 || echo '')"
  if [[ -n "$CURRENT_PG_VERSION" && "$CURRENT_PG_VERSION" != "$POSTGRES_EXPECTED_MAJOR" ]]; then
    die "当前运行的 postgres 主版本 $CURRENT_PG_VERSION ≠ 期望 $POSTGRES_EXPECTED_MAJOR；卷不兼容，禁止继续"
  fi
  log "  postgres 主版本确认：$CURRENT_PG_VERSION ✓"
fi

cd "$ROOT_DIR"
mkdir -p releases backups

log "开始部署：$RELEASE_TS"
log "旧 release：${OLD_RELEASE:-(首次部署)}"

# ---------- Step 2: 清理老 A 版容器和 compose ----------
# A 版用的是 /opt/maer-energy/current/docker-compose.yml（非 prod 后缀）+ 独立 bot 容器
# B1 之后全部走 docker-compose.prod.yml，老资源必须清理
if [[ $SKIP_STOP_LEGACY -eq 0 ]]; then
  log "Step 2: 清理老 A 版容器 / compose / shared env"

  # 2.1 停 A 版 bot（硬编码配置 + 连老 db，B1 后不再存在）
  if docker ps -a --format '{{.Names}}' | grep -qx maer-energy-bot; then
    log "  停 maer-energy-bot"
    docker stop maer-energy-bot >/dev/null 2>&1 || true
    docker rm -f maer-energy-bot >/dev/null 2>&1 || true
  fi

  # 2.2 如果 current 里有老 compose（非 prod 版），down 它
  LEGACY_COMPOSE="$ROOT_DIR/current/docker-compose.yml"
  if [[ -f "$LEGACY_COMPOSE" ]]; then
    log "  down 老 compose：$LEGACY_COMPOSE"
    docker compose -p "$COMPOSE_PROJECT" -f "$LEGACY_COMPOSE" down --remove-orphans >/dev/null 2>&1 || true
  fi

  # 2.3 归档老 shared env（不删，挪到 backups/legacy-env/）
  if [[ -d "$ROOT_DIR/shared" ]]; then
    ARCHIVE="$ROOT_DIR/backups/legacy-shared-env-$RELEASE_TS"
    log "  归档 shared/*.env → $ARCHIVE"
    mv "$ROOT_DIR/shared" "$ARCHIVE"
  fi
else
  log "Step 2: 跳过老容器清理（--skip-stop-legacy）"
fi

# ---------- Step 3: 备份 postgres ----------
# 备份目标 db 来自 .env 里的 POSTGRES_DB
POSTGRES_DB_NAME="$(grep -E '^POSTGRES_DB=' "$SHARED_ENV" | cut -d'=' -f2- | tr -d '"' | tr -d "'")"
[[ -n "$POSTGRES_DB_NAME" ]] || die ".env 缺 POSTGRES_DB"

if [[ $SKIP_BACKUP -eq 0 ]]; then
  log "Step 3: 备份数据库 $POSTGRES_DB_NAME"
  if docker ps --format '{{.Names}}' | grep -qx maer-energy-postgres; then
    BACKUP="$ROOT_DIR/backups/$POSTGRES_DB_NAME-$RELEASE_TS.sql"
    docker exec -t maer-energy-postgres pg_dump -U admin "$POSTGRES_DB_NAME" > "$BACKUP"
    if [[ ! -s "$BACKUP" ]]; then
      die "备份文件为空：$BACKUP"
    fi
    log "  备份完成：$BACKUP ($(du -h "$BACKUP" | cut -f1))"
  else
    warn "  postgres 容器未运行，跳过备份（首次部署正常）"
  fi
else
  log "Step 3: 跳过备份（--skip-backup）"
fi

# ---------- Step 4: git clone ----------
log "Step 4: 克隆到 $RELEASE_DIR"
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$RELEASE_DIR"
cd "$RELEASE_DIR"
COMMIT="$(git log -1 --pretty=format:'%h %s')"
log "  部署 commit：$COMMIT"

# ---------- Step 5: 复制 .env ----------
log "Step 5: 复制 .env"
cp "$SHARED_ENV" "$RELEASE_DIR/.env"

# ---------- Step 6: 构建镜像 ----------
log "Step 6: 构建镜像（首次约 5-10 分钟）"
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" build

# ---------- Step 7: 启动 postgres + 等 healthy ----------
log "Step 7: 启动 postgres"
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" up -d postgres

log "  等待 postgres healthy..."
for i in {1..30}; do
  status="$(docker inspect --format '{{.State.Health.Status}}' maer-energy-postgres 2>/dev/null || echo '')"
  if [[ "$status" == "healthy" ]]; then
    log "  postgres healthy ✓"
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" logs postgres | tail -40
    die "postgres 60 秒内未 healthy"
  fi
done

# ---------- Step 8: 跑 SQL migration ----------
run_sql() {
  local sql_file="$1"
  local description="$2"
  if [[ ! -f "$sql_file" ]]; then
    warn "  跳过 $description：$sql_file 不存在"
    return 0
  fi
  log "  执行 SQL：$description"
  docker exec -i maer-energy-postgres \
    psql -U admin -d "$POSTGRES_DB_NAME" -v ON_ERROR_STOP=1 < "$sql_file"
}

log "Step 8: 跑 SQL migration（全部幂等）"

# 顺序：先 agent-bot-configs-unique → agents 表 → agents bot runtime (B3) → v1 reset（可选）
run_sql "nest-api/sql/20260502-agent-bot-configs-unique.sql" "20260502-agent-bot-configs-unique"
run_sql "nest-api/sql/20260504-agents-table.sql"            "20260504-agents-table（B1 agents 表 + 菜单 + 授权）"
run_sql "nest-api/sql/20260505-agents-bot-runtime.sql"      "20260505-agents-bot-runtime（B3 心跳 bot_* 6 列）"
run_sql "nest-api/sql/20260505-catfee-payer-private-key.sql" "20260505-catfee-payer-private-key（T11.11 catfee 模式独立私钥列）"
run_sql "nest-api/sql/20260506-t12-drop-justlend.sql"       "20260506-t12-drop-justlend（T12 删 justlend + 加 platform_receive_address）"

if [[ $SKIP_RESET_V1 -eq 0 && -n "$OLD_RELEASE" ]]; then
  warn "  执行 v1 数据清空：20260503-reset-designer-config"
  run_sql "nest-api/sql/20260503-reset-designer-config.sql" "20260503-reset-designer-config"
else
  log "  跳过 v1 清空（--skip-reset-v1 或首次部署）"
fi

# ---------- Step 9: 启动全部服务 ----------
log "Step 9: 启动全部服务"
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" up -d
sleep 10

log "  服务状态："
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" ps

# ---------- Step 10: 切 current ----------
if [[ $NO_PUSH_SYMLINK -eq 0 ]]; then
  log "Step 10: 切换 current 软链 → $RELEASE_DIR"
  ln -sfn "$RELEASE_DIR" "$ROOT_DIR/current"
else
  log "Step 10: 跳过 symlink 切换（--no-push-symlink），请手动：ln -sfn $RELEASE_DIR $ROOT_DIR/current"
fi

# ---------- Step 11: 清理旧 release ----------
log "Step 11: 清理旧 release，保留最近 3 个"
cd "$ROOT_DIR/releases"
CURRENT_TARGET_BASENAME="$(basename "$(readlink "$ROOT_DIR/current")")"
ls -t | tail -n +4 | while read -r old; do
  if [[ "$old" != "$CURRENT_TARGET_BASENAME" ]]; then
    rm -rf "$old" && log "  删除 $old"
  fi
done

# ---------- 汇总 ----------
cat <<EOF

$(printf '\033[1;32m✅ 部署完成\033[0m')
  commit：     $COMMIT
  旧 release： ${OLD_RELEASE:-(首次部署)}
  新 release： $RELEASE_DIR
  目标 db：    $POSTGRES_DB_NAME
  postgres 卷： $POSTGRES_VOLUME

$(printf '\033[1;36m烟雾测试：\033[0m')
  docker compose -p $COMPOSE_PROJECT -f $COMPOSE_FILE ps
  curl -fsS http://127.0.0.1:13001/getHello
  curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/
  浏览器访问 https://www.feiyijt.com/  登录并进入「我的 Bot」

$(printf '\033[1;33m回滚命令：\033[0m')
  ln -sfn "${OLD_RELEASE:-<旧路径>}" $ROOT_DIR/current
  cd $ROOT_DIR/current && docker compose -p $COMPOSE_PROJECT -f $COMPOSE_FILE up -d
EOF
