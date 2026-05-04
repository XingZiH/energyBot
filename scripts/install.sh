#!/bin/sh
# =============================================================================
# EnergyBot 自托管 Agent 一键部署脚本（子系统 A：License 颁发阶段）
#
# 使用方式：
#   # 标准形式（从控制台复制粘贴）
#   curl -fsSL https://www.feiyijt.com/install.sh \
#     | LICENSE_KEY=ebt_xxx LICENSE_SECRET=yyy sh
#
#   # 交互模式（无环境变量，脚本自动 read）
#   curl -fsSL https://www.feiyijt.com/install.sh | sh
#
#   # 仅验证 license，不改机器
#   curl -fsSL https://www.feiyijt.com/install.sh | VERIFY_ONLY=1 sh
#
#   # 覆盖重装（license 换绑新 key）
#   curl -fsSL https://www.feiyijt.com/install.sh | sh -s -- --reinstall
#
#   # 卸载（当前阶段只清 license 文件，agent 部分留给子系统 B）
#   curl -fsSL https://www.feiyijt.com/install.sh | sh -s -- --uninstall
#
# 设计约束：
#   - POSIX sh（不依赖 bash）。通过 shellcheck --severity=warning --shell=sh 零告警
#   - set -eu（不开 pipefail，POSIX 不保证）
#   - 所有变量展开加双引号
#   - 依赖的命令：openssl / curl / date / grep / sed / tr / od / cut / head
#   - 网络/签名/落地/Docker 四段独立 step，每段幂等可重入
# =============================================================================

set -eu

# ---------- 常量 ----------
SERVER_URL="${SERVER_URL:-https://www.feiyijt.com}"
LICENSE_DIR="/etc/energybot"
LICENSE_FILE="${LICENSE_DIR}/license.conf"
LOG_FILE="/var/log/energybot-install.log"
PRECHECK_PATH="/api/v1/license/precheck"
# SHA-256("") —— 后端 license.public.controller.ts 以空字符串做 body hash。
EMPTY_BODY_SHA256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
SCRIPT_VERSION="1.0.0-a"

# ---------- 日志颜色 ----------
# NO_COLOR 环境变量（https://no-color.org/）+ 非 TTY 自动降级
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET='\033[0m'
  C_GREEN='\033[0;32m'
  C_YELLOW='\033[0;33m'
  C_RED='\033[0;31m'
  C_BLUE='\033[0;34m'
  C_BOLD='\033[1m'
else
  C_RESET=''
  C_GREEN=''
  C_YELLOW=''
  C_RED=''
  C_BLUE=''
  C_BOLD=''
fi

log()   { printf '%b[INFO]%b %s\n'  "$C_BLUE"   "$C_RESET" "$*"; }
warn()  { printf '%b[WARN]%b %s\n'  "$C_YELLOW" "$C_RESET" "$*"; }
ok()    { printf '%b[ OK ]%b %s\n'  "$C_GREEN"  "$C_RESET" "$*"; }
err()   { printf '%b[ERR ]%b %s\n'  "$C_RED"    "$C_RESET" "$*" >&2; }
title() { printf '\n%b==> %s%b\n'   "$C_BOLD"   "$*" "$C_RESET"; }

# ---------- 错误处理 ----------
# 注意：$LINENO 在 POSIX sh（dash）的 trap 上下文里不会展开，用固定占位符兜底避免
# `parameter not set` 噪声日志；真 bash 环境下仍会展开为真实行号。
on_error() {
  rc=$?
  line="${1:-?}"
  if [ "$LOG_FILE" = "/dev/null" ]; then
    err "脚本在第 $line 行以退出码 $rc 终止。"
  else
    err "脚本在第 $line 行以退出码 $rc 终止；完整日志见 $LOG_FILE"
  fi
  exit "$rc"
}
# ${LINENO:-?} 保证即使 LINENO 未定义也不会触发 `parameter not set`
trap 'on_error ${LINENO:-?}' EXIT INT TERM

success_exit() {
  trap - EXIT INT TERM
  exit 0
}

# ---------- 参数解析 ----------
ACTION="install"     # install / reinstall / uninstall
VERIFY_ONLY="${VERIFY_ONLY:-0}"

while [ $# -gt 0 ]; do
  case "$1" in
    --reinstall) ACTION="reinstall"; shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    --version) printf 'energybot-install %s\n' "$SCRIPT_VERSION"; success_exit ;;
    -h|--help)
      cat <<'HLP'
用法：
  curl -fsSL https://www.feiyijt.com/install.sh | LICENSE_KEY=... LICENSE_SECRET=... sh
  curl -fsSL https://www.feiyijt.com/install.sh | sh -s -- [--reinstall|--uninstall|--verify-only]

环境变量：
  LICENSE_KEY     License Key（ebt_ 前缀），缺省时进入交互读入
  LICENSE_SECRET  License Secret（base64url 32 字节），缺省时进入交互读入（静默输入）
  SERVER_URL      控制台地址，默认 https://www.feiyijt.com
  VERIFY_ONLY     设为 1 则只验签不装 Docker 不落盘
  NO_COLOR        禁用彩色输出
HLP
      success_exit
      ;;
    *)
      err "未知参数：$1"
      exit 2
      ;;
  esac
done

# ---------- 日志分流到文件 ----------
# 若 /var/log 不可写（开发机 / 非 root 先期自检），降级到 /dev/null；
# exec 重定向失败时 POSIX sh 会直接 abort，所以先用 touch 探测再决定目标。
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
if ! { : >>"$LOG_FILE"; } 2>/dev/null; then
  LOG_FILE=/dev/null
fi
exec 3>>"$LOG_FILE"
log_file() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&3 || true; }

# ---------- 依赖命令自检 ----------
require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "缺少依赖命令：$1。请先安装后再试。"
    exit 3
  fi
}
check_deps() {
  require_cmd curl
  require_cmd openssl
  require_cmd date
  require_cmd grep
  require_cmd sed
  require_cmd tr
  require_cmd od
  require_cmd head
  require_cmd cut
  require_cmd uname
}

# ---------- 系统自检 ----------
detect_os() {
  OS_ID="unknown"
  OS_VERSION="unknown"
  OS_PRETTY="unknown"
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_VERSION="${VERSION_ID:-unknown}"
    OS_PRETTY="${PRETTY_NAME:-$OS_ID $OS_VERSION}"
  fi
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) ARCH="x86_64" ;;
    aarch64|arm64) ARCH="aarch64" ;;
    *)
      warn "当前架构 $ARCH 未列入推荐列表（x86_64 / aarch64），继续但不保证兼容。"
      ;;
  esac
  log "系统：$OS_PRETTY ($ARCH)"
  log_file "os=$OS_ID version=$OS_VERSION arch=$ARCH"
}

check_root() {
  if [ "$(id -u)" -ne 0 ]; then
    err "必须以 root 运行（sudo -i 后再粘贴命令）。"
    exit 4
  fi
}

check_resources() {
  # 磁盘：/ 可用 ≥ 2GB
  if command -v df >/dev/null 2>&1; then
    # df -Pk 输出 KB；take $4（available）
    avail_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
    if [ -n "${avail_kb:-}" ] && [ "$avail_kb" -lt 2097152 ]; then
      warn "根分区可用空间不足 2GB（$((avail_kb / 1024)) MB）——后续拉 Docker 镜像可能失败。"
    fi
  fi
  # 内存：≥ 512 MB
  if [ -r /proc/meminfo ]; then
    total_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || printf 0)"
    if [ -n "${total_kb:-}" ] && [ "$total_kb" -lt 524288 ]; then
      warn "内存不足 512MB（${total_kb} KB）——agent 阶段可能 OOM。"
    fi
  fi
}

check_systemd() {
  # 当前阶段只提示；子系统 B 发布后由 agent 安装阶段再决定 systemd unit / docker 直管
  if [ ! -d /run/systemd/system ]; then
    warn "系统未使用 systemd；子系统 B 发布后将以 docker 直管而非 systemd unit 启停 agent。"
  fi
}

check_network() {
  # 只做连通性自检（不强求 /api/v1/health 存在，因为当前后端未实现该端点）
  if ! curl -fsS --max-time 10 -o /dev/null "$SERVER_URL" 2>/dev/null; then
    # 尝试 HEAD 一下，CF 对 HEAD 的支持较稳
    if ! curl -fsS --max-time 10 -I -o /dev/null "$SERVER_URL" 2>/dev/null; then
      err "无法访问 $SERVER_URL——请检查本机出网（需放通 TCP 443）。"
      exit 5
    fi
  fi
  ok "网络可达 $SERVER_URL"
}

# ---------- License 参数读入 ----------
prompt_license() {
  if [ -z "${LICENSE_KEY:-}" ]; then
    printf 'License Key: '
    # 交互式读入需要 stdin 是 TTY；curl | sh 场景下 stdin 是管道
    if [ ! -t 0 ]; then
      err "未通过环境变量传入 LICENSE_KEY，且 stdin 非 TTY 无法交互读入。"
      err "请改用 'LICENSE_KEY=... LICENSE_SECRET=... sh install.sh' 形式。"
      exit 6
    fi
    read -r LICENSE_KEY
  fi
  if [ -z "${LICENSE_SECRET:-}" ]; then
    printf 'License Secret（输入不回显）: '
    if [ ! -t 0 ]; then
      err "未通过环境变量传入 LICENSE_SECRET。"
      exit 6
    fi
    # POSIX stty -echo 支持度高
    stty -echo 2>/dev/null || true
    read -r LICENSE_SECRET
    stty echo 2>/dev/null || true
    printf '\n'
  fi
  # 基本格式校验（后端也会校验，客户端先拦一道给出清晰提示）
  case "$LICENSE_KEY" in
    ebt_*) ;;
    *)
      err "LICENSE_KEY 必须以 ebt_ 开头。"
      exit 7
      ;;
  esac
  if [ "${#LICENSE_KEY}" -lt 20 ] || [ "${#LICENSE_KEY}" -gt 40 ]; then
    err "LICENSE_KEY 长度不合法（期望 20-40 字符，实际 ${#LICENSE_KEY}）。"
    exit 7
  fi
  if [ -z "$LICENSE_SECRET" ]; then
    err "LICENSE_SECRET 为空。"
    exit 7
  fi
}

# ---------- HMAC 签名 ----------
#
# 规范串：METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256_HEX(BODY)
# 与后端 common/crypto/hmac.util.ts 保持字节级一致。
#
# Timestamp 毫秒策略：POSIX date 只给秒；用 $(date +%s) * 1000 生成 13 位数字。
# 后端 license.service.ts CLOCK_SKEW_MS = 300_000，秒精度完全足够。
compute_signature() {
  method="$1"
  path="$2"
  ts="$3"
  nonce="$4"
  body_sha="$5"
  secret="$6"

  # 规范串用真实换行字符（后端 hmac.util.ts 拼 \n 亦为 LF）
  canonical="$(printf '%s\n%s\n%s\n%s\n%s' "$method" "$path" "$ts" "$nonce" "$body_sha")"
  # openssl dgst -hex：旧版输出 "(stdin)= <hex>"；新版裸 hex。用 awk 兼容。
  printf '%s' "$canonical" | openssl dgst -sha256 -hmac "$secret" -hex 2>/dev/null \
    | awk '{print $NF}'
}

gen_nonce() {
  # 16 字节 → 32 位 hex，与后端 /^[0-9a-f]{32}$/i 正则一致
  head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

gen_timestamp_ms() {
  s="$(date +%s)"
  printf '%s000' "$s"
}

# ---------- Precheck 调用 ----------
#
# 结果：成功则 stdout 输出 customerName（单行）；失败则 err + exit 非 0。
# 所有中间变量都 local 化（POSIX 没 local，用函数 subshell 实现）。
call_precheck() (
  method="POST"
  path="$PRECHECK_PATH"
  ts="$(gen_timestamp_ms)"
  nonce="$(gen_nonce)"
  sig="$(compute_signature "$method" "$path" "$ts" "$nonce" "$EMPTY_BODY_SHA256" "$LICENSE_SECRET")"

  if [ -z "$sig" ] || [ "${#sig}" -ne 64 ]; then
    err "HMAC 签名生成失败（openssl 输出异常）。"
    return 8
  fi

  url="${SERVER_URL}${PRECHECK_PATH}"
  tmp="$(mktemp 2>/dev/null || printf '/tmp/ebt-precheck-%s' "$$")"
  # shellcheck disable=SC2064  # 有意使用立即展开
  trap "rm -f '$tmp'" EXIT

  http_code="$(
    curl -sS -o "$tmp" -w '%{http_code}' \
      --max-time 15 \
      -X POST \
      -H "X-License-Key: $LICENSE_KEY" \
      -H "X-Timestamp: $ts" \
      -H "X-Nonce: $nonce" \
      -H "X-Signature: $sig" \
      -H "Content-Type: application/json" \
      -d '' \
      "$url" 2>>"$LOG_FILE" || printf '000'
  )"

  body="$(cat "$tmp" 2>/dev/null || printf '')"
  log_file "precheck http_code=$http_code body=$body"

  case "$http_code" in
    200)
      # 最简 JSON 提取：{"code":200,"msg":"SUCCESS","data":{"customerName":"xxx","serverTime":N}}
      # POSIX sed 不支持 \K；用 grep -o + sed 组合。
      name="$(printf '%s' "$body" \
        | grep -o '"customerName"[[:space:]]*:[[:space:]]*"[^"]*"' \
        | head -n 1 \
        | sed 's/.*"customerName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
      if [ -z "$name" ]; then
        name="(未返回客户名)"
      fi
      printf '%s' "$name"
      return 0
      ;;
    401)
      case "$body" in
        *clock_skew*) err "时钟偏移超限：本机时间与服务端相差 > 5 分钟。请同步时间（ntpdate / chronyd）后重试。" ;;
        *nonce_replayed*) err "Nonce 重放（5 分钟内重复请求）。稍等片刻后重试。" ;;
        *signature_invalid*) err "签名校验失败：LICENSE_SECRET 错误或已轮换。" ;;
        *key_not_found*) err "License Key 不存在。请确认命令完整复制。" ;;
        *) err "认证失败（401）：$body" ;;
      esac
      return 9
      ;;
    403)
      case "$body" in
        *license_revoked*) err "License 已被吊销。请联系管理员。" ;;
        *customer_suspended*) err "客户账号已停用。请联系管理员。" ;;
        *) err "访问被拒（403）：$body" ;;
      esac
      return 9
      ;;
    400) err "请求格式错误（400）：$body"; return 9 ;;
    000) err "网络错误：无法连接 $url。"; return 5 ;;
    *)  err "意外响应码 $http_code：$body"; return 9 ;;
  esac
)

# ---------- Docker 安装 ----------
install_docker() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ok "Docker 已就绪"
    return 0
  fi
  if [ "$VERIFY_ONLY" = "1" ]; then
    log "VERIFY_ONLY=1：跳过 Docker 安装。"
    return 0
  fi
  title "安装 Docker（get.docker.com 官方脚本）"
  if ! curl -fsSL https://get.docker.com -o /tmp/get-docker.sh; then
    err "下载 Docker 安装脚本失败。"
    exit 10
  fi
  if ! sh /tmp/get-docker.sh >>"$LOG_FILE" 2>&1; then
    err "Docker 安装失败，详见 $LOG_FILE"
    exit 10
  fi
  rm -f /tmp/get-docker.sh
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker >>"$LOG_FILE" 2>&1 || true
  fi
  ok "Docker 安装完成"
}

# ---------- License 文件落地 ----------
write_license_file() {
  customer_name="$1"
  if [ "$VERIFY_ONLY" = "1" ]; then
    log "VERIFY_ONLY=1：跳过 license 文件落地。"
    return 0
  fi

  # 幂等：若已存在 license.conf 且 key 一致，直接视为成功（仅更新时间戳）
  if [ -f "$LICENSE_FILE" ] && [ "$ACTION" = "install" ]; then
    existing_key="$(grep -E '^LICENSE_KEY=' "$LICENSE_FILE" | sed 's/^LICENSE_KEY=//')"
    if [ "$existing_key" = "$LICENSE_KEY" ]; then
      log "License 文件已存在且 key 一致——视为幂等成功。"
      return 0
    fi
    err "License 文件已存在但 key 不一致（现有：${existing_key%"${existing_key#ebt_????????}"}…）。"
    err "如需换绑，请使用 --reinstall 覆盖；或先 --uninstall 再重装。"
    exit 11
  fi

  mkdir -p "$LICENSE_DIR"
  chmod 700 "$LICENSE_DIR"
  # 写入临时文件再原子 mv，避免写一半断电
  tmp="${LICENSE_FILE}.tmp.$$"
  {
    printf '# EnergyBot 自托管 agent license 凭据\n'
    printf '# 生成时间：%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '# 该文件权限为 600，请勿泄露。\n'
    printf 'LICENSE_KEY=%s\n' "$LICENSE_KEY"
    printf 'LICENSE_SECRET=%s\n' "$LICENSE_SECRET"
    printf 'SERVER_URL=%s\n' "$SERVER_URL"
    printf 'CUSTOMER_NAME=%s\n' "$customer_name"
    printf 'INSTALLED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$LICENSE_FILE"
  ok "License 已写入 $LICENSE_FILE（权限 600）"
}

# ---------- 卸载 ----------
do_uninstall() {
  title "卸载 EnergyBot agent 配置（当前阶段仅清 license 文件）"
  if [ -f "$LICENSE_FILE" ]; then
    rm -f "$LICENSE_FILE"
    ok "已删除 $LICENSE_FILE"
  else
    log "$LICENSE_FILE 不存在，跳过。"
  fi
  if [ -d "$LICENSE_DIR" ]; then
    # 只清 energybot 目录下的文件，不动其他；目录本身若空也删
    rmdir "$LICENSE_DIR" 2>/dev/null || true
  fi
  ok "卸载完成。Docker 与日志文件未动；如需彻底清理请手动处理。"
  success_exit
}

# ---------- 成功总结 ----------
print_banner() {
  customer_name="$1"
  printf '\n'
  printf '%b╔══════════════════════════════════════════════════════════════╗%b\n' "$C_GREEN" "$C_RESET"
  printf '%b║  EnergyBot 自托管 agent 基础配置完成                          ║%b\n' "$C_GREEN" "$C_RESET"
  printf '%b╚══════════════════════════════════════════════════════════════╝%b\n' "$C_GREEN" "$C_RESET"
  printf '  客户      ：%s\n' "$customer_name"
  if [ "$VERIFY_ONLY" = "1" ]; then
    printf '  模式      ：%bVERIFY_ONLY（未落盘、未装 Docker）%b\n' "$C_YELLOW" "$C_RESET"
  else
    printf '  License   ：%s\n' "$LICENSE_FILE"
    printf '  Docker    ：%s\n' "$(command -v docker >/dev/null 2>&1 && docker --version || printf '未安装')"
  fi
  printf '\n'
  printf '  %b下一步%b：在控制台 %s 配置机器人 Token\n' "$C_BOLD" "$C_RESET" "$SERVER_URL"
  printf '\n'
  printf '  %bAgent 远程控制功能开发中（子系统 B，预计 2 周上线）%b\n' "$C_YELLOW" "$C_RESET"
  printf '  %b届时本服务器将自动接入控制台，无需重装。%b\n' "$C_YELLOW" "$C_RESET"
  printf '\n'
}

# ---------- 主流程 ----------
main() {
  title "EnergyBot 一键部署脚本 v${SCRIPT_VERSION}"
  log_file "=== install.sh v${SCRIPT_VERSION} action=$ACTION verify_only=$VERIFY_ONLY ==="

  check_deps
  detect_os
  check_root

  if [ "$ACTION" = "uninstall" ]; then
    do_uninstall
  fi

  check_resources
  check_systemd
  check_network

  prompt_license

  title "向控制台验证 license"
  name="$(call_precheck)"
  ok "License 有效 — 客户：$name"

  if [ "$VERIFY_ONLY" = "1" ]; then
    print_banner "$name"
    success_exit
  fi

  install_docker
  write_license_file "$name"

  print_banner "$name"
  success_exit
}

main "$@"
