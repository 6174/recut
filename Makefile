# Recut local development commands. Run `make help` for the public interface.

.DEFAULT_GOAL := help
.PHONY: help dev service-dev stop-stale-service stop-stale-web service-test service-vet web-install web-dev web-build check

GOCACHE ?= $(CURDIR)/.cache/go-build

help: ## Show available development commands.
	@awk 'BEGIN { FS = ":.*##"; printf "\nRecut development commands:\n" } /^[a-zA-Z0-9_-]+:.*##/ { printf "  %-16s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

dev: stop-stale-service stop-stale-web ## Start the local service and web workspace together.
	@set -e; \
	GOCACHE=$(GOCACHE) go -C service run . & service_pid=$$!; \
	( cd web && npm run dev ) & web_pid=$$!; \
	trap 'kill $$service_pid $$web_pid 2>/dev/null || true' EXIT INT TERM; \
	wait $$service_pid $$web_pid

stop-stale-service: ## Stop the stale Recut daemon on port 17373, never another application.
	@port_pid="$$(lsof -tiTCP:17373 -sTCP:LISTEN 2>/dev/null || true)"; \
	if [ -z "$$port_pid" ]; then exit 0; fi; \
	recut_pid="$$(lsof -a -tiTCP:17373 -sTCP:LISTEN -c recut-service 2>/dev/null || true)"; \
	if [ "$$port_pid" != "$$recut_pid" ]; then echo "Port 17373 is occupied by a non-Recut process (PID $$port_pid); refusing to stop it."; exit 1; fi; \
	echo "Stopping stale Recut daemon (PID $$port_pid)."; kill "$$port_pid"

stop-stale-web: ## Stop the stale local Next.js workspace on port 3000, never another application.
	@port_pids="$$(lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null || true)"; \
	if [ -z "$$port_pids" ]; then exit 0; fi; \
	for pid in $$port_pids; do \
		cwd="$$(lsof -a -p "$$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"; \
		if [ "$$cwd" != "$(CURDIR)/web" ]; then echo "Port 3000 is occupied by a process outside this Recut web workspace (PID $$pid); refusing to stop it."; exit 1; fi; \
	done; \
	echo "Stopping stale Recut web workspace (PID(s) $$port_pids)."; kill $$port_pids; \
	for pid in $$port_pids; do \
		attempt=0; \
		while kill -0 "$$pid" 2>/dev/null && [ "$$attempt" -lt 20 ]; do sleep 0.1; attempt=$$((attempt + 1)); done; \
		if kill -0 "$$pid" 2>/dev/null; then echo "Force-stopping stale Recut web workspace (PID $$pid)."; kill -9 "$$pid"; fi; \
	done

service-dev: stop-stale-service ## Start only the loopback Go service on port 17373.
	GOCACHE=$(GOCACHE) go -C service run .

service-test: ## Run the service test suite.
	GOCACHE=$(GOCACHE) go -C service test .

service-vet: ## Run Go static analysis for the local service.
	GOCACHE=$(GOCACHE) go -C service vet .

web-install: ## Install locked web workspace dependencies.
	cd web && npm ci

web-dev: stop-stale-web ## Start only the Next.js workspace on port 3000.
	cd web && npm run dev

web-build: ## Build and type-check the Next.js workspace.
	cd web && npm run build

check: service-test service-vet web-build ## Run all service and web verification.
