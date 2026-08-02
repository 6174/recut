# [INPUT]: 依赖 Go、Node.js、发布归档工具与 scripts/install-service.sh
# [OUTPUT]: 对外提供本机开发、内嵌工作台、跨平台 service 构建/发布和 Web 部署命令
# [POS]: 仓库自动化根；统一定义 service 版本、工作台模式与发布物命名
# [PROTOCOL]: 变更时更新此头部，然后检查 README.md
# Recut local development commands. Run `make help` for the public interface.

.DEFAULT_GOAL := help
.PHONY: help dev deploy service-dev service-build service-release service-install service-status service-resume stop-stale-service stop-stale-web service-test service-vet web-install web-dev web-build web-build-embedded web-build-cloudflare web-deploy app-link check

GOCACHE ?= $(CURDIR)/.cache/go-build
RECUT_HOME ?= $(HOME)/.recut
APP ?=
RECUT_VERSION ?= 0.1.4
WEB_SERVICE_VERSION ?= $(RECUT_VERSION)
TARGET ?=
BUILD_GOOS := $(if $(TARGET),$(word 1,$(subst -, ,$(TARGET))),$(if $(GOOS),$(GOOS),$(shell go env GOOS)))
BUILD_GOARCH := $(if $(TARGET),$(word 2,$(subst -, ,$(TARGET))),$(if $(GOARCH),$(GOARCH),$(shell go env GOARCH)))
SERVICE_BUILD ?= $(CURDIR)/build/recut-service$(if $(filter windows,$(BUILD_GOOS)),.exe)
RELEASE_STAGE ?= $(CURDIR)/build/releases
RELEASE_PUBLIC ?= $(CURDIR)/web/public/releases/latest
SERVICE_RELEASE_TARGETS := darwin-arm64 darwin-amd64 linux-arm64 linux-amd64 freebsd-arm64 freebsd-amd64 windows-arm64 windows-amd64

help: ## Show available development commands.
	@awk 'BEGIN { FS = ":.*##"; printf "\nRecut development commands:\n" } /^[a-zA-Z0-9_-]+:.*##/ { printf "  %-16s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

dev: stop-stale-service stop-stale-web ## Start the LAN service and web development workspace together.
	@set -e; \
	GOCACHE=$(GOCACHE) go -C service run . & service_pid=$$!; \
	( cd web && NEXT_PUBLIC_RECUT_WORKSPACE_MODE=lan NEXT_PUBLIC_RECUT_API_PORT=17373 npm run dev ) & web_pid=$$!; \
	trap 'kill $$service_pid $$web_pid 2>/dev/null || true' EXIT INT TERM; \
	wait $$service_pid $$web_pid

stop-stale-service: ## Pause the installed Recut service, then clear a stale Recut daemon from port 17373.
	@port_pids="$$(lsof -tiTCP:17373 -sTCP:LISTEN 2>/dev/null || true)"; \
	if [ -z "$$port_pids" ]; then exit 0; fi; \
	for pid in $$port_pids; do \
		command="$$(ps -p "$$pid" -o comm= 2>/dev/null | xargs basename)"; \
		if [ "$$command" != "recut-service" ]; then echo "Port 17373 is occupied by a non-Recut process (PID $$pid); refusing to stop it."; exit 1; fi; \
	done; \
	case "$$(uname -s)" in \
		Darwin) label="gui/$$(id -u)/video.recut.service"; if launchctl print "$$label" >/dev/null 2>&1; then echo "Pausing installed Recut service."; launchctl bootout "$$label"; fi ;; \
		Linux) if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet recut.service; then echo "Pausing installed Recut service."; systemctl --user stop recut.service; fi ;; \
	esac; \
	for attempt in $$(seq 1 30); do \
		remaining="$$(lsof -tiTCP:17373 -sTCP:LISTEN 2>/dev/null || true)"; \
		if [ -z "$$remaining" ]; then exit 0; fi; \
		sleep 0.1; \
	done; \
	for pid in $$remaining; do echo "Stopping stale Recut daemon (PID $$pid)."; kill "$$pid"; done; \
	for attempt in $$(seq 1 30); do \
		if [ -z "$$(lsof -tiTCP:17373 -sTCP:LISTEN 2>/dev/null || true)" ]; then exit 0; fi; \
		sleep 0.1; \
	done; \
	echo "Recut did not release port 17373."; exit 1

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

service-dev: web-build-embedded stop-stale-service ## Start only the LAN Go service and embedded workspace on port 17373.
	GOCACHE=$(GOCACHE) go -C service run -ldflags "-X main.serviceVersion=dev" .

service-build: web-build-embedded ## Build a production service with its local workspace (TARGET=linux-amd64, windows-amd64, or host default).
	@mkdir -p "$(dir $(SERVICE_BUILD))"
	GOCACHE=$(GOCACHE) GOOS="$(BUILD_GOOS)" GOARCH="$(BUILD_GOARCH)" go -C service build -trimpath -ldflags "-s -w -X main.serviceVersion=$(RECUT_VERSION)" -o "$(SERVICE_BUILD)" .

service-release: web-build-embedded ## Build self-contained service packages for the public Cloudflare installers.
	@set -e; \
	mkdir -p "$(RELEASE_STAGE)" "$(RELEASE_PUBLIC)"; \
	manifest="$(RELEASE_PUBLIC)/manifest.json"; \
	printf '{"version":"%s","packages":{' "$(RECUT_VERSION)" > "$$manifest"; \
	first=1; \
	for target in $(SERVICE_RELEASE_TARGETS); do \
		os="$${target%-*}"; arch="$${target#*-}"; binary="recut-service-$$os-$$arch"; \
		if [ "$$os" = windows ]; then binary="$$binary.exe"; fi; \
		echo "Building $$binary"; \
		GOCACHE=$(GOCACHE) GOOS="$$os" GOARCH="$$arch" go -C service build -trimpath -ldflags "-s -w -X main.serviceVersion=$(RECUT_VERSION)" -o "$(RELEASE_STAGE)/$$binary" .; \
		if [ "$$os" = windows ]; then \
			command -v zip >/dev/null 2>&1 || { echo "zip is required to package Windows releases" >&2; exit 1; }; \
			archive="$$binary.zip"; (cd "$(RELEASE_STAGE)" && zip -q -j "$(RELEASE_PUBLIC)/$$archive" "$$binary"); \
		else archive="$$binary.tar.gz"; tar -C "$(RELEASE_STAGE)" -czf "$(RELEASE_PUBLIC)/$$archive" "$$binary"; fi; \
		if command -v shasum >/dev/null 2>&1; then checksum="$$(shasum -a 256 "$(RELEASE_PUBLIC)/$$archive" | awk '{print $$1}')"; \
		elif command -v sha256sum >/dev/null 2>&1; then checksum="$$(sha256sum "$(RELEASE_PUBLIC)/$$archive" | awk '{print $$1}')"; \
		else echo "shasum or sha256sum is required" >&2; exit 1; fi; \
		if [ "$$first" = 0 ]; then printf ',' >> "$$manifest"; fi; first=0; \
		printf '"%s":{"archive":"%s","sha256":"%s"}' "$$os-$$arch" "$$archive" "$$checksum" >> "$$manifest"; \
	done; \
	printf '}}\n' >> "$$manifest"

service-install: service-build ## Install the host-target production service (macOS/Linux/FreeBSD shell hosts).
	@test "$(BUILD_GOOS)" = "$$(go env GOOS)" || { echo "service-install must target this host; copy the cross-built binary to $(BUILD_GOOS)-$(BUILD_GOARCH) instead." >&2; exit 1; }
	@chmod +x scripts/install-service.sh
	@RECUT_HOME="$(RECUT_HOME)" scripts/install-service.sh "$(SERVICE_BUILD)"

service-status: ## Show the current-user production service status.
	@if [ "$$(uname -s)" = "Darwin" ]; then launchctl print "gui/$$(id -u)/video.recut.service"; \
	elif command -v systemctl >/dev/null 2>&1; then systemctl --user status recut.service --no-pager; \
	else echo "No supported user service manager found. Check $(RECUT_HOME)/logs."; fi

service-resume: ## Resume the installed current-user production service after local development.
	@case "$$(uname -s)" in \
		Darwin) plist="$(HOME)/Library/LaunchAgents/video.recut.service.plist"; test -f "$$plist" || { echo "No installed Recut launchd service found."; exit 1; }; launchctl print "gui/$$(id -u)/video.recut.service" >/dev/null 2>&1 || launchctl bootstrap "gui/$$(id -u)" "$$plist" ;; \
		Linux) command -v systemctl >/dev/null 2>&1 || { echo "systemctl is required to resume the installed Recut service."; exit 1; }; systemctl --user start recut.service ;; \
		*) echo "Start $(RECUT_HOME)/bin/recut-service with this host's process manager."; exit 1 ;; \
	esac

service-test: web-build-embedded ## Run the service test suite.
	GOCACHE=$(GOCACHE) go -C service test .

service-vet: ## Run Go static analysis for the local service.
	GOCACHE=$(GOCACHE) go -C service vet .

web-install: ## Install locked web workspace dependencies.
	cd web && npm ci

web-dev: stop-stale-web ## Start only the LAN-aware Next.js workspace on port 3000.
	cd web && NEXT_PUBLIC_RECUT_WORKSPACE_MODE=lan NEXT_PUBLIC_RECUT_API_PORT=17373 npm run dev

web-build: ## Build and type-check the Next.js workspace.
	cd web && npm run build

web-build-embedded: ## Export the same-origin local workspace and stage it for Go embedding (never copies service releases).
	@rm -rf "$(CURDIR)/web/out"
	cd web && NEXT_PUBLIC_RECUT_WORKSPACE_MODE=local NEXT_PUBLIC_RECUT_SERVICE_VERSION=$(WEB_SERVICE_VERSION) npm run build:cloudflare
	@rsync -a --delete --exclude='.keep' --exclude='releases/' "$(CURDIR)/web/out/" "$(CURDIR)/service/ui/assets/"
	@rm -rf "$(CURDIR)/service/ui/assets/releases"

web-build-cloudflare: ## Export the static web workspace for the Cloudflare Worker.
	@rm -rf "$(CURDIR)/web/out"
	cd web && NEXT_PUBLIC_RECUT_WORKSPACE_MODE=cloud NEXT_PUBLIC_RECUT_API_URL=http://127.0.0.1:17373 NEXT_PUBLIC_RECUT_SERVICE_VERSION=$(WEB_SERVICE_VERSION) npm run build:cloudflare

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
