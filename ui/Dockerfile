# syntax=docker/dockerfile:1.7
# energybot UI - Angular 21 SPA
# 多阶段构建：node:24-alpine 构建 → nginx:1-alpine 提供静态资源

# ========== Stage 1: builder ==========
FROM node:24-alpine AS builder

WORKDIR /app

# 先复制依赖清单，利用层缓存
COPY package.json package-lock.json ./

# 用 npm ci 严格按 lock 装依赖
RUN npm ci --no-audit --no-fund

# 复制源码
COPY . .

# 构建生产包。
# 注意：package.json 的 build 脚本带 --base-href=/ng-antd-admin/（给 GitHub Pages 用）
# 生产部署根路径需要覆盖为 /，用 npx ng 直接调用，绕过 npm script。
# outputPath 在 angular.json 是 { base: "dist", browser: "" }，所以产物在 dist/ 根下。
RUN npx ng build --configuration=production --base-href=/ \
    && rm -rf node_modules

# ========== Stage 2: runtime ==========
FROM nginx:1-alpine AS runtime

# tzdata 让容器日志时区正确（可选，几十 KB）
RUN apk add --no-cache tzdata \
    && rm -rf /var/cache/apk/*

# 自定义 nginx 配置（片段，挂到 conf.d/default.conf 被主 nginx.conf 的 include 拉入）
# nginx:1-alpine 默认 /etc/nginx/nginx.conf 已含 events {} + http {} 包裹，
# 在 http {} 末尾 include /etc/nginx/conf.d/*.conf，因此 ui/nginx.conf 只需 server {} 块。
# 直接覆盖到 conf.d/default.conf 会替换掉镜像默认那份 server，避免端口冲突。
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 复制 Angular 构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 以非 root 运行：nginx alpine 镜像已内置 nginx 用户（uid 101）
# 调整目录权限让 nginx 用户可读写
# 之前 ui/nginx.conf 整体覆盖 /etc/nginx/nginx.conf 绕过了 /var/cache/nginx 的使用，
# 现在改为 conf.d/ 片段后主配置里的 client_body_temp_path 等被激活，需要 chown
RUN chown -R nginx:nginx /usr/share/nginx/html \
    && chmod -R g+r /usr/share/nginx/html \
    && chown -R nginx:nginx /var/cache/nginx \
    && mkdir -p /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp \
    && chown -R nginx:nginx /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp \
    && touch /tmp/nginx.pid \
    && chown nginx:nginx /tmp/nginx.pid \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
