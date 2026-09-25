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

## Quick start

1. Install and start Recut (see the main [README](../../README.en.md)).
2. Link the app: `make app-link APP=apps/modal-studio` (or install via `recut.apps.install`).
3. On first entry, **configure a Modal token** (modal.com → Settings → API Tokens) and verify.
4. Pick a preset pack → "Deploy environment" → "Download weights" → fill the form → "Run" → "Save to library".

## Capabilities

| Capability | Operations |
| --- | --- |
| Connectivity / catalog | `modal.status` · `modal.catalog` |
| Token / settings / secret | `modal.profiles.add/list/remove` · `modal.settings.set` · `modal.secret.set` |
| Preset pack management | `modal.modalapp.list` · `modal.modalapp.get` · `modal.modalapp.path` · `modal.modalapp.save` · `modal.modalapp.scaffold` · `modal.modalapp.remove` |
| Local runtime | `modal.prepare` |
| Deploy / weights / stop | `modal.deploy` · `modal.install` · `modal.teardown` |
| Run / history / save | `modal.generate` · `modal.generations` · `modal.generation.complete` · `modal.save` |
| Task center | `modal.tasks.list` · `modal.task.get` · `modal.task.logs` · `modal.task.cancel` · `modal.cancel` |

> **v1 does not integrate with the platform**: no `contributes.media`, no default image/video routes; capabilities are exposed only through this app's api/mcp operations.

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

## Bundled preset packs

| Pack | Capability | Functions | Model | GPU |
| --- | --- | --- | --- | --- |
| `minimax-h3` | video.generate | text-to-video / first-last-frame (native audio) | `MiniMaxAI/MiniMax-H3` (FL2VA, ~134GB, HF-gated) | H200×4 / H100×4 / B200×4 / B200×8 |
| `sd-turbo` | image.generate | text-to-image / image-to-image | `stabilityai/sd-turbo` (~3GB) | T4 / A10G |

> `minimax-h3` serves H3 with multi-GPU SGLang: the container picks the official verified recipe from the detected GPU. You must first run `modal.secret.set { name: "recut-hf-token", values: { HF_TOKEN } }` and get access approval for `MiniMaxAI/MiniMax-H3` on Hugging Face. See `modalapps/minimax-h3/README.md`.

## Extending

Add a directory under `modalapps/` (`manifest.json`, `modal_app.py`, `bootstrap.py`) and rerun `python3 python/publish_registry.py`. Core code needs no changes.

## Developers

```sh
make app-link APP=apps/modal-studio
cd apps/modal-studio/ui && npm install && npm run build
python3 apps/modal-studio/python/publish_registry.py
```

- The main venv (`~/.recut/python/envs/recut.modal-studio/`) only holds the lightweight `modal` client; heavy dependencies live in the cloud Image.
- Token profiles are stored in the app's private files area and used only inside the `modal_runner.py` subprocess; never logged.

[Back to main README](../../README.en.md)
