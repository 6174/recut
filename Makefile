# Recut local development commands. Run `make help` for the public interface.

.DEFAULT_GOAL := help
.PHONY: help dev deploy service-dev service-build service-release service-install service-status stop-stale-service stop-stale-web service-test service-vet web-install web-dev web-build web-build-cloudflare web-deploy app-link check

GOCACHE ?= $(CURDIR)/.cache/go-build
RECUT_HOME ?= $(HOME)/.recut
APP ?=
RECUT_VERSION ?= 0.1.0
WEB_SERVICE_VERSION ?= $(RECUT_VERSION)
SERVICE_BUILD ?= $(CURDIR)/build/recut-service
RELEASE_STAGE ?= $(CURDIR)/build/releases
RELEASE_PUBLIC ?= $(CURDIR)/web/public/releases/latest
SERVICE_RELEASE_TARGETS := darwin-arm64 darwin-amd64

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
	GOCACHE=$(GOCACHE) go -C service run -ldflags "-X main.serviceVersion=$(RECUT_VERSION)" .

service-build: ## Build a versioned production Recut service binary.
	@mkdir -p "$(dir $(SERVICE_BUILD))"
	GOCACHE=$(GOCACHE) go -C service build -trimpath -ldflags "-s -w -X main.serviceVersion=$(RECUT_VERSION)" -o "$(SERVICE_BUILD)" .

service-release: ## Build compressed macOS service packages for the Cloudflare static installer.
	@set -e; \
	mkdir -p "$(RELEASE_STAGE)" "$(RELEASE_PUBLIC)"; \
	manifest="$(RELEASE_PUBLIC)/manifest.json"; \
	printf '{"version":"%s","packages":{' "$(RECUT_VERSION)" > "$$manifest"; \
	first=1; \
	for target in $(SERVICE_RELEASE_TARGETS); do \
		os="$${target%-*}"; arch="$${target#*-}"; binary="recut-service-$$os-$$arch"; \
		echo "Building $$binary"; \
		GOCACHE=$(GOCACHE) GOOS="$$os" GOARCH="$$arch" go -C service build -trimpath -ldflags "-s -w -X main.serviceVersion=$(RECUT_VERSION)" -o "$(RELEASE_STAGE)/$$binary" .; \
		archive="$$binary.tar.gz"; tar -C "$(RELEASE_STAGE)" -czf "$(RELEASE_PUBLIC)/$$archive" "$$binary"; \
		checksum="$$(shasum -a 256 "$(RELEASE_PUBLIC)/$$archive" | awk '{print $$1}')"; \
		if [ "$$first" = 0 ]; then printf ',' >> "$$manifest"; fi; first=0; \
		printf '"%s":{"archive":"%s","sha256":"%s"}' "$$os-$$arch" "$$archive" "$$checksum" >> "$$manifest"; \
	done; \
	printf '}}\n' >> "$$manifest"

service-install: service-build ## Install and start the current-user production service (launchd/systemd).
	@chmod +x scripts/install-service.sh
	@RECUT_HOME="$(RECUT_HOME)" scripts/install-service.sh "$(SERVICE_BUILD)"

service-status: ## Show the current-user production service status.
	@if [ "$$(uname -s)" = "Darwin" ]; then launchctl print "gui/$$(id -u)/video.recut.service"; \
	elif command -v systemctl >/dev/null 2>&1; then systemctl --user status recut.service --no-pager; \
	else echo "No supported user service manager found. Check $(RECUT_HOME)/logs."; fi

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

web-build-cloudflare: ## Export the static web workspace for the Cloudflare Worker.
	@rm -rf "$(CURDIR)/web/out"
	cd web && NEXT_PUBLIC_RECUT_API_URL=http://127.0.0.1:17373 NEXT_PUBLIC_RECUT_SERVICE_VERSION=$(WEB_SERVICE_VERSION) npm run build:cloudflare

web-deploy: service-release web-build-cloudflare ## Package the service, export the web workspace, then deploy it to Cloudflare.
	cd web && node ./node_modules/wrangler/bin/wrangler.js deploy

deploy: web-deploy ## Build macOS service release assets and deploy the complete web workspace to Cloudflare.

app-link: ## Link one local App package (APP=apps/vox-broll) or every local package into ~/.recut/apps.
	@set -e; \
	if [ -n "$(APP)" ]; then set -- "$(APP)"; else set -- apps/*; fi; \
	mkdir -p "$(RECUT_HOME)/apps"; \
	for source in "$$@"; do \
		if [ ! -f "$$source/manifest.json" ]; then continue; fi; \
		name="$$(basename "$$source")"; \
		target="$(RECUT_HOME)/apps/$$name"; \
		if [ -e "$$target" ] && [ ! -L "$$target" ]; then echo "Refusing to replace non-link App package: $$target"; exit 1; fi; \
		if [ -L "$$target" ]; then rm "$$target"; fi; \
		absolute="$$(cd "$$source" && pwd -P)"; \
		ln -s "$$absolute" "$$target"; \
		echo "Linked $$name -> $$absolute"; \
	done

check: service-test service-vet web-build ## Run all service and web verification.
