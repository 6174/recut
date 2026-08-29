> 来源: story-director-skills/short-film-development (MIT)

---
name: short-film-development
description: "Develop short stories and short films from raw ideas into loglines, premises, themes, character engines, conflict, structure, treatments, scene lists, prose plans, and revision plans for cinematic AI production."
---

# short-film-development

## When to use
- A user has a raw idea, image, premise, theme, genre, character, or mood and wants a short-film concept.
- The user asks for loglines, treatments, outlines, short-story plans, character conflict, theme, acts, or a revision plan.
- The next downstream task is screenplay, shot list, visual bible, image prompts, or video prompts.

## When not to use
- The user already has locked script pages and only needs shot extraction.
- The task is only model-specific prompt translation.
- The user wants legal clearance, financing, casting, or production scheduling.

## Required inputs
- Raw idea or constraint
- Target length or runtime range
- Genre/tone/audience if known
- Any required characters, locations, or production limits

## Optional inputs
- Reference films or style anchors
- Theme or emotional promise
- Available AI models or output format
- Continuity bible entries

## Workflow
1. Clarify the creative intent layer: story engine, theme, protagonist desire, emotional wound, obstacle, stakes, point of view if prose, and audience experience.
2. Generate 3 to 5 divergent concept routes when the idea is early; select or recommend one based on specificity, feasibility, and cinematic promise.
3. Write a logline with protagonist, goal, obstacle, stakes, and irony or pressure.
4. Expand into premise, theme statement, character engine, central conflict, world rules, and ending direction.
5. Choose a compact structure: unity-of-effect short story, Fichtean crisis curve, single turning point, three-beat micro-arc, circular reveal, escalation spiral, or procedural countdown.
6. Create a scene list where every scene has dramatic purpose, visual purpose, emotional turn, and continuity needs.
7. Produce a revision plan that strengthens causality, compresses exposition, and removes unfilmable abstraction.

## Decision logic
- If the idea is vague, run idea intake before writing.
- If the concept is visually strong but narratively thin, build the character want/need conflict first.
- If runtime is under 3 minutes, prefer one location, one core conflict, and one major turn.
- If the user wants prompts soon, preserve image/video-ready visual anchors in every scene.

## Output formats
- Logline
- Premise sheet
- Theme and audience experience brief
- Character conflict map
- Short-story plan
- Short treatment
- Scene list
- Revision plan
- Downstream handoff brief

## Quality checks
- The logline contains a filmable conflict, not just a mood.
- Each scene changes story state or emotional state.
- The ending answers the opening tension.
- The concept includes reusable visual anchors for continuity and prompting.
- The treatment separates what the audience sees/hears from backstory.

## Anti-patterns
- Abstract themes with no visible action
- Too many locations for a short runtime
- Worldbuilding that does not affect choices
- A protagonist who only observes
- Prompt-ready imagery that contradicts the story tone

## Exit criteria
- A concise concept package exists and can feed screenplay, shot list, bible, or prompt generation without re-interviewing the user.

## Supporting files
Read only the supporting file needed for the active task:
- `references/story_development_workflow.md`
- `references/ai_storytelling_workflow.md`
- `references/screenplay_structure.md`
- `references/continuity_handoff.md`
- `templates/idea_intake.md`
- `templates/logline.md`
- `templates/short_film_treatment.md`
- `templates/short_story_plan.md`
- `templates/story_revision_audit.md`
