.PHONY: help lint test up down logs

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

lint:  ## Run ruff linter and formatter check
	ruff check services/ scripts/
	ruff format --check services/ scripts/

test:  ## Run all unit tests
	pytest services/control_plane/tests/ services/tool_gateway/tests/ -v --tb=short

up:  ## Start the full stack via Docker Compose
	docker compose up -d --build

down:  ## Stop the stack
	docker compose down

logs:  ## Tail logs from all services
	docker compose logs -f --tail=50
