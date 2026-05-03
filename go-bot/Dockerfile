# syntax=docker/dockerfile:1.7
# energybot go-bot - Telegram Bot / 任务执行器
# 多阶段构建：golang:1.26-alpine 静态编译 → alpine:3 运行时
#
# 入口：cmd/bot/main.go
# 依赖：pgx/v5（纯 Go）+ gotron-sdk（纯 Go）→ 可 CGO_ENABLED=0 完全静态

# ========== Stage 1: builder ==========
FROM golang:1.26-alpine AS builder

# git 用于拉取私有/间接依赖（如果需要），ca-certificates 用于 go mod download 走 HTTPS
RUN apk add --no-cache git ca-certificates

WORKDIR /src

# 先只复制 go.mod/go.sum 下载依赖，最大化缓存复用
COPY go.mod go.sum ./
RUN go mod download

# 复制其余源码
COPY . .

# 静态编译：
#   CGO_ENABLED=0 → 生成纯静态二进制，runtime 不需要 libc
#   -ldflags="-s -w" → 去除调试符号和 DWARF，减小体积
#   -trimpath → 去除本地绝对路径，可重现构建
ENV CGO_ENABLED=0 \
    GOOS=linux \
    GOARCH=amd64
RUN go build -trimpath -ldflags="-s -w" -o /out/energy-bot ./cmd/bot

# ========== Stage 2: runtime ==========
FROM alpine:3

# ca-certificates：HTTPS 访问 Telegram / TRON 节点
# tzdata：config 可能用到本地时区；日志时间戳
RUN apk add --no-cache ca-certificates tzdata \
    && rm -rf /var/cache/apk/* \
    && addgroup -S appuser -g 1001 \
    && adduser -S appuser -u 1001 -G appuser

WORKDIR /app

COPY --from=builder --chown=appuser:appuser /out/energy-bot /app/energy-bot

ENV TZ=Asia/Shanghai

USER appuser

# go-bot 不监听 HTTP 端口（纯轮询 + Telegram long polling），不暴露端口、不加 HEALTHCHECK
# 如果后续加了 /metrics 或 /healthz，可在此补充 HEALTHCHECK

ENTRYPOINT ["/app/energy-bot"]
