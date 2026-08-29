> 来源: story-director-skills/screenplay-and-scene-writing (MIT)

---
name: screenplay-and-scene-writing
description: "Write and revise screenplay scenes, dialogue, beats, emotional turns, pacing, visual action, and screenplay-style excerpts from short-film concepts or outlines."
---

# screenplay-and-scene-writing

## When to use
- The user asks for screenplay pages, scene writing, dialogue, beats, pacing, emotional turns, or visual storytelling.
- The user provides a treatment, outline, scene purpose, or character conflict and wants it dramatized.
- The task is to revise a scene for clarity, subtext, tension, or cinematic action.

## When not to use
- The user only needs shot list extraction from already final pages.
- The user asks for image/video model parameters.
- The user wants a full prose-fiction workflow rather than screenplay or scene design; route early concept work to `short-film-development`.

## Required inputs
- Scene purpose
- Characters present
- Location and time
- Before/after story state
- Desired tone or genre

## Optional inputs
- Dialogue constraints
- Runtime/page target
- Visual bible anchors
- Specific format requirements, including Fountain

## Workflow
1. Define the scene transaction: who wants what, who resists, what changes.
2. List beats as playable actions, not explanations.
3. Choose the dominant point of view and what the audience knows at the start.
4. Write action lines as visible and audible behavior with concise sensory detail.
5. Write dialogue with subtext: characters pursue tactics, avoid saying the theme directly, and reveal pressure through choices.
6. If the user needs importable screenplay text, output strict Fountain markup and keep camera/production notes outside the scene.
7. Add an emotional turn and a final image or button that changes momentum.
8. Revise for compression: remove repeated beats, expository greetings, and internal states that cannot be filmed.

## Decision logic
- If dialogue carries exposition, convert part of it to behavior, prop use, interruption, or silence.
- If a beat cannot be shot, rewrite it as a visible action or sound.
- If the scene has no reversal, add discovery, choice, escalation, or cost.
- If prompts are a downstream goal, tag key visual anchors after the scene.

## Output formats
- Beat sheet
- Screenplay scene excerpt
- Fountain scene
- Dialogue pass
- Visual action pass
- Scene revision notes
- Prompting handoff notes

## Quality checks
- Every line changes tactic, pressure, or information.
- Action lines are filmable and not novelistic.
- Characters sound distinct by goal, rhythm, and avoidance strategy.
- The scene has a clear entry state, turn, and exit state.
- Important continuity details are captured for the bible.

## Anti-patterns
- Explaining backstory before the conflict starts
- Writing camera directions inside a draft unless requested
- Dialogue that states exactly what characters feel
- Unfilmable internal adjectives without behavior
- Scenes that end where they began

## Exit criteria
- A scene or beat sheet is ready for shot breakdown, revision, or prompt generation.

## Supporting files
Read only the supporting file needed for the active task:
- `references/scene_construction.md`
- `references/dialogue_and_subtext.md`
- `references/screenplay_format.md`
- `references/fountain_workflow.md`
- `templates/screenplay_scene.md`
- `templates/fountain_scene.md`
- `templates/beat_sheet.md`
