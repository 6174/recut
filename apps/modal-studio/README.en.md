# Modal Functions

**Host open-source GPU projects on modal.com and generate images/videos with cloud GPUs**

Recut's Modal Functions app — a thin local client: add one modal token, deploy the image, prepare weights and call cloud functions.

## What it is

Modal Functions is a Recut **standard app** (`standalone`): it decouples the *cloud runtime* from *preset packs*. One app hosts many **modalapps**, each self-contained (`modalapps/<id>/`: `manifest.json` + `modal_app.py` + `bootstrap.py`).

- **No local GPU required**: all compute runs on [modal.com](https://modal.com) with your own Modal account (monthly free credits included).
- **The unit you switch is a preset pack**: each pack can expose multiple functions (t2i/i2i, t2v). Adding a capability = adding a directory + regenerating the registry; core code stays untouched.
- **Deploy and weights are separate**: `modal.deploy` builds/caches the cloud Image and deploys functions; `modal.install` writes weights into a Modal Volume. Weight sources: Hugging Face / ModelScope / automatic fallback.
- **Call the cloud like a local function**: the local client uses the Modal SDK (`Function.from_name(...).with_options(gpu=...).remote()`), with **no HTTP endpoint**.
- **Private by default**: outputs stay in the app's private area until `modal.save`.

## Form semantics

- **Remembered per preset pack**: every pack keeps its own persisted form slice (field values + references + GPU tier); switching packs, switching tabs or reloading brings back exactly what you left. The right pane's focused task is restored too (cleared if the task is gone).
- **Resolution**: the form's `resolution` field is the **output short-edge in pixels** — smaller is faster and cheaper. Natives differ per pack (MiniMax-H3 = 768p, Qwen-Image-2.1 = native 2K, SD-Turbo = 512) and are **never upscaled**: a value at or above the frame's native short edge keeps the native size. Image-edit / image-to-image follow the reference image's size, so they have no such field.
- **GPU tier**: an explicit choice is remembered (per pack); only when there is none does it fall back to the pack's declared default. Precedence is "this request > global default > pack default", and every candidate must exist in that pack's `gpuTiers.options` — otherwise the first option wins, so switching packs can never leave the selector blank.

## Quick start

1. Install and start Recut (see the main [README](../../README.en.md)).
2. Link the app: `make app-link APP=apps/modal-studio` (or install via `recut.apps.install`).
3. On first entry, **configure a Modal token** (modal.com → Settings → API Tokens) and verify.
4. Pick a preset pack → "Deploy environment" → "Download weights" → fill the form → "Run" → "Save to library".

## Capabilities

| Capability | Operations |
| --- | --- |
| First-paint payload (local read, zero wait) | `modal.overview` |
| Connectivity / catalog | `modal.status` · `modal.catalog` |
| Token / settings / secret | `modal.profiles.add/list/remove` · `modal.settings.set` · `modal.secret.set` |
| Preset pack management | `modal.modalapp.list` · `modal.modalapp.get` · `modal.modalapp.path` · `modal.modalapp.save` · `modal.modalapp.scaffold` · `modal.modalapp.remove` |
| Local runtime | `modal.prepare` |
| Deploy / weights / stop | `modal.deploy` · `modal.install` · `modal.teardown` |
| Run / history / save | `modal.generate` · `modal.generations` · `modal.generation.complete` · `modal.save` |
| Task center | `modal.tasks.list` · `modal.task.get` · `modal.task.logs` · `modal.task.cancel` · `modal.cancel` |

> **Integrated with the platform's image/video capabilities**: the manifest declares a `contributes.media` provider `modal-cloud`, and every preset pack that declares `expose` registers as one platform model (`modal-cloud/<model>`; both image and video). The platform's image/video default route can point at it, and generation dispatches to `modal.generate` through the generic execution bridge; a model is only `ready=true` once its pack is **deployed and its weights are ready** (`modal.catalog.models[]` reports readiness dynamically). **A text-only request (no references) auto-routes to the pack's text function (`text-to-*`); the reference function is used only when references are supplied** — references are optional (the platform budget only sets ceilings), so "no refs → text, refs → reference" holds under the platform default route. Other capabilities remain exposed directly through this app's api/mcp operations.

## Load order when entering the workspace

Readiness probing shells out to the `modal` CLI (one `modal volume ls` per deployed pack), which takes seconds — so it never blocks first paint:

1. **First paint (`modal.overview`)**: reads only local state — `python/registry.json` (packs/functions/forms), token profiles, settings — plus the **readiness snapshot from the last probe**. It returns in milliseconds, so packs and forms are usable immediately; readiness replays from the snapshot, and a pack with no snapshot yet shows "status unchecked" (**unknown is not the same as not deployed**).
2. **Background probe (`modal.status`)**: refreshes independently, filling in connectivity, deployment state, volume readiness and `stale` (code changed → redeploy), and **writes the result back as the snapshot** for the next first paint. It only affects status display and blocks nothing.
3. **Dynamic check on Run**: a fresh snapshot is trusted as-is; if it is stale (>60s) or missing, one probe runs first. **Only a confirmed not-ready pack (not deployed / weights missing) is blocked**, with a prompt to Prepare (deploy + weights) or Redeploy; unknown is never blocked — the submit contract is never-reject, and the real failure reason lands in the task log.

So entering the workspace no longer waits for probing; only the first Run of a pack that has never been probed costs one probe (a few seconds).

> **Readiness probing is best-effort**: readiness means the volume root carries the completion marker (`.recut-download-complete`, or `-v2` for some packs — matched by prefix). A single failed `modal volume ls` (network blip, CLI hiccup, volume being written by a deploy) is **not** treated as "weights not downloaded": it retries once, and only a second miss counts as not-ready. The Run-time check also re-verifies a "not ready" verdict, so a one-off blip can never harden into a false alarm. Probe-only commands (`app list` / `volume ls`) run silently so they add no stdout noise.

## Preset packs: built-in + user

Two sources share one contract (`manifest.json` + `modal_app.py` + `bootstrap.py`):

- **Built-in (origin=builtin)**: shipped in the app package under `apps/modal-studio/modalapps/<id>/`, **read-only**; `python/publish_registry.py` generates `python/registry.json`.
- **User (origin=user)**: created at runtime under the **appstate** dir `<dataRoot>/appstate/recut.modal-studio/files/modalapps/<id>/`, **writable**, discovered and merged at runtime.

```text
modal.modalapp.path                       # absolute built-in/user roots (edit with native tools)
modal.modalapp.scaffold { id, name }      # minimal end-to-end skeleton (placeholder, no weights)
modal.modalapp.save { id, manifest, modalAppPy, bootstrapPy }
modal.modalapp.list / modal.modalapp.get  # inspect (origin + absolute path)
modal.modalapp.remove { id }              # delete a user pack (built-ins cannot be removed)
```

User ids must not collide with built-ins; re-run `modal.deploy` after edits (and `modal.install` after changing `bootstrap.py`).

**Change detection.** A successful `modal.deploy` records the preset-pack folder's sha256 in appstate `modal/deploy-state.json`; `modal.status` / `modal.catalog` recompute the folder hash and return `stale: true` when it differs (trustworthy only after at least one deploy). So after an app upgrade or a `modal_app.py` edit the UI flags "redeploy required" and always offers a single manual "Redeploy" button (deploy runs bootstrap, refreshing weights too). Weights are intentionally not hash-tracked: `bootstrap.py` skips already-downloaded files, so re-running it after deploy is safe.

The folder hash honors a two-tier **ignore list** (files not shipped by `modal deploy` don't count as changes):
- **Common list** `modalapps/deploy-ignore.json` (shipped with the app, shared by built-in and user packs): docs & generated files (`manifest.json`, `*.md`, `index.json`), local mock/bench (`mock*.py`, `bench*.py`), run artifacts (`*.log`, `*.tmp`, `output/`, `samples/`), dev/test dirs (`test/`, `tests/`, `test*.py`, `*.ipynb`, `.venv/`, `node_modules/`). A trailing `xxx/` matches by directory name; other entries are globs (matched against the relative path or file name).
- **Per-pack**: add `deployIgnore: ["<glob>", ...]` to that pack's manifest to layer extra rules on top of the common list.

So editing manifests/docs/mocks no longer false-flags "redeploy required", and a single pack's noise files don't force a change to the common list.

## Bundled preset packs

| Pack | Capability | Functions | Model | GPU |
| --- | --- | --- | --- | --- |
| `minimax-h3` | video.generate | text-to-video / first-last-frame (native audio) | `MiniMaxAI/MiniMax-H3` (FL2VA, ~134GB, HF-gated) | H200×4 / H100×4 / B200×4 / B200×8 |
| `minimax-h3-one` | video.generate | same (base 50-step) | same weights (shares the `recut-minimax-h3-models` volume) | RTX PRO 6000 / H100 / H200 / B200 / B300 (**single-GPU + GPU snapshot**) |
| `minimax-h3-turbo` | video.generate | text-to-video / first-last-frame (**Turbo 9-step**, native audio; LoRA offline-merged in bootstrap) | same weights (shared volume) + Turbo LoRA | RTX PRO 6000 / H200 / B200 / B300 (**single-GPU + GPU snapshot + shape warmup**) |
| `qwen-image-2.1` | image.generate | text-to-image / image edit (up to 10 references) | `Qwen/Qwen-Image-2.1` (~33GB, native 2K) | L40S / A100 80GB / H100 / H200 |
| `sd-turbo` | image.generate | text-to-image / image-to-image | `stabilityai/sd-turbo` (~3GB) | T4 / A10G |

> `minimax-h3` serves H3 with multi-GPU SGLang: the container picks the official verified recipe from the detected GPU. You must first run `modal.secret.set { name: "recut-hf-token", values: { HF_TOKEN } }` and get access approval for `MiniMaxAI/MiniMax-H3` on Hugging Face. See `modalapps/minimax-h3/README.md`.
> `minimax-h3-one` (single-GPU + GPU snapshot, base 50-step) and `minimax-h3-turbo` (single-GPU + GPU snapshot, Turbo 9-step few-step LoRA) **share the same `recut-minimax-h3-models` volume**, so weights are downloaded only once; both freeze the resident SGLang service into a GPU memory snapshot for second-level cold starts. See each README.

## Extending

Add a directory under `modalapps/` (`manifest.json`, `modal_app.py`, `bootstrap.py`) and rerun `python3 python/publish_registry.py`. Core code needs no changes.

**Opting onto the platform (optional)**: add `expose: { "model": "<simple platform model id>", "function": "<function id>" }` to `manifest.json` and rerun the generator; the pack then registers as the platform model `modal-cloud/<model>` (`model` may only contain `a-z0-9-_`, so `qwen-image-2.1` exposes as `qwen-image`). `function` defaults to `functions[0]`, and the capability is derived from that function's `output.kind` (image/video/audio). Packs without `expose` stay off-platform (user scaffolds have none by default).

## Developers

```sh
make app-link APP=apps/modal-studio
cd apps/modal-studio/ui && npm install && npm run build
python3 apps/modal-studio/python/publish_registry.py
node apps/modal-studio/test/catalog_smoke.mjs   # first-paint path smoke (overview/status/snapshot/models)
```

- The main venv (`~/.recut/python/envs/recut.modal-studio/`) only holds the lightweight `modal` client; heavy dependencies live in the cloud Image.
- Token profiles are stored in the app's private files area and used only inside the `modal_runner.py` subprocess; never logged.

[Back to main README](../../README.en.md)
