#!/usr/bin/env bash
# energybot-agent 跨平台构建脚本。
#
# 产物：dist/energybot-agent-linux-{amd64,arm64}
#
# 使用：
#   ./packaging/build.sh
#   VERSION=1.2.3 ./packaging/build.sh
#
# VERSION 缺省时尝试 git describe，再退回 "dev"。
# 编译参数：
#   -trimpath               去除构建机绝对路径，产物可复现
#   -ldflags "-s -w"        去符号表，减小体积（预期 3-5MB）
#   -ldflags "-X main.Version=..."  注入版本号到 main.Version
#   CGO_ENABLED=0           静态链接，不依赖 glibc 版本
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${VERSION:-$(git describe --tags --always 2>/dev/null || echo dev)}"
mkdir -p dist

for arch in amd64 arm64; do
  echo "building linux/${arch} (version=${VERSION})..."
  GOOS=linux GOARCH="$arch" CGO_ENABLED=0 \
    go build -trimpath \
    -ldflags="-s -w -X 'main.Version=${VERSION}'" \
    -o "dist/energybot-agent-linux-${arch}" \
    ./cmd/agent
done

ls -lh dist/
