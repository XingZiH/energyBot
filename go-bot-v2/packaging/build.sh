#!/usr/bin/env bash
# energybot-bot 跨平台构建脚本（通过 Docker 交叉编译，需 cgo）。
#
# 产物：dist/energybot-bot-linux-{amd64,arm64}
#
# 使用：
#   ./packaging/build.sh
#   VERSION=1.2.3 ./packaging/build.sh
#
# VERSION 缺省时尝试 git describe，再退回 "dev"。
#
# 为什么要 docker：
#   mattn/go-sqlite3 要求 cgo，Mac 本地交叉到 linux/arm64 需要 musl-gcc 或
#   zig 工具链。借 docker 的 golang:1.26 官方镜像 + buildx，两个架构一把产。
#
# 体积预期 10-14MB（比 agent 大，因为内嵌 SQLite C 源）。
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${VERSION:-$(git describe --tags --always 2>/dev/null || echo dev)}"
mkdir -p dist

# Dockerfile 内联：用 apt 装交叉 gcc，然后为每个 arch 调用 go build。
# 用 multi-stage 保持宿主 dist/ 干净。
cat > /tmp/energybot-bot-build.Dockerfile <<'EOF'
FROM --platform=linux/amd64 golang:1.26-bookworm AS builder
# 装交叉编译 arm64 需要的工具链
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc-aarch64-linux-gnu libc6-dev-arm64-cross \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .

ARG VERSION=dev
RUN set -eux; \
    mkdir -p /out; \
    GOOS=linux GOARCH=amd64 CGO_ENABLED=1 \
      go build -trimpath \
      -ldflags="-s -w -X 'main.Version=${VERSION}'" \
      -o /out/energybot-bot-linux-amd64 ./cmd/bot; \
    GOOS=linux GOARCH=arm64 CGO_ENABLED=1 CC=aarch64-linux-gnu-gcc \
      go build -trimpath \
      -ldflags="-s -w -X 'main.Version=${VERSION}'" \
      -o /out/energybot-bot-linux-arm64 ./cmd/bot

FROM scratch AS export
COPY --from=builder /out/ /
EOF

echo "building via docker buildx (version=${VERSION})..."
docker buildx build \
  --platform linux/amd64 \
  --file /tmp/energybot-bot-build.Dockerfile \
  --build-arg "VERSION=${VERSION}" \
  --target export \
  --output "type=local,dest=./dist" \
  .

rm -f /tmp/energybot-bot-build.Dockerfile
ls -lh dist/energybot-bot-linux-*

# 生成 sha256（格式对齐 agent 产物：路径 + 空格 + 64 位 hex）
shasum -a 256 \
  dist/energybot-bot-linux-amd64 \
  dist/energybot-bot-linux-arm64 \
  > dist/energybot-bot-sha256.txt
echo "sha256:"
cat dist/energybot-bot-sha256.txt
