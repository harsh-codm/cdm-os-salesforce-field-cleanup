.PHONY: help lint test e2e migrate up down logs

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

lint:  ## Run ruff linter and formatter check
	ruff check services/ scripts/
	ruff format --check services/ scripts/

test:  ## Run all unit tests (each service separately: both have a `tests` package)
	pytest --import-mode=importlib services/control_plane/tests/ -v --tb=short
	pytest --import-mode=importlib services/tool_gateway/tests/ -v --tb=short

e2e:  ## End-to-end field deletion test against the running stack (mock org unless --allow-real)
	python scripts/e2e_field_deletion.py

migrate:  ## Apply DB migrations to an existing database (idempotent)
	for f in services/control_plane/database/migrations/*.sql; do 		docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"' < $$f || exit 1; 	done

up:  ## Start the full stack via Docker Compose
	docker compose up -d --build

down:  ## Stop the stack
	docker compose down

logs:  ## Tail logs from all services
	docker compose logs -f --tail=50
