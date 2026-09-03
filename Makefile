# [INPUT]: 依赖 Go、Node.js、发布归档工具与 scripts/install-service.sh
# [OUTPUT]: 对外提供本机开发、内嵌工作台与内置 App 归档、独占开发双端口回收、跨平台 service 构建/发布和 Web 部署命令
# [POS]: 仓库自动化根；统一定义 service 版本、工作台模式与发布物命名，并确保开发 service 可取得 API 17373 与事件流 17374
# [PROTOCOL]: 变更时更新此头部，然后检查 README.md
# Recut local development commands. Run `make help` for the public interface.

.DEFAULT_GOAL := help
.PHONY: help dev deploy service-dev service-build service-release service-install service-status service-resume stop-stale-service stop-stale-web service-test service-vet web-install web-dev web-build web-build-embedded web-build-cloudflare web-deploy cd-upload app-link builtin-apps editor-ui-build check editor-model-test editor-frame-render-test editor-authoring-quality-test transcribe-e2e worlds-check worlds-build worlds-seed worlds-upload worlds-publish worlds-status

GOCACHE ?= $(CURDIR)/.cache/go-build
RECUT_HOME ?= $(HOME)/.recut
APP ?=
SERVICE_PORT ?= 17373
STREAM_PORT ?= 17374
RECUT_VERSION ?= 0.1.48
WEB_SERVICE_VERSION ?= $(RECUT_VERSION)
TARGET ?=
BUILD_GOOS := $(if $(TARGET),$(word 1,$(subst -, ,$(TARGET))),$(if $(GOOS),$(GOOS),$(shell go env GOOS)))
BUILD_GOARCH := $(if $(TARGET),$(word 2,$(subst -, ,$(TARGET))),$(if $(GOARCH),$(GOARCH),$(shell go env GOARCH)))
SERVICE_BUILD ?= $(CURDIR)/build/recut-service$(if $(filter windows,$(BUILD_GOOS)),.exe)
RELEASE_STAGE ?= $(CURDIR)/build/releases
# 发布包本地暂存区：版本目录 cdn/buckets/releases/<version>（含全部平台包 + manifest.json，
# 历史可追溯），latest 仅保留最新版 manifest.json 指针（updater/install.sh 读它拿 version 再拼版本目录下载）。
# 经 `make cd-upload` 上传 R2，走 https://cdn.recut.video/releases/<version> 分发；
# 不再写入 web/public，否则会进入 Next 静态导出而超出 Cloudflare Workers Assets 单文件 25 MiB 上限。
RELEASE_PUBLIC ?= $(CURDIR)/cdn/buckets/releases/$(RECUT_VERSION)
RELEASE_LATEST ?= $(CURDIR)/cdn/buckets/releases/latest
BUILTIN_REMOTION_ARCHIVE := $(CURDIR)/service/builtin_apps/remotion-studio.tar.gz
BUILTIN_EDITOR_ARCHIVE := $(CURDIR)/service/builtin_apps/editor.tar.gz
BUILTIN_AUDIO_STUDIO_ARCHIVE := $(CURDIR)/service/builtin_apps/audio-studio.tar.gz
# audio-studio voxcpm 专用 venv（发布声音预设 / Voice Design 用；主 ASR venv 由 runner 自行解析）。
VOXCPM_PYTHON ?= $(firstword $(wildcard $(HOME)/.recut/python/envs/recut.audio-studio/audio-studio/*-voxcpm/bin/python))
# 发布平台覆盖 macOS（Apple Silicon 与 Intel）及 Windows，不产出 linux-* / freebsd-* 包。
SERVICE_RELEASE_TARGETS := darwin-arm64 darwin-amd64 windows-arm64 windows-amd64

help: ## Show available development commands.
	@awk 'BEGIN { FS = ":.*##"; printf "\nRecut development commands:\n" } /^[a-zA-Z0-9_-]+:.*##/ { printf "  %-16s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

dev: builtin-apps stop-stale-service stop-stale-web ## Start the LAN service and web development workspace together.
	@set -e; \
	GOCACHE=$(GOCACHE) go -C service run . --address ":$(SERVICE_PORT)" --stream-address ":$(STREAM_PORT)" & service_pid=$$!; \
	( cd web && NEXT_PUBLIC_RECUT_WORKSPACE_MODE=lan NEXT_PUBLIC_RECUT_API_PORT=$(SERVICE_PORT) NEXT_PUBLIC_RECUT_APP_URL=http://app.localhost:3000 npm run dev ) & web_pid=$$!; \
	trap 'kill $$service_pid $$web_pid 2>/dev/null || true' EXIT INT TERM; \
	wait $$service_pid $$web_pid

stop-stale-service: ## Reclaim the API and event-stream ports from every listener before starting the development service.
	@case "$$(uname -s)" in \
		Darwin) for label in video.recut.service video.recut.dev-session; do \
			full="gui/$$(id -u)/$$label"; \
			if launchctl print "$$full" >/dev/null 2>&1; then echo "Pausing Recut launchd job $$label."; launchctl bootout "$$full" || true; fi; \
		done ;; \
		Linux) if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet recut.service; then echo "Pausing installed Recut service."; systemctl --user stop recut.service; fi ;; \
	esac; \
	port_pids="$$(for port in $(SERVICE_PORT) $(STREAM_PORT); do lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null || true; done | sort -u)"; \
	if [ -z "$$port_pids" ]; then exit 0; fi; \
	echo "Reclaiming development ports $(SERVICE_PORT) and $(STREAM_PORT) from PID(s) $$port_pids."; \
	for pid in $$port_pids; do kill -TERM "$$pid" 2>/dev/null || true; done; \
	for attempt in $$(seq 1 100); do \
		remaining="$$(for port in $(SERVICE_PORT) $(STREAM_PORT); do lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null || true; done | sort -u)"; \
		if [ -z "$$remaining" ]; then exit 0; fi; \
		sleep 0.1; \
	done; \
	echo "Force-reclaiming development ports $(SERVICE_PORT) and $(STREAM_PORT) from PID(s) $$remaining."; \
	for pid in $$remaining; do kill -KILL "$$pid" 2>/dev/null || true; done; \
	for attempt in $$(seq 1 20); do \
		if [ -z "$$(for port in $(SERVICE_PORT) $(STREAM_PORT); do lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null || true; done | sort -u)" ]; then exit 0; fi; \
		sleep 0.1; \
	done; \
	echo "Could not reclaim development ports $(SERVICE_PORT) and $(STREAM_PORT)."; exit 1

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

service-dev: stop-stale-service ## Start only the LAN Go service for the port 3000 workspace (API 17373, event streams 17374). Built-in App archives build only once; rebuild them via `make builtin-apps` or `make deploy`.
	@set -e; \
	if [ ! -f "$(BUILTIN_REMOTION_ARCHIVE)" ] || [ ! -f "$(BUILTIN_EDITOR_ARCHIVE)" ] || [ ! -f "$(BUILTIN_AUDIO_STUDIO_ARCHIVE)" ]; then \
		echo "Built-in App archives missing; building them once."; \
		$(MAKE) builtin-apps; \
	fi; \
	dev_service="$(CURDIR)/.cache/recut-service-dev"; \
	mkdir -p "$$(dirname "$$dev_service")"; \
	GOCACHE=$(GOCACHE) go -C service build -o "$$dev_service" -ldflags "-X main.serviceVersion=dev" .; \
	"$$dev_service" --address ":$(SERVICE_PORT)" --stream-address ":$(STREAM_PORT)" & service_pid=$$!; \
	trap 'kill -TERM "$$service_pid" 2>/dev/null || true; wait "$$service_pid" 2>/dev/null || true' EXIT INT TERM; \
	wait "$$service_pid"

service-build: builtin-apps web-build-embedded ## Build a production service with its local workspace (TARGET=darwin-arm64, darwin-amd64, windows-amd64, windows-arm64, or host default).
	@mkdir -p "$(dir $(SERVICE_BUILD))"
	GOCACHE=$(GOCACHE) GOOS="$(BUILD_GOOS)" GOARCH="$(BUILD_GOARCH)" go -C service build -trimpath -ldflags "-s -w -X main.serviceVersion=$(RECUT_VERSION)" -o "$(SERVICE_BUILD)" .

service-release: builtin-apps web-build-embedded ## Build self-contained service packages staged for the CDN: cdn/buckets/releases/<version>/ + latest manifest pointer (make cd-upload to publish to R2).
	@set -e; \
	mkdir -p "$(RELEASE_STAGE)" "$(RELEASE_PUBLIC)" "$(RELEASE_LATEST)"; \
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
	printf '}}\n' >> "$$manifest"; \
	cp "$$manifest" "$(RELEASE_LATEST)/manifest.json"; \
	echo "Staged $(RECUT_VERSION) packages in $(RELEASE_PUBLIC) with latest pointer."

cd-upload: ## Upload only this version + latest pointer to R2 (versioned at https://cdn.recut.video/releases/<version>, latest pointer at /releases/latest). Historical versions are immutable, so only the newly staged <version>/ and latest/manifest.json are touched; --skip-existing compares MD5 vs remote ETag so unchanged packages are not re-uploaded.
	node cdn/scripts/cli.mjs upload releases --only $(RECUT_VERSION) --only latest/manifest.json --skip-existing

service-install: service-build ## Install the host-target production service (macOS/Linux/FreeBSD shell hosts; published releases ship macOS Intel/Apple-silicon and Windows).
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

service-test: builtin-apps web-build-embedded ## Run the service test suite.
	GOCACHE=$(GOCACHE) go -C service test .

service-vet: ## Run Go static analysis for the local service.
	GOCACHE=$(GOCACHE) go -C service vet .

web-install: ## Install locked web workspace dependencies.
	cd web && npm ci

web-dev: stop-stale-web ## Start the public localhost site; app.localhost:3000 is the LAN-aware workspace.
	cd web && NEXT_PUBLIC_RECUT_WORKSPACE_MODE=lan NEXT_PUBLIC_RECUT_API_PORT=$(SERVICE_PORT) NEXT_PUBLIC_RECUT_APP_URL=http://app.localhost:3000 NEXT_PUBLIC_RECUT_SITE_URL=http://localhost:3000 npm run dev

web-build: ## Build and type-check the Next.js workspace.
	cd web && npm run build

web-e2e-worker: web-build-cloudflare ## Worker 路由 E2E：真实 worker.ts + out/ 静态导出（Accept-Language/cookie 判定、302/301、双语言正文）。
	cd web && npm run test:e2e:worker

web-e2e: ## 浏览器 E2E：自动拉起本地 dev server 验证官网 hydration、逐语言渲染、自动跳转与 cookie 切换。
	cd web && npm run test:e2e

web-build-embedded: ## Export the same-origin local workspace and stage it for Go embedding (never copies service releases). Marketing pages are served from the CDN (web-build-cloudflare), not from the service binary, so marketing/ is dropped here to keep release archives small.
	@rm -rf "$(CURDIR)/web/out"
	cd web && NEXT_PUBLIC_RECUT_WORKSPACE_MODE=local NEXT_PUBLIC_RECUT_APP_URL=https://app.recut.video NEXT_PUBLIC_RECUT_SERVICE_VERSION=$(WEB_SERVICE_VERSION) npm run build:cloudflare
	@rm -rf "$(CURDIR)/service/ui/assets/marketing"
	@rsync -a --delete --exclude='.keep' --exclude='releases/' --exclude='marketing/' "$(CURDIR)/web/out/" "$(CURDIR)/service/ui/assets/"
	@rm -rf "$(CURDIR)/service/ui/assets/releases"

web-build-cloudflare: ## Export the static web workspace for the Cloudflare Worker (service releases live on the CDN, never in Worker Assets).
	@rm -rf "$(CURDIR)/web/out"
	@rm -rf "$(CURDIR)/web/public/releases"
	cd web && NEXT_PUBLIC_RECUT_WORKSPACE_MODE=cloud NEXT_PUBLIC_RECUT_API_URL=http://127.0.0.1:17373 NEXT_PUBLIC_RECUT_APP_URL=https://app.recut.video NEXT_PUBLIC_RECUT_SERVICE_VERSION=$(WEB_SERVICE_VERSION) npm run build:cloudflare

web-deploy: service-release cd-upload web-build-cloudflare ## Package the service, publish it to the CDN, export the web workspace, then deploy it to Cloudflare.
	cd web && node ./node_modules/wrangler/bin/wrangler.js deploy

deploy: web-deploy ## Build macOS service release assets and deploy the complete web workspace to Cloudflare.

app-link: ## Link one local App package (APP=apps/ai-short-film) or every local package into ~/.recut/apps.
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

builtin-apps: editor-ui-build ## Package the App sources that ship inside every Recut service binary.
	@mkdir -p "$(dir $(BUILTIN_REMOTION_ARCHIVE))"
	node scripts/package-builtin-app.mjs apps/remotion-studio "$(BUILTIN_REMOTION_ARCHIVE)"
	node scripts/package-builtin-app.mjs apps/editor "$(BUILTIN_EDITOR_ARCHIVE)"
	node scripts/package-builtin-app.mjs apps/audio-studio "$(BUILTIN_AUDIO_STUDIO_ARCHIVE)"

editor-ui-build: ## Build the editor UI bundle included in the builtin editor App.
	@set -e; \
	if [ ! -d "$(CURDIR)/apps/editor/ui/node_modules" ]; then (cd "$(CURDIR)/apps/editor/ui" && npm ci); fi; \
	(cd "$(CURDIR)/apps/editor/ui" && npm run build)

editor-model-test: ## L0 Model API 测试：AI op 引擎、D1 关键帧、统一日志 undo/redo/conflict、aiLock。
	node apps/editor/scripts/test-model-api.js

editor-frame-render-test: ## L0 frame-render（平台通讯契约 preview.frame 消费者）纯逻辑测试。
	node apps/editor/scripts/test-frame-render.js

editor-authoring-quality-test: ## L0 Editor prompt/worklog 质量门（不替代真片 golden）。
	node apps/editor/scripts/test-authoring-quality.js

effects-catalog: ## 从 runtime EFFECT_COMPONENTS 重新生成内置效果目录（apps/editor/catalog + cdn/buckets/effects）。
	node apps/editor/scripts/build-effects-catalog.mjs

editor-e2e: ## 编辑器 UI Playwright 端到端（含 recut 项目实时同步）。
	cd apps/editor/ui && npx playwright test

check: service-test service-vet web-build editor-model-test editor-frame-render-test editor-authoring-quality-test ## Run all service and web verification.

transcribe-e2e: ## 真实接口转写 E2E（不经 UI）：editor subtitle.generate → audio.transcribe → subtitle.status 轮询到完成。
	cd service && RECUT_E2E_TRANSCRIBE=1 go test -run TestTranscriptionE2E -count=1 -v .

worlds-check: ## 校验 World 源格式（预算/ID/schema）并打印 manifest hash 预览（CI 防漂移）。
	node scripts/worlds-publish.mjs --check

worlds-build: ## 构建 World 发布产物（cdn/buckets/worlds/ + catalog.json）。
	node scripts/worlds-publish.mjs

worlds-seed: ## 构建 + 生成 service/worldcatalog/ 嵌入种子（随二进制发布，首启/离线兜底）。
	node scripts/worlds-publish.mjs --seed

worlds-upload: ## 增量上传 World 到 R2（只传新版本目录 + catalog；MD5 比对跳过未变更对象）。
	node scripts/worlds-publish.mjs --upload

worlds-publish: ## 完整发布流程：构建 + seed + 增量上传 R2（历史版本不可变，重复执行幂等）。
	node scripts/worlds-publish.mjs --seed --upload

worlds-status: ## 查看 CDN 上的 World 目录与 catalog。
	@node cdn/scripts/cli.mjs list worlds 2>/dev/null || echo "  (尚未上传或凭据缺失)"
	@echo "--- catalog.json ---"
	@curl -sf "https://cdn.recut.video/worlds/catalog.json" 2>/dev/null | head -30 || cat cdn/buckets/worlds/catalog.json 2>/dev/null | head -30 || echo "  (本地 catalog 未构建，先跑 make worlds-build)"

voices-sync: ## 同步声音预设单一信息源：再生成 background.js 兜底块 + 暂存 cdn/buckets/voices/（apps/audio-studio/python/publish_presets.py --sync）
	RECUT_MODELS_DIR=$(HOME)/.recut/models $(VOXCPM_PYTHON) apps/audio-studio/python/publish_presets.py --sync

voices-upload: ## 增量上传声音预设到 R2（https://cdn.recut.video/voices/，MD5 比对跳过未变更对象）+ 清 CDN 缓存的版本指针
	node cdn/scripts/cli.mjs upload voices --skip-existing
	node cdn/scripts/cli.mjs purge voices manifest.json
