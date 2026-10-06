# 全部版本号、端口、环境变量以根目录 .env 为唯一口径，Makefile 只读不写。
ENV_FILE := .env
-include $(ENV_FILE)
export

FRONTEND_DIR := frontend
# 容器内监听地址要覆盖成 0.0.0.0（本地开发仍走 .env 里的 127.0.0.1）
DOCKER_HOST := $(or $(CONTAINER_HOST),0.0.0.0)

.PHONY: install lock frontend build image up

install:
	cd $(FRONTEND_DIR) && npm install

# 生成钉死版本的 lockfile：容器构建优先 npm ci
lock:
	cd $(FRONTEND_DIR) && npm install --package-lock-only

frontend:
	cd $(FRONTEND_DIR) && npm run dev

build:
	cd $(FRONTEND_DIR) && npm run build

image:
	docker build \
		--build-arg NODE_VERSION=$(NODE_VERSION) \
		--build-arg FRONTEND_PORT=$(FRONTEND_PORT) \
		-f frontend/Dockerfile -t shield-tunnel-frontend .

up:
	docker compose up --build
