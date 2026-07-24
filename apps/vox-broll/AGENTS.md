# Vox B-roll Agent Guide

> App-local operating contract | Parent map: /apps/vox-broll/README.md

This guide adapts the creative workflow of [vox-director](https://github.com/Alisa0808/vox-director) to Recut's App model. It is not runtime configuration: `manifest.json` remains the only runtime declaration, and this App does not itself render media or require Atlas Cloud, ffmpeg, or local output files.

## Goal

Turn a topic into a reviewable Vox-style paper-collage B-roll production plan. Persist every approved stage as an App resource so later stages consume explicit IDs rather than chat memory.

## Production graph

`Brief → Beats → Look → Keyframes → Motion → Audio → Delivery`

Create resources in that order. A later resource must list the IDs of the earlier resources it uses in `dependencies`.

- **Brief** — topic, audience, premise, central tension, and editorial direction.
- **Beats** — one chosen narrative arc, a ≤3-second hook, then a concise beat map. A 30-second piece normally needs 6–8 beats; every beat normally has a wide headline shot plus a detail shot, each about 3–6 seconds.
- **Look** — 3–4 topic-appropriate theme candidates and the user's selected visual system: paper technique, era, palette, type treatment, texture, and mood. The image/keyframe owns the collage look; motion cannot rescue a weak poster.
- **Keyframes** — a poster specification for every shot: layered cut-outs, torn paper, tape, halftone/newsprint texture, flat colour, and headline placement. Keep real people and brand marks as protected reference assets, not invented replacements.
- **Motion** — one continuous camera move per shot plus paper-native element motion. Keep the graphic flat and text/layout stable; gain rhythm by cutting between short wide/detail shots, not by cramming multiple moves into one shot.
- **Audio** — narration direction, music direction, caption intent, and mix constraints.
- **Delivery** — final timeline, aspect ratio, export specification, and a verification checklist. It is a plan until an appropriate rendering App publishes the actual media output.

## Human decision gates

1. Draft the **Beats** resource, then stop for user approval before creating downstream creative resources.
2. Draft the **Look** candidates, then stop for the user to choose a style before keyframes or motion.

If the user supplies an already-approved beat map or look, persist it as the relevant resource and continue. Do not silently replace an approved decision.

## Available actions

1. Call `generate_brief` first with a non-empty `topic`. It persists the brief and returns the immutable `recut.vox.brief@1` Artifact.
2. Call `create_resource` to persist every non-Brief stage. Always provide `kind`, `title`, and structured `content`; include all consumed resource IDs in `dependencies`.
3. In the UI flow, use `brief.create`, `brief.latest`, `resource.prepare`, and `resource.list`. `resource.prepare` creates the correct Agent request; completing the work still requires `create_resource`.

## Boundaries

- Do not write briefs, plans, or resources directly to files. This App owns SQLite state and publishes Artifacts itself.
- Do not inspect another App's database or filesystem. Cross-App input must arrive through a public API or Artifact reference.
- Text drafted in chat is not App state. A stage exists only after `create_resource` succeeds.
- Keep dependencies explicit IDs; never infer hidden provenance from prose.
- Do not claim that a keyframe, clip, soundtrack, or final video exists unless a producing App has published it as a resource or Artifact.

## Change protocol

- When the manifest's tools, API names, permissions, data model, stage graph, or approval gates change, update this guide and `/apps/vox-broll/README.md` in the same change.
- When changing `background.js`, keep its INPUT/OUTPUT/POS header accurate.

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
