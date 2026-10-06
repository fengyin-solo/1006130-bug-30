# 构建上下文必须是仓库根（docker compose 已这样配置），才能拿到根 .env 与 frontend/ 目录。
# 基础镜像版本来自根 .env 的 NODE_VERSION，本地与容器用同一主版本的 Node。
ARG NODE_VERSION=20.20.2-alpine
FROM node:${NODE_VERSION}
WORKDIR /srv/web

# 先装依赖：有 package-lock.json，npm ci 按锁文件装，版本不漂移。
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

# 业务代码与唯一口径的 .env（vite envDir 指向仓库根，构建时从这里取 VITE_*）
COPY frontend ./frontend
COPY .env ./.env

ENV APP_ENV=container
WORKDIR /srv/web/frontend

ARG WEB_PORT=5173
EXPOSE ${WEB_PORT}
CMD ["npm", "run", "dev"]
