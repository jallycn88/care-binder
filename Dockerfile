# 多阶段构建：飞牛 NAS 原生 arm64（RK3566），成品仅运行时依赖
FROM node:22-alpine AS builder

WORKDIR /build

# 安装前端依赖并构建静态资源
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# 安装后端依赖（仅生产依赖）
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 运行时镜像
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=31688 \
    DATA_DIR=/app/data

WORKDIR /app

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/frontend/dist ./frontend/dist
COPY server/ ./server/

RUN mkdir -p /app/data && addgroup -g 1000 -S app && adduser -u 1000 -S app -G app && chown -R app:app /app

USER app
EXPOSE 31688

CMD ["node", "server/index.js"]
