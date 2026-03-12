COMPOSE_FILE=infra/docker/compose.yml

up:
	docker compose -f $(COMPOSE_FILE) up -d --build

db-up:
	docker compose -f $(COMPOSE_FILE) up -d postgres migrate

down:
	docker compose -f $(COMPOSE_FILE) down

db-down:
	docker compose -f $(COMPOSE_FILE) down

dev:
	docker compose -f $(COMPOSE_FILE) up --build

build:
	npm ci --prefix api
	npm run lint --prefix api
	npm ci --prefix apps/auth
	npm run build --prefix apps/auth
	npm ci --prefix apps/backend
	npm run build --prefix apps/backend
	npm ci --prefix apps/web
	npm run build --prefix apps/web
	npm ci --prefix infra/aws
	npm run build --prefix infra/aws

lint:
	npm ci --prefix api
	npm run lint --prefix api
	npm run build --prefix apps/auth
	npm run lint --prefix apps/backend
	npm run build --prefix apps/web
	npm run build --prefix infra/aws

migrate:
	bash scripts/migrate.sh

migrate-aws:
	bash scripts/migrate-aws.sh

check-api-health:
	bash scripts/check-api-health.sh

check-public-endpoints:
	bash scripts/check-public-endpoints.sh

auth-dev:
	cd apps/auth && node --env-file=../../.env ./node_modules/tsx/dist/cli.mjs watch src/index.ts

backend-dev:
	npm run dev --prefix apps/backend

web-dev:
	cd apps/web && node --env-file=../../.env ./node_modules/vite/bin/vite.js
