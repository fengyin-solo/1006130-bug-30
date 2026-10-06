# 端口、环境标识、Node 版本统一从根 .env 取，本文件不重复定义。
ifneq (,$(wildcard .env))
include .env
export
endif

.PHONY: install frontend build preview

install:
	cd frontend && npm ci

frontend:
	cd frontend && npm run dev -- --host $(WEB_HOST) --port $(WEB_PORT)

build:
	cd frontend && npm run build

preview:
	cd frontend && npm run preview -- --host $(WEB_HOST) --port $(WEB_PORT)
