/*
 * [INPUT]: 依赖 node:fs / node:path 与 gray-matter，读取 content/apps/zh/*.mdx；英文正文在本文件内联提供（content 目录由内容任务另行演化，本文件不修改 content/**）
 * [OUTPUT]: 对外提供官网应用市场与应用详情 SEO 落地页的静态营销数据：MarketingApp 用户可见字段（name/tagline/description/keywords/faq/requirements/body）为 Record<Locale, …>，中文来自 MDX、英文来自内联翻译；id/type/relatedApps/repository 与语言无关
 * [POS]: web/lib 的公开营销内容加载器；只在服务端模块（页面、sitemap、JSON-LD）导入，客户端组件一律通过 props 接收数据；App 的 `id` 需与工作台 Catalog 的 app id 一致以打通「在工作台打开」深链，但内容与目录完全解耦；en 为 default 面必须恒有内容
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { type Locale } from "@/lib/i18n/locales";

export type MarketingAppFaq = { question: string; answer: string };

export type MarketingApp = {
  id: string;
  type: "project" | "standalone";
  name: Record<Locale, string>;
  tagline: Record<Locale, string>;
  description: Record<Locale, string>;
  keywords: Record<Locale, string[]>;
  faq: Record<Locale, MarketingAppFaq[]>;
  relatedApps: string[];
  requirements?: Record<Locale, { title: string; items: string[]; note?: string }>;
  repository?: string;
  body: Record<Locale, string>;
};

type AppFrontmatter = {
  id?: string;
  name?: string;
  type?: string;
  tagline?: string;
  description?: string;
  keywords?: unknown;
  faq?: unknown;
  relatedApps?: unknown;
  requirements?: { title?: string; items?: unknown; note?: string };
  repository?: string;
};

type EnApp = {
  name: string;
  tagline: string;
  description: string;
  keywords?: string[];
  faq?: MarketingAppFaq[];
  requirements?: { title: string; items: string[]; note?: string };
  body: string;
};

// 英文内容（内联）：与 zh 目录按 id 对应；en 是 default 无前缀面，必须恒有内容。
const EN_APPS: Record<string, EnApp> = {
  "recut.editor": {
    name: "Video Editor",
    tagline: "Let Codex or Claude Code drive the video creation workflow — editing is no longer only for professionals",
    description: "Recut Editor lets Codex, Claude Code and other agents participate in real video creation: organizing footage, planning shots, shaping pacing and operating an editable timeline. You do not need to become a professional editor first; every action lands as a reviewable, editable and reversible result, with the final decision still yours.",
    keywords: ["AI video editor", "agentic video editing", "Codex video workflow", "Claude Code video workflow", "local video editor", "open source video editor"],
    faq: [
      {
        question: "Can Codex or Claude Code really help edit a video?",
        answer: "Yes. Describe the goal in natural language and the Agent can help organize footage, plan shots, shape an initial rhythm and propose timeline changes. Each result remains visible, editable and reversible in the Editor.",
      },
      {
        question: "Do I need professional editing experience?",
        answer: "No. The Agent handles the first pass from your description, while the timeline keeps every result understandable and adjustable. You can start with an intention instead of mastering every editing control first.",
      },
    ],
    body: `Let Codex or Claude Code drive your video creation workflow. Recut Editor turns a natural-language goal into an editable project: the Agent helps organize footage, plan shots and shape pacing, while you keep the final say.

## Editing help without becoming a professional first

You do not need to learn every panel before making a good first cut. Describe the story, audience or mood you want, and the Agent can prepare a reviewable starting point. The result is not a black-box export: it lands on a timeline you can inspect, change and undo.

## A real timeline, not a one-click video generator

Media, preview, properties and multi-track editing stay visible together. Every suggestion has a place in the project, so you can understand why a shot appears, adjust its timing and continue working with your own judgment.

## Codex and Claude Code as creative collaborators

Use the coding Agent you already trust to describe the next change. Recut connects that conversation to the editing workflow, turning intent into concrete, reviewable operations instead of leaving you to translate every idea into dozens of manual clicks.

## Local-first and reversible by design

Your media, project and reusable components stay on your machine. Agent suggestions never take away control: accept them, edit them, undo them or ignore them, then keep shaping the same project.`
  },
  "recut.audio-studio": {
    name: "Audio Studio",
    tagline: "Free local ASR understands your footage, clones an authorized voice for narration and dubbing, then returns it to the editor",
    description: "Auto-captions with Audio Studio: a Qwen ASR model on your machine turns audio and video into timestamped captions and an editable transcript, with SRT/ASS/Markdown export that drops straight into your editing flow; synthesize dubbing locally with CosyVoice and reuse licensed voice characters. Media and voices stay on your device and work offline — built for talking-head, interview, course and narration creators.",
    keywords: [
      "auto video captions",
      "AI dubbing software",
      "local speech transcription",
      "video to subtitles",
      "caption generation tool",
      "AI voice cloning",
      "voiceover dubbing",
      "local ASR deployment",
      "local AI dubbing",
    ],
    faq: [
      {
        question: "How do I auto-caption a video?",
        answer: "Drag the video into Audio Studio and a local ASR model like Qwen transcribes it automatically, generating timestamped captions and an editable transcript — no need to upload media to the cloud. Export SRT or ASS when done and load them straight into CapCut, Premiere and similar editors.",
      },
      {
        question: "Can Audio Studio work without an internet connection?",
        answer: "Yes. Transcription and dubbing are both done by local models, so they work in fully offline environments. Media and voice characters stay on your device the whole time and never reach a third-party server — ideal for privacy-sensitive creation.",
      },
      {
        question: "What computer specs do I need?",
        answer: "Basic transcription is recommended with at least 16 GB RAM; creating voice characters and dubbing reliably is recommended with 32 GB+ and roughly 15 GB of free disk. An NVIDIA CUDA GPU with 8 GB+ VRAM transcribes faster; CPU-only or Apple silicon Macs work too, just slower.",
      },
      {
        question: "Will voice cloning leak my voice?",
        answer: "No. The characters you build for licensed voices are stored locally, and dubbing is synthesized by local models like CosyVoice — voice data never leaves the device. Only use voices you own or have rights to, and avoid cloning others' timbres.",
      },
      {
        question: "Can the generated captions be used in CapCut?",
        answer: "Yes. Audio Studio exports standard SRT/ASS caption formats — import the file into CapCut or Premiere and layer it on your edit; transcripts can also be exported as Markdown for scripting, lecture notes or publishing.",
      },
    ],
    requirements: {
      title: "Check your device before you run",
      items: [
        "Basic transcription is recommended with at least 16 GB RAM; creating voice characters and synthesizing dubbing reliably is recommended with 32 GB or more. 8 GB machines or older devices are not recommended.",
        "Reserve at least 15 GB of disk: Qwen3-ASR 0.6B plus the timestamp aligner is about 3.5 GB, CosyVoice2-0.5B about 1 GB, with the Python runtime and cache taking more; downloading several models needs more space.",
        "For faster Qwen transcription, an NVIDIA CUDA GPU with 8 GB+ VRAM on Windows/Linux is recommended. Pure CPU and Apple silicon Macs run too, but the current version doesn't use Apple GPU acceleration, so Qwen and dubbing will be noticeably slower.",
      ],
      note: "Models run on your machine. Installing the App doesn't download weights; they download only when you pick a model inside Audio Studio.",
    },
    body: `Captions are the invisible amplifier of video, but most "one-click caption" tools want your media in the cloud first, then limit you by duration, usage and price. Audio Studio runs the entire chain on your machine: an ASR model like Qwen turns audio into a timestamped transcript, then you export SRT, ASS or Markdown captions.

Transcription is only the start. The same local speech pipeline can also build reusable voice characters and read new text with local models like CosyVoice — ideal for re-recording narration, multilingual dubbing and fast copy iteration. Media, captions and voice characters never leave your device.

## How to auto-caption a video: local transcription with timestamped captions in one step

Drag a talking-head, interview or course audio/video into Audio Studio and a local ASR model like Qwen turns it into timestamped captions and an editable transcript automatically — nothing is uploaded to any cloud service. The caption timeline matches the transcript one-to-one, so editing copy, proofreading and deleting lines all happen locally.

For high-frequency video-to-caption creators: import once, get captions and a transcript in one go, and load them into CapCut or another editing flow to finish a video.

## Local speech transcription: audio and video become an editable transcript on your device

Audio Studio makes local speech transcription an everyday chore: basic transcription only needs 16 GB RAM, and pure CPU or Apple silicon Macs run it too, just slower; an NVIDIA CUDA GPU with 8 GB+ VRAM speeds it up noticeably.

The transcript it produces can be edited and quoted directly, and exported as Markdown for scripting, notes or course handouts — no second pass needed.

## Choosing local AI dubbing software: characters, media and models all on your machine

Most AI dubbing software uploads both text and timbre to the vendor's servers. Audio Studio is the opposite: build reusable characters from licensed voices and synthesize dubbing with local models like CosyVoice — voice characters and media never leave the device. It works offline, suiting privacy-sensitive or confidential courses, interviews and narration projects.

Use 32 GB+ RAM for stable voice-character creation and dubbing, and reserve about 15 GB of disk.

## Talking-head, interviews, courses, narration: different videos, one local flow

Talking-head: add captions first, then AI dubbing. Interviews: transcribe to a transcript so you can pull out quotable lines. Courses: captions plus an editable transcript as handouts. Narration: batch-synthesize voice-over with a licensed voice character.

One standalone App covers all four scenarios — transcribing, reviewing, dubbing and exporting happen in the same local flow without breaking your rhythm.

## Export SRT/ASS/Markdown and plug into your usual editing pipeline

Caption output exports in standard SRT/ASS formats, loadable straight into CapCut, Premiere and other editors as layered tracks; transcripts export as Markdown for easy content reuse.

For a more efficient finishing pipeline, combine with the AI Short Films App to trim pauses and filler from talking-head media, chaining "transcribe — review — dub — edit" into one complete local flow.

## What Audio Studio can do for you

- Transcribe audio/video locally into timestamped captions and an editable transcript
- Build reusable characters from licensed voices; CosyVoice synthesizes dubbing locally
- Export SRT/ASS/Markdown and plug into CapCut, Premiere and other editing flows
- Media and voice characters never leave the device; works offline
- Transcribe on 16 GB RAM; runs on Apple silicon Macs too
- Source code is public and auditable, with transparent capabilities and boundaries`,
  },
  "recut.cover-studio": {
    name: "Cover Studio",
    tagline: "The last stop of video creation: make the cover worthy of the edit with real references, not guessed prompts",
    description: "An AI video cover generator: batch-produce cover candidates in Bilibili/Douyin/YouTube sizes, upload a reference cover to keep a series visually consistent; covers accumulate in the media library for reuse across projects, living in the same local workspace as your video and caption assets. Start batch-making covers today.",
    keywords: [
      "AI video thumbnail generator",
      "video thumbnail generator",
      "AI video covers",
      "video cover maker",
      "batch thumbnail generation",
      "Bilibili cover size",
      "Douyin cover size",
      "YouTube thumbnail size",
      "video thumbnail maker",
    ],
    faq: [
      {
        question: "What's the Bilibili cover size, and how do I avoid cropping?",
        answer: "Bilibili recommends a 16:9 landscape cover, commonly 1280×720 or higher — too-small widths get compressed and blurry. In Cover Studio, pick the channel and it generates to the matching landscape/portrait spec; keep important information in the center to avoid it being cut off at small sizes.",
      },
      {
        question: "What YouTube thumbnail size should I use?",
        answer: "YouTube thumbnails are typically 16:9, recommended at 1280×720 and no smaller than 640×360. Cover Studio covers YouTube and other international channel sizes — pick the channel and it generates to spec; set a reference cover too, and your channel's series style stays consistent.",
      },
      {
        question: "Where are AI-generated covers stored? Can I reuse them across projects?",
        answer: "Successful covers archive into the Recut media library automatically and can be reused across projects; the Cover Studio App itself only keeps traceable metadata (channel, size, prompt, reference source) and never copies media files. When your next video needs the same batch of covers, pull them straight from the library — no regeneration needed.",
      },
      {
        question: "How do I keep an entire series of covers consistent?",
        answer: "Set last episode's best cover as the reference cover, and add a reference image to lock the subject — AI generation aligns composition, whitespace and visual tone toward both. Every generation records its reference source, so to recreate a certain episode's style you can just check the history and reproduce the same configuration.",
      },
      {
        question: "Do you support vertical covers for Douyin and WeChat Channels?",
        answer: "Yes. Cover Studio treats vertical channels like Douyin and WeChat Channels as separate specs from landscape ones like Bilibili and YouTube. Douyin vertical video covers commonly use 9:16 (1080×1920); pick the channel and results are generated to the matching aspect ratio.",
      },
    ],
    body: `A thumbnail decides the click. Every channel demands different sizes, composition and text treatment, so making covers by hand for each video is both slow and hard to keep consistent.

The "Cover Studio" App drives generation with channel sizes, a reference cover and your creative requirements: batch-produce cover candidates, archive the chosen ones into the media library, and reuse them in later creations. Covers and video media are managed in the same workspace — no shuttling between tools.

## A video cover generator: batch cover candidates from one workspace

Running on Bilibili, Douyin, YouTube or Xigua means a cover every episode; hand-making each one is slow and size-prone. Cover Studio folds channel sizes, reference images and creative requirements into one selection flow: pick the channel and get its landscape/portrait spec, add a reference image to constrain the subject and a reference cover to align composition and visual tone, and batch-produce candidates in one go.

## AI video covers: reference covers keep a series consistent

Serial creators dread "a different style every episode". Set last episode's best cover as the reference and AI generation aligns its composition, whitespace and visual tone; add a reference image to fix the subject, product or person.

That way AI video covers answer not just "is there a cover" but "does it look like my channel" — series cohesion accumulates automatically instead of relying on memory.

## Video cover making: channel sizes, assets and history in one place

The most tedious part of video cover making is size conversion and asset aggregation. Cover Studio puts channel sizes, reference covers and creative requirements into the same flow, saves results uniformly in the media library, and keeps covers alongside your video and caption assets in one local workspace.

Every successful generation writes traceable history — channel, size, full prompt and reference source — so finding, reusing and reviewing are all easy.

## Batch cover generation: one reference, covers for every platform at once

One video often ships to Bilibili, Xigua and YouTube, plus a vertical version for Douyin. Landscape 16:9 and vertical 9:16 are different specs, and hand-making per platform is error-prone.

Batch cover generation treats landscape and vertical as separate specs and uses the same reference and requirements to produce channel-specific candidates in parallel — multi-platform distribution no longer means overtime on covers.

## Bilibili, Douyin and YouTube cover sizes, explained once

Creators who search "Bilibili cover size", "Douyin cover size" and "YouTube cover size" want one thing: "stop cropping my cover". Common references: Bilibili covers recommended at 16:9, 1280×720 and up; YouTube thumbnails also 16:9, recommended 1280×720; Douyin vertical video covers commonly 9:16 (1080×1920).

Cover Studio has built-in per-channel size selection with landscape and portrait kept separate, so generation always matches the spec — just keep important information in the center of the frame.

## What Cover Studio can do for you

- Batch-generate cover candidates in channel sizes, with landscape and portrait as separate specs
- Upload a reference cover to align composition and whitespace — consistent series visuals
- Reference images constrain the subject so the picture never drifts
- Results archive into the media library automatically, ready for reuse across projects
- Same workspace as video and caption assets — asset management without switching tools
- Every generation leaves a traceable record; prompts and sizes are reviewable anytime`,
  },
  "recut.depth-anything": {
    name: "Depth Map",
    tagline: "Create a cleaner depth reference for images and video, so the next generation understands subject, space and layers",
    description: "A depth map generator: based on Depth Anything, convert images or video into previewable depth maps on your machine, with Small/Base/Large models and false-color or grayscale output. Results can be previewed and saved to the media library on demand. Everything runs locally with no uploads, and no Python or FFmpeg setup required — just open and use it.",
    keywords: [
      "depth map generator",
      "image to depth map",
      "AI depth estimation",
      "Depth Anything",
      "video depth map",
      "depth map compositing",
      "3D depth map",
      "depth map tool",
    ],
    faq: [
      {
        question: "What is a depth map and what is it actually for?",
        answer: "A depth map records scene depth through brightness — the brighter a pixel, the closer it is to the camera. It isn't a finished product but an intermediate artifact for compositing and 3D work: once AI depth estimation generates a depth map, you can build depth-of-field, parallax motion, stereoscopic transitions and 3D scene construction.",
      },
      {
        question: "Does generating a depth map need a network connection or media upload?",
        answer: "No uploads. Depth Map generation is fully local — your images and video never reach a server. The official model weights download once over the internet at first use; after that generation works offline, suiting confidential creation and development projects.",
      },
      {
        question: "Can video also become a depth map?",
        answer: "Yes. Pick a video from the media library and the App infers frame by frame, outputting a previewable H.264 MP4 depth map. The steadier the footage and the larger the model, the more consistent the per-frame results; progress and errors display live and you can cancel anytime.",
      },
      {
        question: "What format are the depth maps, and where can I save them?",
        answer: "Images export as PNG and video as MP4. Results first preview in the App's private file area; they only become real Assets in the media library when you click “Save to Library”, ready for later use and continued compositing.",
      },
      {
        question: "What's the difference between the Small, Base and Large models?",
        answer: "Small infers fastest, good for quick previews; Base is the balanced default; Large has richer detail and is steadier on frame-by-frame video. Licensing differs: Small is Apache-2.0 while Base and Large are CC-BY-NC-4.0 — confirm your use case matches before commercial use.",
      },
    ],
    requirements: {
      title: "Check your device before you run",
      items: [
        "Runs fully on your machine; a standard consumer device is enough for Small/Base models.",
        "First use downloads the official model weights over the internet; after that generation works offline.",
        "Base and Large are CC-BY-NC-4.0 licenses — confirm your use case matches before commercial use.",
      ],
      note: "Models run locally. Installing the App doesn't upload any of your media.",
    },
    body: `A depth map describes how far objects are from the camera — a common intermediate artifact for stereoscopic design, compositing and media research. Handing it to a cloud tool means uploading raw images or video and accepting quota and privacy limits.

The "Depth Map" App does the conversion on your machine: images or video become previewable depth maps, saved to the media library on demand and seamlessly continued into your next creative step.

## What a depth map is: how AI depth estimation layers a picture

A depth map is an intermediate artifact recording a scene's depth — brighter pixels are closer, darker ones farther (with an extra color scale in false-color mode). It comes from monocular depth estimation: AI infers the relative distance of every pixel from a single ordinary RGB image, which is exactly what Depth Anything models excel at.

For creators, a depth map isn't the finished piece — it's the "pass" to depth-of-field compositing, 3D parallax and stereoscopic transitions, and understanding it makes later compositing work evidence-based.

## Turning images into depth maps: three models, previewable results

Select an image in the media library and go: switch freely among Small, Base and Large — Small is fastest for quick looks, Base is the balanced default, Large has the finest detail. Both false-color and grayscale output styles are supported; preview first, then save when you're happy.

No Python or command line to configure — the runtime prepares itself on first open, with no environment variables to fiddle with.

## Video depth maps: frame-by-frame inference to a playable MP4

Pick a video and it infers frame by frame, with every frame carrying its depth information, output as a browser-playable H.264 MP4. For footage with heavy motion or long duration, use Large for steadier per-frame results.

Progress and errors display live, and you can cancel at any time instead of waiting around.

## Depth maps in compositing and 3D scenes: the step from flat to dimensional

In After Effects, depth maps are commonly used for depth of field, parallax movement and stereoscopic transitions; in Blender, a video depth map can turn ordinary footage into a 3D scene. For 3D scene builders, depth maps are a low-cost way to give backdrops, textures or virtual cameras spatial information.

Saved depth maps live in the media library, ready to connect directly into your next compositing step.

## A local depth map tool: no uploads, everything processed on your device

Inference runs entirely on your machine — the input images, video and generated depth maps never upload to a server, suiting confidential creation and development flows. Output first previews in the App's private file area and only formally archives when you click "Save to Library".

Official model weights and the runtime are managed in one place, with clear versions and easy reuse.

## What Depth Map can do for you

- Select an image or video and generate a previewable depth map in one click
- Switch freely between Small, Base and Large models
- Choose false-color or grayscale output as needed
- Preview results first, then save to the media library after confirming
- Fully local processing — media and depth maps never upload to the cloud
- Runtime prepares itself automatically; open and use it`,
  },
  "recut.remotion-studio": {
    name: "Remotion Video",
    tagline: "Do not start from zero: build code-driven video with built-in templates, components, effects, fonts and music",
    description: "Make Remotion videos without building the framework from scratch: Recut builds on Remotion and React to arrange topics, copy and media into programmatic videos you can preview live and export as MP4. Change the data and re-render, batch videos and data visualizations, with media and projects fully local.",
    keywords: [
      "Remotion video production",
      "make video with code",
      "programmatic video",
      "React video production",
      "data visualization video",
      "batch video template generation",
      "Remotion for beginners",
      "automated video generation",
    ],
    faq: [
      {
        question: "What is Remotion? How do you make video with code?",
        answer: "Remotion is an open-source framework that writes video with React: components describe every frame, which are rendered frame-by-frame into an MP4. Recut wraps it into a project-based workflow — you pick a template, fill in the topic and media, and AI rewrites the Remotion composition code in the project; changing code updates the preview, rendering happens locally, and you never scaffold the framework from scratch.",
      },
      {
        question: "Can I use it without knowing how to code?",
        answer: "You'll want to know a little code. AI drives the video from your topic, copy and media; but when you want to precisely change a single frame, the project is a real Remotion project — open the folder and edit the code. That's its core value.",
      },
      {
        question: "If the data changes, does the video need to be regenerated?",
        answer: "It needs a re-render, but the cycle is short: after changing data, copy or media, the preview refreshes instantly, and you export once confirmed. Compositions and caption timelines are all derived from frame numbers with no randomness, so preview and export match frame for frame — no “preview right, export wrong”.",
      },
      {
        question: "What format do exported videos use?",
        answer: "Export renders locally to MP4 and archives automatically as a Recut asset, set as the project cover. The export process runs as a background task whose progress you can watch in the workspace.",
      },
      {
        question: "Is every project really an independent Remotion project?",
        answer: "Yes. On first use the remotion-skeleton is copied entirely into a project-private workspace, and AI rewrites that copy — projects never interfere with each other; you can reset to the skeleton in one click or open the project folder in a file manager, convenient for rollback or further development.",
      },
    ],
    body: `When video needs repeat production, must follow data changes, or has to keep dozens of outputs perfectly consistent, hand-editing hits its ceiling. Remotion makes video code-driven: every frame comes from deterministic components and data, so it can be version-controlled, parameterized and batch-exported.

Recut's "Remotion Video" App brings the power of a Remotion project into the local workspace: plan the topic, copy and storyboard first, then arrange media and picture with live preview, and export the finished video at the end. The project is a real Remotion project — open the code anytime for deeper changes.

## What programmatic video is, and why use it

Programmatic video defines every frame in code: the picture is driven by data, copy and media rather than hand-dragging second by second. It naturally suits content teams who know a bit of React, data-visualization producers who ship on schedule, and individuals or teams that want templated, batched video.

The classic pain of traditional editing — redo everything when the data changes — becomes two simple steps here: "change the parameters, re-render".

## Making video with code vs. traditional editing software

When you make video with code, the timeline steps back and logic steps forward. Every project in Recut is a real Remotion project: AI reads and writes the composition code in the workspace, and changes show up in the preview immediately. To precisely change any frame, you don't hunt for keyframe buttons — change one line of code.

## A React video production workflow: from topic and copy to a finishing template

React video production doesn't start from an empty project. When creating a project you pick a finishing template first, then fill in the topic and media; after the first cut, media and caption themes are just local editing tools, with picture and narrative constrained by the template.

For content that needs fixed templates and rolling updates, this workflow compresses repetitive labor to a minimum.

## Data-visualization video: change the data, re-render

The most common pain in data-visualization video is the whole video being redone when data changes. Recut's compositions and caption timelines are all derived from frames with no random numbers involved, so preview and export match frame for frame; when data, copy or media changes, update and re-export to a new video.

Suited to weekly reports, leaderboards and market reviews that need fixed templates and rolling updates.

## Batch template video: one project, videos on repeat

The key to batch template video is "the template as single source of truth". In Recut, templates and visual primitives are managed uniformly and projects never interfere; swap in a new topic and media into the same template and it's a new video.

Export renders locally to MP4, archives automatically as an asset and sets the project cover — dozens of videos can queue up, with no cloud quota involved.

## What Remotion Video can do for you

- Pick a finishing template, fill in the topic, and AI arranges copy and media into a video
- Change data or copy and the preview updates; export matches frame for frame
- Open the project folder and edit real Remotion code for frame-exact control
- Render and export MP4 locally, archived automatically as an asset and cover
- Media and project stay on your machine — local-first, no uploads`,
  },
  "recut.ai-short-film": {
    name: "AI Short Films",
    tagline: "Hand a topic to AI and get a reviewable, further-editable B-roll narration short film",
    description: "An AI narration video tool: input a topic and it automatically structures the narrative and storyboard, producing a reviewable narration script with matching B-roll; picture, voice-over and pacing are arranged on a local timeline, the finished video exports, the project keeps going, and no media uploads. Built for knowledge and opinion creators and narration channels — go from topic to finished video in one flow, free to try.",
    keywords: [
      "AI narration video tool",
      "AI short film generator",
      "AI one-click narration video",
      "B-roll video production",
      "educational video tool",
      "knowledge video tool",
      "narration video script",
      "AI video storyboard",
      "local video editing tool",
    ],
    faq: [
      {
        question: "Can the narration script from an AI video tool be published directly?",
        answer: "Not as a finished product. AI Short Films generates a reviewable narration draft — check facts line by line and adjust wording before finalizing; the finalized script aligns with matching B-roll on the local timeline, and once confirmed you can export the finished video.",
      },
      {
        question: "What is B-roll in a narration video, and is it required?",
        answer: "B-roll is the supporting footage between the main talking-head shots that makes a narration video more watchable. AI Short Films automatically generates matching visuals from the voice-over to avoid a single shot lingering too long; you can also replace media manually on the timeline — you don't have to use the generated visuals throughout.",
      },
      {
        question: "I closed the machine mid-edit. Can I keep making the project?",
        answer: "Yes. AI Short Films is a project-based App: each topic maps to a project file, the finished video can be exported, and the project is saved on your local device — open it anytime and keep working without regenerating from scratch.",
      },
      {
        question: "Will my media and projects be uploaded to a server?",
        answer: "No. AI Short Films is local-first: B-roll media, narration scripts and project files all stay on your device, never passing through a cloud server, and you can open and keep working offline.",
      },
      {
        question: "I can't write narration scripts. Can I use this for knowledge videos?",
        answer: "Yes. The tool first structures the narrative and storyboard for your topic automatically, then generates a matching narration draft — essentially a structured script for you to review, rewrite and finalize. Built for knowledge and opinion creators and narration channels, so even without scriptwriting experience you can start from a topic.",
      },
    ],
    body: `Narration videos (B-roll shorts) are the main format for knowledge and opinion content: one main voice-over line with picture, charts and pacing. Traditionally, going from topic to finished video means scriptwriting, sourcing footage, dubbing and editing — four steps, each in a different tool.

The "AI Short Films" App folds all four steps into one local workspace: you give it a topic, and it structures the narrative and storyboard first, then generates a reviewable narration script and matching visuals. You don't have to accept every result at once — each step stays editable and continuable, and media and projects always remain on your device.

## From topic to finished video: how an AI short film generator structures narrative

In AI Short Films you don't start from a blank timeline. Give a topic — "why people procrastinate", say — and AI structures the narrative: hook with the question up front, explain the mechanism in the middle, conclude at the end, then breaks it into storyboard lines, each with a narration script draft and matching visual direction.

Knowledge content fails when the structure falls apart, so the value of this kind of knowledge-video tool is front-loading structure — a topic grows directly into a short film you can keep making.

## B-roll video production: picture, voice-over and pacing on one timeline

The most common way narration videos fall apart is voice-over talking about one thing while the picture shows another. AI Short Films arranges B-roll, narration and pacing on the same local timeline: change a line of voice-over and the matching picture can re-align; drag in a clip and immediately preview which narration line it lands on.

Mainstream editors rely on hand-dragging a media library to fill B-roll; here the AI matches visuals to the script automatically, and you decide which to keep or swap. Shot length and pacing are visible and adjustable at a glance.

## How an educational video tool keeps content reviewable

Knowledge and opinion creators fear an AI that confidently makes things up. AI Short Films doesn't make the final call for you: it generates a reviewable narration script and matching visuals, and you verify facts and rewrite wording line by line before finalizing. Script review and visual matching are separated phases, so errors are caught before they reach the timeline.

Compared with "AI one-click narration video" tools that are purely automatic, this kind of educational-video tool values human review before output — especially for topics that demand factual rigor.

## Storyboards you can redo; a project-based App that keeps going

With traditional tools, an unfinished cut or a changed opinion after the first export often means starting over. AI Short Films saves every topic as a project: the finished video exports, the project stays local, and you can open it anytime and keep working — swap a storyboard line, change one line of narration, add a shot, all on the original project without regenerating the whole video.

For serial, multi-episode and review-style topics, reusable AI video storyboards make series production much more continuous.

## A local video editing tool: media and projects stay on your device

Mainstream online tools tend to require cloud uploads, so projects accumulate and privacy concerns grow. AI Short Films chooses local-first: B-roll media, narration scripts and project files all stay on your device, and you can open and keep working offline.

For creators whose media is confidential or who prefer projects on their own hard drive, this kind of local video editing tool means the whole flow is yours — independent of a vendor's bandwidth and server status.

## What AI Short Films can do for you

- Give it a topic and it generates narrative structure and a storyboard script automatically
- Produces a reviewable narration script — verify before finalizing
- Matches B-roll visuals to the script automatically, aligned on the same timeline as the voice-over
- Finished video exports; the project stays local and can be reopened anytime
- Local-first for media and projects — nothing uploads to the cloud
- Covers knowledge, opinion and educational narration topics`,
  },
};

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function toFaq(value: unknown): MarketingAppFaq[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const entry = (item ?? {}) as Record<string, unknown>;
      return { question: String(entry.question ?? ""), answer: String(entry.answer ?? "") };
    })
    .filter((item) => item.question && item.answer);
}

function contentDir() {
  return path.join(process.cwd(), "content", "apps", "zh");
}

function readApp(file: string, idFromFile: string): MarketingApp {
  const raw = fs.readFileSync(file, "utf8");
  const { data, content } = matter(raw);
  const frontmatter = data as AppFrontmatter;
  const id = frontmatter.id ?? idFromFile;
  const en = EN_APPS[id];
  const zhName = String(frontmatter.name ?? "");
  const zhTagline = String(frontmatter.tagline ?? "");
  const zhDescription = String(frontmatter.description ?? "");
  const zhKeywords = toStringList(frontmatter.keywords);
  const zhFaq = toFaq(frontmatter.faq);
  const zhRequirements = frontmatter.requirements
    ? {
        title: String(frontmatter.requirements.title ?? ""),
        items: toStringList(frontmatter.requirements.items),
        note: frontmatter.requirements.note ? String(frontmatter.requirements.note) : undefined,
      }
    : undefined;
  return {
    id,
    type: frontmatter.type === "standalone" ? "standalone" : "project",
    name: { zh: zhName, en: en?.name ?? zhName },
    tagline: { zh: zhTagline, en: en?.tagline ?? zhTagline },
    description: { zh: zhDescription, en: en?.description ?? zhDescription },
    keywords: { zh: zhKeywords, en: en?.keywords ?? zhKeywords },
    faq: { zh: zhFaq, en: en?.faq ?? zhFaq },
    relatedApps: toStringList(frontmatter.relatedApps),
    requirements: zhRequirements
      ? {
          zh: zhRequirements,
          en: en?.requirements ?? zhRequirements,
        }
      : undefined,
    repository: frontmatter.repository ? String(frontmatter.repository) : undefined,
    body: { zh: content.trim(), en: en?.body ?? content.trim() },
  };
}

export function loadMarketingApps(): MarketingApp[] {
  const dir = contentDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => readApp(path.join(dir, file), path.basename(file, ".mdx")))
    .sort((a, b) => a.name.zh.localeCompare(b.name.zh));
}

export const marketingApps: MarketingApp[] = loadMarketingApps();

export function getMarketingApp(appID: string): MarketingApp | null {
  return marketingApps.find((app) => app.id === appID) ?? null;
}

// 取某语言下可用的展示字段（缺该语言时回退 default en）。
export function appName(app: MarketingApp, locale: Locale): string {
  return app.name[locale] ?? app.name.en;
}
export function appTagline(app: MarketingApp, locale: Locale): string {
  return app.tagline[locale] ?? app.tagline.en;
}
export function appDescription(app: MarketingApp, locale: Locale): string {
  return app.description[locale] ?? app.description.en;
}
export function appFaq(app: MarketingApp, locale: Locale): MarketingAppFaq[] {
  return app.faq[locale] ?? app.faq.en;
}
export function appBody(app: MarketingApp, locale: Locale): string {
  return app.body[locale] ?? app.body.en;
}
export function appRequirements(app: MarketingApp, locale: Locale): { title: string; items: string[]; note?: string } | undefined {
  return app.requirements?.[locale] ?? app.requirements?.en;
}
