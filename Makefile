# Recut local development commands. Run `make help` for the public interface.

.DEFAULT_GOAL := help
.PHONY: help dev service-dev service-test service-vet web-install web-dev web-build check

GOCACHE ?= $(CURDIR)/.cache/go-build

help: ## Show available development commands.
	@awk 'BEGIN { FS = ":.*##"; printf "\nRecut development commands:\n" } /^[a-zA-Z0-9_-]+:.*##/ { printf "  %-16s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

dev: ## Start the local service and web workspace together.
	@set -e; \
	GOCACHE=$(GOCACHE) go -C service run . & service_pid=$$!; \
	( cd web && npm run dev ) & web_pid=$$!; \
	trap 'kill $$service_pid $$web_pid 2>/dev/null || true' EXIT INT TERM; \
	wait $$service_pid $$web_pid

service-dev: ## Start only the loopback Go service on port 17373.
	GOCACHE=$(GOCACHE) go -C service run .

service-test: ## Run the service test suite.
	GOCACHE=$(GOCACHE) go -C service test .

service-vet: ## Run Go static analysis for the local service.
	GOCACHE=$(GOCACHE) go -C service vet .

web-install: ## Install locked web workspace dependencies.
	cd web && npm ci

web-dev: ## Start only the Next.js workspace on port 3000.
	cd web && npm run dev

web-build: ## Build and type-check the Next.js workspace.
	cd web && npm run build

check: service-test service-vet web-build ## Run all service and web verification.
