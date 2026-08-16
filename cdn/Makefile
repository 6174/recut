# [INPUT]: 依赖 cdn/config.mjs、cdn/scripts/*.mjs 与 web workspace 的 wrangler
# [OUTPUT]: 对外提供 Recut CDN（Cloudflare R2）资源管理的本地命令
# [POS]: Recut 云端资源工作区；cdn/buckets/{name}/ 是每个前缀的本地暂存区，
#        上传后经 https://cdn.recut.video/{name}/ 分发
# [PROTOCOL]: 变更时更新此头部，然后检查 README.md

.PHONY: help whoami fetch upload list delete sync url purge purge-all check cors fetch-fonts

help: ## Show available CDN commands.
	@awk 'BEGIN { FS = ":.*##"; printf "Recut CDN commands:\n" } /^[a-zA-Z0-9_-]+:.*##/ { printf "  %-16s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

whoami: ## Show the CDN bucket, account and base URL configuration.
	node scripts/cli.mjs whoami

fetch: ## Fetch the curated CC0 audio library into cdn/buckets/audio/ (music-only=--music-only).
	node scripts/fetch-audio.mjs $(ARGS)

fetch-fonts: ## Fetch the curated Google Fonts (incl. CJK) into cdn/buckets/fonts/google/ as self-hosted woff2 + css + catalog.
	node scripts/fetch-fonts.mjs $(ARGS)

upload: ## Upload cdn/buckets/$(PREFIX)/ to R2 (PREFIX=audio).
	@test -n "$(PREFIX)" || { echo "usage: make upload PREFIX=audio"; exit 1; }
	node scripts/cli.mjs upload $(PREFIX)

list: ## List objects in the R2 bucket for a prefix (PREFIX=audio).
	@test -n "$(PREFIX)" || { echo "usage: make list PREFIX=audio"; exit 1; }
	node scripts/cli.mjs list $(PREFIX)

delete: ## Delete all objects for a prefix from R2 (PREFIX=audio).
	@test -n "$(PREFIX)" || { echo "usage: make delete PREFIX=audio"; exit 1; }
	node scripts/cli.mjs delete $(PREFIX)

sync: ## Upload missing/changed files for a prefix (PREFIX=audio).
	@test -n "$(PREFIX)" || { echo "usage: make sync PREFIX=audio"; exit 1; }
	node scripts/cli.mjs sync $(PREFIX)

url: ## Print the public CDN URL for an object (PREFIX=audio KEY=music/ae-doomed.mp3).
	@test -n "$(PREFIX)" && test -n "$(KEY)" || { echo "usage: make url PREFIX=audio KEY=music/ae-doomed.mp3"; exit 1; }
	node scripts/cli.mjs url $(PREFIX) $(KEY)

check: ## Verify the CDN domain serves a sample object.
	@curl -s -o /dev/null -w "cdn.recut.video/audio/catalog.json -> HTTP %{http_code} %{content_type}\n" https://cdn.recut.video/audio/catalog.json

cors: ## Set the bucket CORS policy from cdn/cors.json (public read for preview/download).
	@cd ../web && node_modules/.bin/wrangler r2 bucket cors set $(if $(BUCKET),$(BUCKET),recut-assets) --file ../cdn/cors.json

purge: ## Purge CDN cache for a prefix or a single object (needs CLOUDFLARE_API_TOKEN).
	@test -n "$(PREFIX)" || { echo "usage: make purge PREFIX=audio [KEY=music/oga-bossa-nova.mp3]"; exit 1; }
	@test -n "$(CLOUDFLARE_API_TOKEN)" || { echo "CLOUDFLARE_API_TOKEN is required. Create one at https://dash.cloudflare.com/profile/api-tokens (Zone > Cache Purge permission) then export it."; exit 1; }
	node scripts/cli.mjs purge $(PREFIX) $(if $(KEY),$(KEY),)

purge-all: ## Purge the entire recut.video zone cache (needs CLOUDFLARE_API_TOKEN).
	@test -n "$(CLOUDFLARE_API_TOKEN)" || { echo "CLOUDFLARE_API_TOKEN is required. Create one at https://dash.cloudflare.com/profile/api-tokens (Zone > Cache Purge permission) then export it."; exit 1; }
	node scripts/cli.mjs purge-all
