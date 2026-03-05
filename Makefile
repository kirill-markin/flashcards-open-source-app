COMPOSE_FILE=infra/docker/compose.yml

up:
	docker compose -f $(COMPOSE_FILE) up -d --build

down:
	docker compose -f $(COMPOSE_FILE) down

dev:
	docker compose -f $(COMPOSE_FILE) up --build

build:
	npm ci --prefix apps/auth
	npm run build --prefix apps/auth
	npm ci --prefix apps/backend
	npm run build --prefix apps/backend
	npm ci --prefix infra/aws
	npm run build --prefix infra/aws

lint:
	npm run build --prefix apps/auth
	npm run lint --prefix apps/backend
	npm run build --prefix infra/aws

migrate:
	bash scripts/migrate.sh
