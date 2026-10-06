# 回退默认值仅在脱离 compose 单独 docker build 时生效；
# 正式构建的版本号由根目录 .env 通过 build args 注入，以那份为准。
ARG NODE_VERSION=20-alpine
FROM node:${NODE_VERSION}
WORKDIR /srv/web
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
# 容器内监听 0.0.0.0，端口取根目录 .env 钉死的 FRONTEND_PORT
ARG FRONTEND_PORT=5173
ENV FRONTEND_PORT=${FRONTEND_PORT}
EXPOSE ${FRONTEND_PORT}
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
