# Vox B-roll Agent Guide

> App-local operating contract | Parent map: /apps/vox-broll/README.md

This is an Agent guide, not runtime configuration. `manifest.json` remains the only runtime declaration.

## Goal

Turn a topic into a reusable Vox-style B-roll explainer brief, then create resources that explicitly depend on that brief or on earlier resources.

## Available actions

1. Call `generate_brief` first with a non-empty `topic`. It persists the brief and returns the immutable `recut.vox.brief@1` Artifact.
2. Call `create_resource` to save each created resource. Always provide `kind`, `title`, and `content`; provide `dependencies` when the resource uses a brief or another resource.
3. Use the app APIs only when operating through the UI flow: `brief.create`, `brief.latest`, `resource.prepare`, and `resource.list`.

## Operating rules

- Do not write briefs or resources directly to files. This App owns its SQLite state and publishes the brief Artifact itself.
- Do not inspect another App's database or filesystem. Cross-App data must arrive through a public API or an Artifact reference.
- A resource belongs to this App only after `create_resource` succeeds. Text drafted in chat is not persisted state.
- Create the brief before deriving resources, unless the user explicitly asks to revise an already-existing brief.
- Keep resource dependencies as explicit IDs; never infer hidden dependencies from prose.

## Change protocol

- When the manifest's tools, API names, permissions, data model, or flow changes, update this guide and `/apps/vox-broll/README.md` in the same change.
- When changing `background.js`, keep its INPUT/OUTPUT/POS header accurate.

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
