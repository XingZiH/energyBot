# syntax=docker/dockerfile:1.7
# energybot nest-api - NestJS 11
# 多阶段构建：node:24-alpine 构建 → node:24-alpine 精简运行时
#
# 实际入口：dist/src/main.js（因 tsconfig 未显式设置 rootDir，
# TypeScript 把源根推断为 ./src，产物落在 dist/src/）

# ========== Stage 1: builder ==========
FROM node:24-alpine AS builder

WORKDIR /app

# 先装依赖（含 devDep，nest build 需要 @nestjs/cli / typescript）
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 复制源码并构建
COPY . .
RUN npm run build

# ========== Stage 2: production deps ==========
# 单独一层只装运行时依赖，避免把 devDep 带进 runtime
FROM node:24-alpine AS prod-deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# ========== Stage 3: runtime ==========
FROM node:24-alpine AS runtime

# 时区数据 + dumb-init 提供合理的 PID 1 行为（转发信号、收割僵尸进程）
RUN apk add --no-cache tzdata dumb-init \
    && rm -rf /var/cache/apk/*

# 创建非 root 用户
RUN addgroup -S appuser -g 1001 \
    && adduser -S appuser -u 1001 -G appuser

WORKDIR /app

# 仅从 prod-deps 复制运行时依赖
COPY --from=prod-deps --chown=appuser:appuser /app/node_modules ./node_modules
# package.json 带进来（给 node 模块解析 + 版本信息）
COPY --chown=appuser:appuser package.json package-lock.json ./
# 构建产物
COPY --from=builder --chown=appuser:appuser /app/dist ./dist
# main.ts 里 useStaticAssets('public')，保证目录存在避免启动报错
RUN mkdir -p /app/public && chown -R appuser:appuser /app/public

ENV NODE_ENV=production \
    PORT=3001 \
    TZ=Asia/Shanghai

USER appuser

EXPOSE 3001

# 没有专门的 /health endpoint；用 TCP 连通性代替
# （wget --spider 请求根路径，NestJS 默认会返回 404 但 HTTP 连通）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:3001/ || exit 1

# dumb-init 做 PID 1，转发 SIGTERM 给 node 实现优雅退出
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/main.js"]
