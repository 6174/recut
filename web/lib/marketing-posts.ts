/*
 * [INPUT]: 依赖 node:fs / node:path 与 gray-matter，读取 content/marketing/zh/*.mdx；英文正文在本文件内联提供（content 目录由内容任务另行演化，本文件不修改 content/**）
 * [OUTPUT]: 对外提供官网 Blog 的静态文章目录：MarketingPost 为 { slug; date; content/title/description: Record<Locale, string> }，中文来自 MDX、英文来自内联翻译；按日期降序；供元数据、sitemap、JSON-LD 与页面渲染共用
 * [POS]: web/lib 的公开内容加载器；只在服务端模块（页面、sitemap、JSON-LD）导入，客户端组件一律通过 props 接收数据；en 为 default 面必须恒有内容，某语言缺失时由 [locale]/blog/[slug] 对该语言路由 notFound()
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { type Locale } from "@/lib/i18n/locales";

export type MarketingPost = {
  slug: string;
  date: string;
  content: Record<Locale, string>;
  title: Record<Locale, string>;
  description: Record<Locale, string>;
};

type EnPost = { title: string; description: string; content: string };

// 英文正文（内联）：与 zh 目录同 slug 对应；en 是 default 无前缀面，必须恒有内容。
// 新增文章时需同时补齐这里；缺该语言内容的文章由 [locale]/blog/[slug] 对该语言路由 notFound()。
const EN_POSTS: Record<string, EnPost> = {
  "a-workspace-for-ai-video": {
    title: "A workspace built for AI video",
    description: "Put video editing, worlds and voice workflows into one extensible creative environment.",
    content: `Today, creators rarely ask "can it be generated" — the question is "where does what's generated live". Image-to-image, text-to-video, voice synthesis, talking-head editing... each is excellent on its own, but they sit scattered across different web apps and accounts with no shared context.

Across the lifecycle of a work, you manage media, organize narrative, keep characters and worlds coherent, polish the voice, and only then export the finished video. If every step happens in an isolated tool, your creation becomes a job of shuttling files between windows rather than one continuous thought.

## The workspace: keeping your context

Recut wants creation to happen in a persistent environment. It brings video editing, Worlds, licensed voices and generative creation into a single workspace, so every step shares the same projects, media and intent.

- **Editing** puts clips, pacing and narrative into an editable timeline, so every change can continue.

- **Worlds** keeps characters, scenes and rules coherent across creations, instead of describing them from scratch every time.

- **Voice creation** builds reusable expressions for licensed voices, making them part of the work.

- **Generation** runs against a local service as its execution and data boundary, putting model choice back in your hands.

## From "one generation" to "a body of work"

A single generation gives you one result; a body of work is those results plus every decision and bit of context around them. The point of a workspace is that your creative process itself becomes an asset you accumulate. A character defined today carries into the next creation; a shot you didn't use this time may be exactly what you need next.

## Extensible: the workspace is not a walled garden

No single team can anticipate every way of creating. So Recut's core workspace only provides unified capabilities, and the concrete editing, generation, world-management and voice workflows come in through Apps. You can install existing Apps or write your own, connecting new models, tools and processes into the same space.

That leads to a key result: **tools grow to fit your way of working, not the other way around.** When your needs outgrow the defaults, you don't wait on our roadmap or start over in a different tool.

## Who it's for

If you're doing AI video creation that needs ongoing context — a series of talking-head videos, a short film that needs consistent characters, or a long-running content channel — Recut gives you somewhere to accumulate it. Install the local service, open the workspace, and start with your first video.`,
  },
  "ai-video-post-production-workflow": {
    title: "How to Edit AI Generated Videos: A Complete 2026 Workflow",
    description: "How to edit AI generated videos: sort raw clips, trim redundancy, add captions, AI voiceover, B-roll, export. The practical AI video editing workflow for 2026.",
    content: `One sentence you will hear a lot in 2026: "the video is already generated." It sounds like the hard part is done. It is not. A text-to-video model hands you a pile of short clips — five seconds here, ten seconds there, occasionally a full minute. No captions. No voiceover. No pacing. No cover. If you publish those clips as-is, they will look like AI video, and "how to edit AI generated videos" will stay the question you keep typing into Google.

This guide is a complete AI video post-production workflow. It covers what 2026 models actually produce, the eight editing steps that turn clips into a watchable piece, a checklist you can reuse on every project, the mistakes most creators make, and how to choose AI video editing tools — including local-first options that never upload your footage.

## What 2026 models actually give you

Before you open an editor, know your raw material. These facts are verified as of August 2026:

- **Sora (OpenAI) is gone.** The app shut down on April 26, 2026, and the API is scheduled to be discontinued on September 24, 2026 (verified). There is no new Sora to generate with, so "edit Sora clips" now means working with footage you already downloaded before the shutdown.
- **Kling 3.0 (Kuaishou)** shipped on February 7, 2026 (verified). Kling returns short clips and handles Chinese prompts especially well. If you search "edit Kling videos," you are really asking how to stitch a dozen short shots into one coherent piece (per-tier clip durations not verified).
- **Seedance 2.5 (ByteDance)** released July 31, 2026 (verified): 30-second native clips, up to 50 multimodal references, and in-scene local editing — you can fix a single detail like hair color without regenerating the whole take. A beta long-video mode extends clips toward three minutes.
- **Veo 3 / 3.1 (Google DeepMind)** is the rare model that generates synchronized audio — dialogue, sound effects and ambient noise — alongside the video (verified). Per-clip output caps around eight seconds in Gemini, with Google Flow handling long-form continuity.
- **Jimeng (ByteDance, CapCut's AI platform)** supports text-to-video, image-to-video and first/last-frame control, with strong Chinese prompt understanding; Seedance 2.0 had its exclusive launch there (verified via the official site).
- **Runway** offers Gen-4.5, Aleph 2.0, Act-Two and Edit Studio (product line verified; exact per-clip duration and resolution not verified).

See the pattern? Every one of these tools returns **clips**, not a finished video. The skill that actually makes "how to make AI video look professional" solvable is the workflow below.

## The complete AI video editing workflow

### Step 1. Organize your raw material

Why it matters: generating is cheap, judging is expensive. A serious session produces dozens of clips, and editing turns into archaeology if nothing is labeled. How: rename clips by scene, bucket them into keep / backup / trash, and record each clip's prompt, parameters and resolution before you forget. Ten minutes of sorting saves hours of hunting later.

### Step 2. Select shots and assemble

Why it matters: AI clips have a high defect rate — an extra finger, a shadow pointing the wrong way, a morphing background. The cut is where you filter those out. How: keep only shots that survive a pixel-peeping pass; assemble in script order, not generation order; join shots with similar motion, lighting and framing to avoid jarring jump cuts.

### Step 3. Cut redundancy and fix pacing

Why it matters: generated takes are almost always too long at the start and the end, and completion rate in short video lives and dies by pacing. How: trim the first and last 0.2–0.5 seconds of every take; leave a beat of about 0.3 seconds between sentences; use fast cuts to compress and slow shots to underline emotion.

### Step 4. Transcribe and add captions

Why it matters: most people watch with the sound off, and generated narration often misreads words. Captions are not decoration — they are accessibility and retention. How: transcribe the dialogue or narration into a timestamped transcript and SRT, fix errors and line breaks by hand, then burn the subtitles into the video.

### Step 5. Voiceover and narration

Why it matters: most generated clips come out silent, and a voiceover is what carries a 60-second explainer. How: write the script first, synthesize with local TTS or a cloned voice, listen for rhythm, then align every sentence to its frame.

### Step 6. Add B-roll

Why it matters: one shot cannot carry a minute of video. B-roll explains concepts, bridges transitions and gives the eye something new. How: pull matching cutaways, diagrams or reference visuals from your media library and interleave them so the narration is always backed by visual evidence.

### Step 7. Design a cover

Why it matters: the thumbnail decides the click. A raw AI frame is usually low-density and uninviting. How: generate covers per channel aspect ratio (9:16 vertical, 16:9 horizontal, 3:4 for feeds), with one clear subject and a large readable title.

### Step 8. Export correctly

Why it matters: a wrong resolution or aspect ratio invalidates everything before it. How: use per-channel presets (1080p minimum, H.264, matching aspect ratio); do one full watch-through checking for black frames, misaligned captions and audio drift.

## The checklist: from raw footage to final export

- [ ] Clips renamed and bucketed (keep / backup / trash)
- [ ] Prompt, parameters and resolution recorded per clip
- [ ] Only defect-free shots kept
- [ ] Assembled in script order, not generation order
- [ ] Head and tail trims done; pacing reviewed
- [ ] Transcript and SRT generated and corrected by hand
- [ ] Voiceover / narration aligned sentence-by-sentence
- [ ] B-roll inserted over weak passages
- [ ] Cover generated at channel size
- [ ] Full watch-through before export

## Common mistakes (and how to fix them)

1. **Publishing raw clips.** The fastest way to look like AI slop. Fix: run all eight steps.
2. **Skipping the library step.** You hunt for your best shot in the last hour. Fix: sort before you cut.
3. **Trusting machine transcripts.** ASR output has errors and wrong line breaks. Fix: proofread every subtitle.
4. **Mixing audio levels carelessly.** Music drowns the voice. Fix: keep voice roughly 6–12 dB above music.
5. **One export for every platform.** The framing is wrong somewhere. Fix: render per-channel versions.

## Choosing your AI video editing tools

Generation happens in the cloud; editing belongs on a machine you control. Big NLEs — Premiere, DaVinci Resolve, CapCut — all work. But if your AI video post-production is local-first, look at Recut (recut.video): a desktop workbench where a timeline editor handles assembly, trimming and export; a sound workshop transcribes and subtitles locally with Qwen3-ASR or Whisper and synthesizes voiceover with CosyVoice / CosyVoice2 (including cloned voice roles); a cover studio generates channel-sized thumbnails; and an AI short film app turns a topic into a Vox-style B-roll explainer with research, script and storyboard tracked in one project. Footage stays on your disk — nothing is uploaded, and it works offline. Whatever you pick, hold the tool to three tests: do your assets stay local, are transcription and voiceover accurate, and does export give you enough control?

## Conclusion

"How to edit AI generated videos" has a real answer, and it is a pipeline, not a trick: organize, select, pace, subtitle, voice, B-roll, cover, export. Run these eight steps as a checklist on every project and the AI look fades while your completion rate climbs. Let the model generate the footage — then do the professional work yourself.`,
  },
  "ai-video-model-comparison-2026": {
    title: "Seedance vs Kling vs Veo: Best AI Video Generator 2026",
    description: "Seedance 2.5 vs Kling 3.0 vs Veo 3.1 vs Runway Gen-4.5: duration, resolution, native audio, editing, price, access, with a repeatable test method.",
    content: `> Last updated: 2026-08-16. Every figure below is labeled "Verified" (official pages, official blogs, Wikipedia, or major press) or "Unverified" (third-party claims we could not confirm). We re-run this comparison quarterly using the fixed methodology at the end — only the numbers change, the framework stays.

## The state of play in August 2026: Sora's exit reshapes the field

The most consequential event of the past year was OpenAI discontinuing Sora. OpenAI announced the shutdown on March 24, 2026; the mobile app closed on April 26, 2026, and the API is set to shut down on September 24, 2026 (Verified). Press reporting ties the decision to compute constraints, an estimated operating cost of roughly $1 million per day, and a strategic pivot toward enterprise products (Verified). Sora 2's user base peaked at about a million and fell below 500,000 (Verified). In other words, the model that once defined the category walked off the field on its own.

Who filled the gap? Wikipedia, citing the Artificial Analysis leaderboard, notes that Seedance 2.0, Runway 4.5 (Gen-4.5), and Kling 3.0 all ranked above Sora 2.0 (Verified).

The first-half 2026 lineup (all Verified):

- **ByteDance's Seedance 2.5** launched July 31, 2026 — 30-second native generation, 50+ multimodal references, local editing, and a 3-minute long-form beta.
- **Kuaishou's Kling 3.0** launched February 7, 2026 — native 4K output across its Video 3.0 and Video 3.0 Omni models, with synced audio.
- **Google's Veo 3.1** shipped October 15, 2025 with native synchronized sound; at I/O 2026 Google upgraded Flow and introduced Flow Music, and Gemini Omni has been announced as the replacement for Veo inside the Gemini app.
- **Runway** keeps selling a product line anchored by Gen-4.5, aimed at professional filmmaking.

The through-lines: native audio went from a differentiator to a default; single-clip duration raced from five seconds to thirty; and reference control plus local editing is now the real battleground.

## The comparison framework (repeatable)

> **Fixed test methodology — re-test quarterly, change only the numbers**
> 1. Prompt set: five fixed prompts — one realistic character in continuous motion, one object/physics test, one multi-shot cinematic sequence, one product ad, one stylized animation.
> 2. Controls: same account tier, same prompt text, same reference image; generate each prompt at least three times per model and take the median.
> 3. Scoring: prompt adherence, motion smoothness, cross-frame consistency, audio-visual sync, and overall aesthetics — 1–10 each.
> 4. Record: test date, model version, official release date of the latest version, and the tool version used (Web/App/API).
> 5. Labeling: "Verified" = official page, official blog, Wikipedia, or major press; "Unverified" = third-party or unconfirmed.
> 6. Publish: refresh this page's figures and the version table each quarter; keep the structure and conclusions standing.

### Seedance 2.5 (ByteDance) — the single-clip duration king

- Release: July 31, 2026 (Verified)
- Single-clip length: native 30 seconds, extendable twice (Verified)
- Long-form: 3-minute long-video beta (Verified)
- Multimodal reference: 50+ reference inputs (Verified)
- Local editing: region-level fixes, white-model control, green-screen editing (Verified)
- Audio: audio-video joint generation with native sound (Verified)
- Resolution / price / availability: Unverified — confirm on official channels
- In one line: when you want one take that tells a story, this is the longest native single segment available today.
- Last updated: 2026-08-16

### Kling 3.0 (Kuaishou) — native 4K with synchronized sound

- Release: February 7, 2026 (Verified)
- Resolution: native 4K; Kuaishou bills it as "the world's first native 4K video model" (Verified, vendor claim)
- Single-clip length: up to 15 seconds with multi-shot cinematic output (Verified)
- Audio: native audio plus lip-sync across multiple languages (Verified)
- Consistency: character locking with reference photo/video control (Verified)
- Models: Video 3.0 and Video 3.0 Omni (Verified)
- Price: free tier carries a watermark, memberships remove it; 1080p by default, Pro unlocks 4K (Verified)
- Long-form / local editing: Unverified
- In one line: the first of the four to bundle true native 4K with synchronized, speaking characters.
- Last updated: 2026-08-16

### Veo 3.1 (Google DeepMind) — native sound design and ecosystem

- Release: October 15, 2025 (Verified)
- Audio: natively generated dialogue, sound effects, and ambient noise synced to the visuals (Verified)
- Single-clip length: 8 seconds in Gemini (Verified)
- Long-form: Google Flow targets longer projects with character continuity; upgraded at I/O 2026 with Flow Music (Verified)
- Resolution: Google AI Studio markets cinematic 4K (Verified, vendor claim); free-tier 720p (Unverified)
- Free access: reportedly free for personal Google accounts since April 2026 (Unverified, third-party)
- Note: Gemini Omni is set to replace Veo inside the Gemini app (Verified)
- Local editing: Unverified
- Price: subscription plus AI credits (Verified); specific pricing Unverified
- In one line: the best-regarded audio quality in the field, plus Flow's long-form tooling — the lowest-friction pick for most people.
- Last updated: 2026-08-16

### Runway Gen-4.5 (Runway) — the professional filmmaking stack

- Product line: Gen-4.5, Aleph 2.0, Act-Two, Edit Studio, Runway Dev (Verified)
- Positioning: a full production and post-production toolchain; Gen-4 pioneered scene and character consistency (Verified)
- Leaderboards: ranked above Sora 2 on Artificial Analysis (Verified)
- Single-clip length / resolution / audio: Unverified
- In one line: if you need a production pipeline rather than a one-click generator, Runway's editing and controllability ecosystem still leads.
- Last updated: 2026-08-16

## How to choose: pick by scenario

- **Single-take narrative or short-form**: Seedance 2.5 — 30-second native segments save the most stitching, and the extend-twice option covers most social cuts.
- **4K delivery with talking characters**: Kling 3.0 — native 4K and lip-sync arrive together, and its character-locking is among the strongest of the four.
- **Tight budget or first-timer**: Veo 3.1's reported free tier (Unverified) plus Flow makes Google the cheapest way in — at the cost of 8-second clips and a watermark.
- **Pro film / ad-post work**: Runway Gen-4.5 has the most complete toolchain, but you'll typically add your own audio, since native sound isn't its headline feature.
- **After generation**: tools like Recut act as a local editing workbench — sort takes, cut dead air, attach B-roll — keeping generation and editing decoupled so no single vendor locks you into its editor.

## Version log and how this page stays current

| Date | Seedance (ByteDance) | Kling (Kuaishou) | Veo (Google) | Runway |
|---|---|---|---|---|
| 2024-06 | — | 1.0 Beta (Verified) | Veo 1, May 2024 (Verified) | Gen-3 (Verified) |
| 2024-12 | — | 1.6 (Verified) | Veo 2 (Verified) | — |
| 2025-04/06 | 1.0, June 2025 (Verified) | 2.0 / 2.1 (Verified) | Veo 3, May 2025 (Verified) | Gen-4, April 2025 (Verified) |
| 2025-10 | — | — | Veo 3.1, Oct 15 2025 (Verified) | Gen-4.5 (date Unverified) |
| 2026-02 | 2.0 (Verified) | 3.0, Feb 7 2026 (Verified) | — | — |
| 2026-07 | 2.5, Jul 31 2026 (Verified) | — | — | — |

We re-test this page every quarter: run the fixed methodology, update only the per-model figures and this table, and leave the structure and conclusions standing. Pricing and availability move fast — always confirm on each vendor's official pricing page, and prioritize any "Unverified" items during the next pass.

## Conclusion

There is no single "best" model — only the best fit per job. ByteDance pushed single-clip duration and local editing to 30 seconds and region-level fixes; Kuaishou made 4K and audio-video sync the default; Google attacks the mass market with free access and Flow's long-form tools; Runway defends the professional pipeline. Sora's shutdown is a reminder that even giants strategically exit this market. For creators, the most durable 2026 playbook is mixing models and keeping generation separate from editing.`,
  },
  "capcut-alternative-roundup-2026": {
    title: "CapCut Alternatives (2026): Free, No-Watermark & Open-Source",
    description: "Looking for a CapCut alternative? We tested free, open-source editors — Shotcut, Kdenlive, DaVinci Resolve Free, Recut — on price, privacy, AI and platforms.",
    content: `## Why CapCut creators are looking for an alternative

CapCut (the international build of China's JianYing) is still a capable editor with a huge template library. But between subscription creep, watermark/export prompts and shifting policy risk, more creators are actively searching for a "CapCut alternative free no watermark" or an "open source CapCut alternative." Here is what the evidence actually shows in August 2026.

**Pricing and paywalls (verified).** CapCut's free tier lets you export watermarked-free projects built from your own footage and free assets — but the moment a project touches a Pro-badged template, font, effect or AI action, you get an upgrade prompt at export (verified: CapCut Guide, checked Aug 14, 2026). US-facing Pro reference pricing is $19.99/month or $179.99/year, with the UK App Store listing Standard at £10.99/month and Pro at £21.99/month — prices differ by region, platform and account (verified, dated Aug 14, 2026). AI features run on a separate credit system, not an "unlimited with Pro" promise (verified: CapCut Credit Rules).

**Policy risk (verified).** CapCut was pulled from US app stores on January 18, 2025 under the Protecting Americans from Foreign Adversary Controlled Applications Act, and restored within days; Apple and Google relisted it on February 13, 2025 (verified: Wikipedia). As of August 15, 2026, CapCut is available through official US channels — the January 2026 TikTok USDS Joint Venture (majority American-owned, ByteDance at 19.9%) says its safeguards cover CapCut, but the underlying law was never repealed and a future shutdown is not impossible (verified: CapCut Guide, updated Aug 14, 2026). In India, CapCut was blocked in a July 2020 list of 47 apps with no official restoration notice found (verified).

**Privacy (verified).** CapCut's US privacy policy (updated April 15, 2026) says it may collect account details, user content — including videos, images, audio, AI prompts and files supplied to AI features — and that content may be collected during creation, import or upload even when not saved or published (verified, quoting the policy).

None of this means "CapCut is bad." It means your workflow's exposure to paywalls, uploads and policy changes is worth mapping before you commit. Here are six alternatives, compared on price, privacy, AI, learning curve, platforms and extensibility.

## The alternatives, tested against the checklist

### Shotcut — the simplest free, open-source pick

- Free and open-source (GPL-3.0); current release 26.8.1 (Aug 1, 2026, verified via Wikipedia).
- FFmpeg/MLT based with near-universal format support; multi-track editing, motion tracking, time remapping, keyframes.
- Windows, macOS, Linux, FreeBSD; runs as a portable app from a USB drive.
- **Best for**: anyone on a $0 budget who wants to start cutting today; privacy-sensitive users who want zero uploads.
- **Real limits**: no built-in AI at all — captions need an external transcription tool; no template/social asset ecosystem; the UI feels like software, not an app.

### Kdenlive — the open-source editor that grows with you

- Free and open-source (GPL-3.0), an official KDE project on the MLT engine; current release 25.12.2 (Feb 9, 2026, verified via Wikipedia).
- Unlimited video/audio tracks, title editor, effects and transitions, XML project files, one-click project archiving.
- **Best for**: users willing to spend a week learning a "real NLE" instead of a quick-cut app.
- **Real limits**: still no built-in AI transcription/dubbing; a denser interface than CapCut; XML projects mean you own collaboration tooling.

### DaVinci Resolve (free tier) — the free ceiling for serious work

- The free version bundles editing, color grading, Fusion VFX and Fairlight audio in one app; supports up to 4K/60fps at 8-bit (verified: Blackmagic Design official site). Current iteration is Resolve 21 (official site; Wikipedia records 20.3.2, Feb 12, 2026).
- The AI-heavy tools live in the paid tier: DaVinci Resolve Studio is a **one-time $295** purchase (not a subscription) and adds the AI Neural Engine, Magic Mask, smart noise reduction, 10-bit and beyond-4K (verified: Blackmagic official site).
- **Best for**: mid/long-form creators chasing cinematic color and a finish that looks professional.
- **Real limits**: the steepest learning curve here; free tier caps you at 8-bit/4K and most AI features; hungry for GPU and RAM; no social-style template library.

### Premiere Pro — the industry standard, rent-only

- Adobe subscription: ~$22.99/month for Premiere alone and more for Creative Cloud, no perpetual license (price unverified this round — check adobe.com; the 2026 build is at 26.3.2, verified via TechSpot, Aug 6, 2026).
- The biggest plugin ecosystem and native After Effects/Photoshop workflow.
- **Best for**: commercial teams, client delivery and pipeline work inside the Adobe ecosystem.
- **Real limits**: no free version, subscription cost compounds yearly, and it's overkill for solo social creators.

### JianYing-style platform editors (Bilibili's BCut / 必剪)

- Bilibili's official free editor for PC and mobile ships AI features like digital avatars, custom voice, smart captions and one-click publishing to Bilibili, with updates roughly every 2–4 weeks (verified via Bilibili's official BCut pages and the Microsoft Store listing).
- **Best for**: creators whose home platform is Bilibili and who like platform-native templates.
- **Real limits**: tightly bound to Bilibili; AI runs largely in the cloud (uploads and privacy concerns return); a closed feature set with no extension mechanism.

### Recut — the local-first, open-source AI editing workstation

This is the quadrant most CapCut alternatives skip entirely: **local-first + AI + free and open-source**.

- Local-first by design: footage and projects stay on your machine; **nothing is uploaded and it works offline** (verified: repo README and app docs).
- Timeline editing: a CapCut-style timeline with GPU compositing, 3D effects and on-canvas text; SRT/ASS caption tracks; **script-driven editing** — you edit the transcript and the timeline follows; mechanical filler-word removal and pause compression; automatic audio ducking; MP4 export (verified: recut.editor manifest).
- Local transcription and AI voice: Qwen ASR runs on-device to turn audio/video into timestamped captions plus an editable transcript (export SRT/ASS/Markdown), and CosyVoice2 synthesizes voiceovers from reusable, authorized voice profiles — voices never leave the device (verified: audio-studio app docs).
- AI short films: give it a topic and it drafts narrative structure, storyboard and narration script, then generates matching B-roll aligned on a local timeline, human review before final (verified: vox-broll app docs).
- Extensible: cover studio, depth maps (Depth Anything V2) and Remotion programmatic video (React-driven) are installable apps; you can even write your own apps in JavaScript and connect coding agents over MCP (verified: repo README).
- Platforms: macOS, Linux, FreeBSD, Windows.
- **Real limits**: AI runs on your hardware, so it needs compute — 16GB RAM minimum for transcription, 32GB recommended for voice profiles, NVIDIA CUDA with 8GB+ VRAM is meaningfully faster; on Apple Silicon the current build doesn't use GPU acceleration for transcription/voice, so those are slow; there's no CapCut-scale template marketplace, and the transcript-driven workflow has a learning curve.

## How to choose (decision table)

| Your core need | Pick |
| --- | --- |
| Free, open-source, fully offline | Shotcut / Kdenlive / Recut |
| Free unlimited local transcription + AI voice | Recut (audio studio) |
| Professional color and cinematic finish | DaVinci Resolve free tier |
| Bilibili-native publishing | BCut / 必剪 |
| Commercial pipeline + Adobe ecosystem | Premiere Pro |
| Confidential footage, zero upload | Recut / Kdenlive / Shotcut |

Quick checklist by persona:

- New to editing, $0 budget, want to start now → **Shotcut**
- Willing to learn, want a near-pro NLE → **Kdenlive** or **DaVinci Resolve**
- Talking-head / interview heavy, captions and voice every week → **Recut** (audio studio + editor)
- Publishing mostly to Bilibili → **BCut**
- Client work and team collaboration → **Premiere Pro**, or **DaVinci Resolve Studio** if you prefer a one-time buy

## Where Recut lands

There are three roads away from CapCut: switch platform (BCut), switch tool (Shotcut/Kdenlive/DaVinci), or switch paradigm (Recut). The first two either re-attach you to a platform/subscription or leave an AI gap. Recut fills the empty quadrant — "local-first + AI + free and open-source." The things CapCut charges membership for and runs in the cloud (captioning, AI voice, AI short films) run free on your own machine here, while keeping the open-source properties that made Kdenlive/Shotcut worth trusting: apps can be installed, extended or written from scratch, so your tooling can't be priced out from under you.

## Conclusion

CapCut monetizing isn't evil — it funds one of the best template ecosystems in video editing. But the real costs for frequent creators are recurring membership fees plus footage exposure to cloud processing, on top of an unresolved legal status in the US and other regions. The 2026 tested verdict: budget-zero, privacy-sensitive creators should start with Shotcut or Recut; serious colorists should learn DaVinci Resolve's free tier; Bilibili creators get BCut; and if you want CapCut-style AI without the membership or the uploads, Recut is the local-first open-source option most worth trying this year.

> Fact-check note: "verified" items above were checked against the cited sources this round (CapCut Guide updates of Aug 14, 2026; CapCut Credit Rules and US privacy policy as quoted; Wikipedia for CapCut, Kdenlive, Shotcut, DaVinci Resolve; Blackmagic Design's official pricing page; Bilibili's official BCut pages; and the Recut repository/app docs). Prices are dated references — always confirm the offer shown in your own checkout or storefront.`,
  },
  "ai-video-thumbnail-batch-guide": {
    title: "How to make AI video thumbnails: batch-generating covers for multiple platforms",
    description: "Bilibili, Douyin and YouTube thumbnails all use different sizes. Use AI to batch-generate covers per platform size, unify the series style, ship once and reuse everywhere.",
    content: `A thumbnail decides the click. Different platforms have completely different thumbnail size and composition requirements, and making covers by hand for every video is slow and hard to keep consistent — which is why "AI video thumbnails" has become such a frequently searched term.

## Quick reference: thumbnail sizes by platform

- **Bilibili:** 16:9 landscape, commonly 1280×720 and up.

- **YouTube:** 16:9 thumbnails, recommended 1280×720, minimum 640×360.

- **Douyin (TikTok):** vertical, commonly 9:16 (1080×1920).

- **Xiaohongshu (RED):** commonly 3:4 vertical.

The hardest part of hand-made covers isn't "making one" — it's converting sizes, aligning composition, and keeping a consistent series look every single time.

## Batch generation: one reference, covers for every platform at once

Recut's "Cover Studio" App puts channel sizes, a reference cover and your creative requirements into one flow: pick the channel and get its aspect ratio, use last episode's best cover as a reference to align composition, whitespace and visual tone; add a reference image to lock the subject, and the series style accumulates naturally. Landscape 16:9 and vertical 9:16 are generated as separate specs, so one batch yields candidate covers for every platform.

## Archiving and reuse

Successful results are archived into the media library automatically, living in the same workspace as your video and caption assets for reuse across projects; every generation records the channel, size, prompt and reference source, so reproducing a certain episode's style is just a matter of checking history.

## Who this flow is for

Multi-platform creators and short-video bloggers, content teams that need consistent series visuals, and anyone tired of making a cover from scratch every episode. Start from one reference cover and turn batch thumbnails into a pipeline instead of a recurring chore.`,
  },
  "cosyvoice-local-tts-deployment": {
    title: "CosyVoice local setup too painful? Recut Audio Studio's zero-config approach",
    description: "CosyVoice is an open-source local AI dubbing model, but deploying it means installing Python, pulling weights and tuning VRAM. Recut Audio Studio wraps it into a zero-config local AI dubbing tool — voices and media stay on your machine.",
    content: `CosyVoice is Alibaba's open-source local speech-synthesis (TTS) model: use it to synthesize dubbing and build reusable voice characters without sending your timbre to any cloud service. But when it comes to actually running it, many people give up at the very first deployment step.

## The usual obstacles to self-hosting CosyVoice

Running CosyVoice directly on a device usually means: installing Python and dependencies, configuring FFmpeg, pulling model weights per variant, preparing a CUDA environment for the GPU, and finally debugging parameters one by one on the command line. Each step is simple on its own; together they're enough to scare off most creators. For someone who just wants to quickly dub a talking-head video, this is clearly not the main path.

## Audio Studio: zero-config local AI dubbing

Recut's "Audio Studio" App wraps all of those environment problems away: installing the App prepares the Python runtime and FFmpeg automatically, model weights like CosyVoice2 download on demand at first use, and after that it works offline. Inside the workspace you're not on a command line — you pick a voice, write the text, and synthesize dubbing: build a character from a licensed voice, then have that character read new text. Media and voice data never leave your device.

## Beyond dubbing

- **Local speech transcription:** use ASR models like Qwen to turn audio and video into timestamped captions and editable transcripts.

- **Caption export:** SRT, ASS and Markdown, ready to drop into CapCut, Premiere and other editing flows.

- **Transcript editing:** treat the transcript like a document — remove filler words, compress pauses, then write back to the timeline.

## Hardware requirements

Basic transcription is recommended with 16 GB+ RAM; creating voice characters and synthesizing dubbing reliably is recommended with 32 GB+ and roughly 15 GB of free disk. An NVIDIA CUDA GPU noticeably speeds things up; Apple silicon and CPU-only machines work too.

## When local makes sense

If you care about media privacy, want to work offline, or don't want to be throttled by cloud dubbing service usage and membership limits, local AI dubbing is a viable long-term path. Start by installing Recut and Audio Studio, run your first dubbing job, and you'll quickly see that deployment hell shouldn't be part of creation.`,
  },
  "creative-tools-should-be-extensible": {
    title: "Creative tools should be extensible",
    description: "Apps — not a closed feature list — are how Recut's capabilities keep growing.",
    content: `Almost every creative tool starts with a few core features, then expands with user demand into an ever-larger feature list. The features on that list are independent of each other, hard to combine, and only the tool's maintainers get to decide "what's next". That model is natural for tool companies, but for the people using creative tools it creates a long-term problem: your way of working has to adapt to the tool, instead of the other way around.

## The end of the feature list

When every new need waits for a version update, a creator's rhythm becomes hostage to the tool's release cadence. When short video got popular, video tools chased after short-video templates; when AI generation got popular, they started bolting on generate buttons. The list keeps getting longer, but the part that actually fits your workflow may never make it on.

## Carrying capabilities in Apps, not features

Recut's choice: the platform provides stable, composable core capabilities, and how you actually use those capabilities to create is defined by Apps. Apps write their own interface, business logic and workflows in JavaScript, and connect to the platform's storage, files, tasks, media and models.

- **Clear boundaries:** an App declares the permissions it needs, the platform isolates data and capabilities according to that declaration, and Apps never read each other's private data.

- **Swappable:** the same creative need can have several Apps. You can install, uninstall and update them without touching your project files.

- **Writeable:** Apps aren't just our plugin ecosystem. Apps you write yourself use the exact same capabilities as official Apps — no second-class citizenship.

## What this means for creators

First, tools can grow with your workflow. Talking-head creators can combine transcription, transcript editing and mixing; teams producing series can keep characters and worlds consistent; enterprises with private workflows can connect their own models and internal systems.

Second, your investment doesn't die when a tool stops updating. The core data of a project — media, timeline, settings — is stored by the platform in a format you understand and can migrate, and Apps are just an expression layer on top of it.

## Open and sustainable

A sustainable creative tool is one that gives you a stable foundation while letting you grow freely. It doesn't hoard the decision about "what's next" — it hands it back to every creator and team. That's why Recut treats extensibility as a core design decision rather than an add-on.

To see how this lands in video editing, read our introduction to the AI video workspace, or just install Recut and try it.`,
  },
  "depth-anything-local-depth-map-guide": {
    title: "Generating depth maps locally with Depth Anything: from setup to your media library",
    description: "Depth Anything requires Python, CUDA and model weights before you can generate depth maps, and many people get stuck at step one. Recut's Depth Map App runs zero-config and local — for both images and video.",
    content: `A depth map is an important intermediate artifact in post-production and 3D work: it records scene depth through brightness — the brighter a pixel, the closer it is to the camera. Depth Anything is one of the most popular monocular depth-estimation models, and the community uses it for depth of field, parallax, stereoscopic transitions and 3D scene construction.

## The bar to self-hosting Depth Anything

To run it yourself you need to set up a Python environment, PyTorch and CUDA, download the model weights, and write an inference script; most online demos require uploading your media first. For someone who just wants to turn a few images into depth maps, that's a heavy environment cost.

## Recut Depth Map App: a zero-config local option

Recut's "Depth Map" App wraps Depth Anything with zero configuration: installing it prepares the runtime and model weights automatically, and you can start with an image or video right away. Switch freely between three models — Small is the fastest for previews, Base is the balanced default, Large has more detail — with false-color and grayscale outputs, preview first, then save.

## Images and video both work

Images export as PNG; video runs frame-by-frame inference and exports as H.264 MP4. Results are stored locally first, and only archived into the media library once you confirm — ready for reuse later. Media never uploads, which suits confidential or unpublished projects.

## What depth maps can do

- Depth of field and parallax in After Effects, and stereoscopic transitions.

- Turning ordinary footage into 3D scenes in Blender.

- Giving backdrops, textures and virtual cameras spatial information.

## A licensing reminder

Small is Apache-2.0, while Base and Large are CC-BY-NC-4.0 — confirm your use case matches before commercial use.

## Start from one image

If you work on post or 3D projects that need depth maps, install Recut and the Depth Map App, convert one image, and you'll immediately see why this kind of tool should just open and work.`,
  },
  "ffmpeg-video-editing-cli-guide": {
    title: "Video editing with FFmpeg: beyond the command line, an easier local option",
    description: "FFmpeg is a powerful CLI for video editing, but cutting, joining and captioning all require memorizing flags. Recut moves editing into a local timeline — visual operations and AI assistance, no commands needed.",
    content: `FFmpeg is the Swiss-army knife of video processing: cut, join, transcode, extract audio — one command does it all. For command-line lovers it's a scalpel; for most creators, the learning curve is a wall — every flag needs a docs lookup, and changing one timestamp means re-running the whole command.

## The hidden cost of FFmpeg's everyday commands

Say you want to "cut seconds 10 to 30 from a video, then join three segments": you must get the \`-ss -t -i -c copy\` combination right, handle keyframe alignment, and remember \`-y\` to overwrite the output. It's efficient once you're fluent, but for someone who "just wants to cut a video", this isn't what a creative tool should look like.

## An easier local option: timeline editing

Recut wraps the underlying video processing in a local timeline: drop in clips, drag the cuts, reorder — every step is a visual operation and changes are visible instantly; when you want finer pacing, AI can help structure the narrative, match B-roll, and add captions and dubbing. You never need to memorize a command, because rendering and encoding still happen locally and your media never uploads.

## When FFmpeg is still the right tool

- Batch transcoding, scripted batch jobs, server-side pipelines.

- Frame-exact command-line control.

- Existing automation scripts you need to maintain.

In other words: leave the scripted, repetitive work to the command line, and the creative editing to the workspace.

## The takeaway

FFmpeg is powerful, but it solves "processing video", not "creating video". If what you want is the latter, Recut's local timeline plus AI capabilities is a much friendlier starting point — and, like the CLI approach, it's fully local with your media under control.`,
  },
  "jianying-open-source-alternative": {
    title: "Choosing a CapCut alternative: the third option that's open source, local and extensible",
    description: "CapCut's AI features mostly live in the cloud behind membership limits. When choosing a CapCut alternative, look for three things: runs locally, is open source, and can be extended. Recut is a third option that meets all three.",
    content: `"CapCut alternative" has been one of the most-searched terms among content creators. CapCut is powerful, but its AI captions and dubbing mostly live in the cloud — you upload media and run into membership and length limits. When people look for an alternative, they usually care about three things: is my media safe, will I keep paying forever, and can I shape it around my own workflow.

## Three things to check in a CapCut alternative

- Where media and projects live: local-first means no uploads, controllable privacy and offline capability.

- Free and open source: open tools don't die when a product stops updating, and can be self-hosted long-term.

- Extensibility: a closed feature list can't keep up with your workflow — extensible tools keep growing.

## Recut: local, open source, extensible

Recut is a free, open-source local AI video editing workspace: timeline editing, AI short films, captions and dubbing and Worlds all run on your computer. Media and projects stay local, and AI models execute on your machine; capabilities are carried by Apps, so you can install ready-made Apps like AI Short Films and Audio Studio, or write new creation capabilities yourself in JavaScript.

## Is migrating expensive?

You don't have to move everything at once. Recut imports media and exports standard formats like SRT/ASS/Markdown, so you can trial it on one project and gradually move your usual flow over. Teams comfortable with the command line and code can also wire existing scripts into the workspace.

## Conclusion

If video creation is a long-term part of your work, the choice of a CapCut alternative shouldn't be about price alone — it should be about data ownership and tool autonomy. Recut is a third answer on all three dimensions.`,
  },
  "local-ai-transcription-and-dubbing": {
    title: "Auto-captions for your videos: local AI transcription and dubbing",
    description: "Use locally-running AI to turn video into captions automatically and synthesize dubbing for characters — media never uploads, and speed and privacy stay under your control.",
    content: `Captions are the invisible amplifier of video: they keep content readable on mute, and they measurably lift completion rates. But adding captions by hand is extremely time-consuming, so more creators are using AI transcription. The catch: most "one-click caption" tools are cloud services, so you often have to upload media first, then hit length, usage and pricing limits.

If you care about efficiency, cost and media privacy, you can run the same flow entirely locally: **use local AI to turn audio into timestamped text, then generate caption files automatically.** Recut's "Audio Studio" App is built around exactly this path.

## Local auto-transcription: captions in three steps

- **Import media:** drop interviews, talking-head videos or courses into the workspace's media library.

- **Local transcription:** Audio Studio uses ASR models like Qwen on your machine to turn audio into timestamped transcripts — nothing is uploaded to any server.

- **Export captions:** export the transcript as SRT, ASS or Markdown, ready for editing and publishing.

The whole process runs locally, so you can even work offline. For teams whose media contains real faces, unpublished content or business secrets, this is far safer than handing raw video to a third-party cloud transcript service.

## More than captions: local AI dubbing and voice characters

Transcription is just step one. The same local speech pipeline does two more valuable things for creation:

- **AI dubbing:** build reusable characters from licensed voices and use local models like CosyVoice to read new text — great for re-recording narration, multilingual dubbing or quickly iterating on copy.

- **Transcript editing:** "cut audio" by editing the transcript like a document — remove filler, compress pauses, write back to the timeline — far more intuitive than frame-by-frame trimming.

## What local transcription needs

Basic transcription is recommended with at least 16 GB of RAM; creating voice characters and synthesizing dubbing reliably is recommended with 32 GB or more. For faster transcription, an NVIDIA CUDA GPU with 8 GB+ VRAM is recommended; CPU-only and Apple silicon Macs work too, just slower. Models download to your machine on first use and work offline after that.

## When it's worth trying

If you regularly work with talking-head, interview, course or narration video and don't want raw media uploaded to the cloud, local AI transcription and dubbing is a path worth adopting long-term. Install Recut and the Audio Studio App, run your first transcription, and you'll quickly appreciate the peace of mind of "media that never leaves the device".`,
  },
  "local-first-creative-workspace": {
    title: "Why AI video creation should be local-first",
    description: "Why creative tools should put projects, media and model choice back in the hands of the creator.",
    content: `Over the past year, AI video creation quickly became synonymous with "one-click generation": type a sentence, wait for a progress bar on a card, receive a finished video. It's a satisfying experience, but it flattens a complex creative process into an opaque black box, and quietly hands over the most precious thing a creator owns — the work itself.

**Local-first isn't a rejection of the cloud; it's putting control back in the creator's hands.** When project files, media and generation tasks run on your own device or controlled infrastructure, you get several things cloud products rarely promise.

## Your data is yours

A piece of work isn't just the video you export. It includes the media you didn't use, every decision in the timeline, the character lore you've accumulated, the prompts you iterated on. Cloud tools usually keep these on their servers, and after you export, the intermediate process is often hard to fully retrieve. Local-first means all of it lives on your disk, in formats you can understand and migrate.

## Choice isn't locked in

Model capabilities change fast — today's great generation service may raise prices, throttle or shut down tomorrow. Binding your creative pipeline to one cloud account means handing over your choice. Local-first turns models, generation services and tools into swappable parts, not the handcuffs that lock up your entire body of work.

## Privacy and security by default

Video media often contains real people, real places and unpublished ideas. Uploading to the cloud sends that content through a pipeline you can't fully control. Running locally means no uploads and credentials you manage yourself — privacy isn't a paid add-on, it's the default state.

## Keep creating offline

Creation shouldn't break because the network flickers. A local-first workspace keeps working without a connection — organizing media, editing the timeline, reviewing exports. For people who often work on set, on the subway or far from stable networks, this isn't a convenience, it's the baseline.

## Who it's for

- Creators treating video as long-term work, who need their body of work to accumulate and be revisit-able at any time.

- Individuals, teams and enterprises sensitive about data and privacy, who don't want media handed to an opaque cloud.

- Teams that prefer to own their tools and want workflows that can keep evolving.

Of course, local-first has a cost: you install and maintain your own environment, and compute and model downloads can be slower on some devices. But this isn't a "free lunch" choice — it's about putting the answer to "who owns your creation" squarely on the creator's side.

Recut is designed around exactly this belief: projects, media and workflows always stay under your control, while the App mechanism lets the tool keep growing. In the next post, we'll talk about why putting all of it in one workspace matters.`,
  },
  "local-video-editing-privacy-workflow": {
    title: "Local video editing without uploading media: a complete workflow for privacy-sensitive creators",
    description: "Move editing, captions and dubbing entirely local: no uploads, works offline, models run on your machine. A complete video workflow guide for privacy-sensitive creators and companies.",
    content: `For many content creators and teams, media isn't just work — it's confidential: unpublished commercial videos, real clients and colleagues, products and plans that haven't launched. Uploading raw video to a cloud tool is like sending all of it through a pipeline you don't control.

## What "no uploads" really means

The core of local video editing isn't "rejecting the cloud" — it's taking data control back into your hands: projects, media and credentials stay on your device or controlled infrastructure, AI models execute on your machine, and nothing uploads unless you decide it does.

## A complete local creation workflow

- **Editing:** drop in media and arrange picture and pacing on a local timeline — no upload required.

- **Captions:** local AI transcription produces timestamped captions; export SRT/ASS and use them directly.

- **Dubbing:** build characters from licensed voices, synthesize dubbing locally — the voice never leaves the device.

- **Generation:** AI short films, covers, depth maps and more also run on your machine.

- **Collaboration:** teams can share through a self-controlled remote service that browsers connect to directly — no third-party servers in between.

## Who it's for

Organizations dealing with unpublished content, privacy-sensitive freelance creators, shooting crews that need to work offline, and anyone who doesn't want their creation bet on a single cloud vendor.

## Conclusion

Local video editing isn't a step back to primitive tools — it's having AI capabilities and data control at the same time. Recut makes this workflow free and open source, and from the moment you install it, your media doesn't have to leave your computer.`,
  },
  "minimax-elevenlabs-local-voice": {
    title: "How to choose AI dubbing software: cloud pricing and local voice-cloning compared",
    description: "An AI dubbing software selection guide: for voiceover and podcast work, cloud API or local deployment? This post verifies real MiniMax and ElevenLabs pricing and upload limits, and compares local voice-cloning options like CosyVoice, IndexTTS2 and GPT-SoVITS on setup difficulty, hardware and cloning ability.",
    content: `"AI dubbing" is nearly unavoidable when you're making talking-head videos, podcasts or short-form narration. The market is overwhelming: per-character cloud APIs, monthly-subscription platforms, and local models that run entirely on your own computer. This guide skips the hype and covers two things: first, how the mainstream cloud AI dubbing tools actually charge, and what handing them your text and voice samples implies; second, if you want a "local voice character" that's reusable and never leaves your computer, which real options exist. Prices are sourced where possible; anything without an official figure is explicitly marked "unverified".

## The pain points: real pricing and upload limits

Let's start where budgets are made or broken. MiniMax Audio offers two pricing tracks: "audio subscription" plans at Starter $5/month for 100k audio credits, Standard $30/300k, Pro $99/1.1M, Scale $249/3.3M and Business $999/20M (source: platform.minimax.io official pricing page); and usage-based pricing with speech-2.8-turbo at roughly $60 per million characters, speech-2.8-hd at roughly $100 per million characters, instant voice cloning at $1.5 per voice, and voice design at $3 each (source: same official pricing page). It supports API access — a single WebSocket call handles up to 10k characters and async long-form up to 1M characters. For voice cloning you must first upload mp3 / m4a / wav samples (10 seconds to 5 minutes, under 20 MB) to the cloud, and cloned voices unused for 7 days are deleted by the system (source: platform.minimax.io voice-cloning docs).

ElevenLabs bills in "credits": the Free tier gets 10k credits a month (roughly 10 minutes of audio), Starter $6/300k credits, Creator $22/1.21M (first month $11), Pro $99/6M, Scale $299/1.8M (3 seats) (source: elevenlabs.io/pricing). The Multilingual v2 model is about 1 character = 1 credit; Flash / Turbo about 0.5–1 credits per character; the official language list includes Chinese (Mandarin). Closer to home, iFlytek's dubbing products are sold via membership tiers that include ultra-realistic TTS, digital-human video and custom voices — specific prices live on the membership page (unverified); CapCut's text-to-speech and voice cloning are also membership-based (unverified). Both share the same reality: your text and voice samples go to the cloud, you need an internet connection, you pay monthly, and offline use isn't an option — accept this before you choose.

## Local options: CosyVoice, IndexTTS2 and GPT-SoVITS

If uploading media is a dealbreaker, local open-source TTS is the other road. Alibaba's FunAudioLLM released CosyVoice (22.8k stars on GitHub, Apache-2.0), the most mainstream local dubbing model in the Chinese community: CosyVoice2-0.5B has 0.5B parameters, supports zero-shot voice cloning — just a few seconds to tens of seconds of reference audio lets any specified text be read in that timbre, with streaming output. The official repo requires Python 3.10 + conda, weights from ModelScope / HuggingFace, and ships a WebUI and Docker scripts (source: github.com/FunAudioLLM/CosyVoice). No official VRAM figure is given (unverified); a 0.5B model runs on consumer GPUs, and pure CPU works but slowly.

Bilibili's IndexTTS2 (latest IndexTTS-2.5, 0.8B parameters) focuses on emotion and speed control plus pinyin / CMU phoneme correction, supports five languages (Chinese, English, Japanese, Spanish, Arabic), manages dependencies with uv, quotes an RTF of about 0.2 on a 4090, needs CUDA 12.8, and downloads models online (source: github.com/index-tts/index-tts). RVC-Boss's GPT-SoVITS (60.9k stars, MIT) is a few-shot approach: 5 seconds of reference timbre enables zero-shot synthesis, fine-tuning on about a minute of data visibly improves similarity, supports Chinese, English, Japanese, Korean and Cantonese, has extensive community tutorials and a Windows all-in-one package; it runs on Mac but the official notes say training quality drops noticeably (source: github.com/RVC-Boss/GPT-SoVITS). Common bar to entry: Python, CUDA (or Apple silicon), downloading weights, and comfort with the command line. Unlike the cloud, these models clone voices entirely locally, work offline, and never leak your media — but naturalness and stability often need repeated tuning, a higher bar than "type text, click generate".

## Trade-off: worry-free cloud, or controllable local?

How to choose? In one line: it depends on how sensitive you are to "data security" and "cost structure". Cloud AI dubbing wins on zero setup, huge voice libraries and pay-per-use that suits low-frequency trials; its weakness is subscription cost at sustained high volume — on ElevenLabs, 1 character ≈ 1 credit (Multilingual v2), so the Creator tier's 121k credits covers only about 121 minutes of audio, with overage around $0.18 per minute (source: elevenlabs.io/pricing). For a daily talking-head creator, a month's quota can vanish in days. On MiniMax pay-per-use, a million characters in HD quality is about $100 (source: platform.minimax.io) — dubbing a podcast script of a few hundred thousand characters can cost hundreds of dollars.

Local is a "trade time for monthly fees" deal: spend a few hours to a day on setup and tuning up front, then synthesis cost drops to almost zero, and you can build a reusable voice character for a fixed host — which is exactly why many bloggers and podcasters have moved to local voice cloning. The cloning principles are similar (zero-shot / few-shot learning of a reference timbre); the difference is deployment method and where compute lives.

## Hardware: what a local voice character needs

If you go local, hardware matters. CosyVoice isn't picky about VRAM — no official figure (unverified); community experience puts smooth inference at an NVIDIA card with 4 GB+ VRAM, with pure CPU usable but slow; IndexTTS2 officially recommends an NVIDIA GPU + CUDA 12.8; GPT-SoVITS measured RTF about 0.028 on a 4060 Ti and 0.014 on a 4090 (v2 ProPlus), so mid-range cards get near-real-time synthesis.

If you'd rather not touch the command line, ready-made local tools exist too — Recut Audio Studio is essentially a local model combo with a GUI: it uses the local Qwen3-ASR 0.6B for transcription and CosyVoice2-0.5B for dubbing, all on your machine; it supports building reusable voice characters from licensed voices, keeps media and voices on the device, works offline, and exports SRT / ASS / Markdown. Basic transcription is recommended with 16 GB RAM; stable character creation/dubbing with 32 GB+ RAM and about 15 GB disk, with CUDA acceleration optional. Tools like this drop the "localization" bar from the command line down to GUI operations, suited to content creators who don't know Python.

## Conclusion

Back to the original question — how to choose AI dubbing software? For low-frequency trials that don't mind media going to the cloud, just use ElevenLabs' free tier or MiniMax's subscription/pay-per-use — a few dollars runs the whole flow. For fixed columns, long-term needs for a fixed timbre, or sensitivity about media security, it's worth setting up a local voice-cloning stack — one investment, monthly fees to zero, and "work even offline". All prices in this post come from official pricing pages and repositories; items marked "unverified" should be checked against the latest official pages. There's no standard answer in AI dubbing comparisons — only the choice that fits your cost structure.`,
  },
  "open-source-ai-video-tools-roundup": {
    title: "Open-source AI video tools roundup: 9 representative local-first projects",
    description: "A roundup of open-source AI video editing tools: from Whisper and Qwen3-ASR transcription, Depth Anything depth maps, Remotion programmatic video, to CosyVoice dubbing and Kdenlive editing — deployment difficulty and licenses compared across a local-first AI video workflow.",
    content: `Want to use AI to edit video, clean up talking heads, add captions or generate covers — without handing media to the cloud? That's the first wall many people hit. The good news: "local-first" open-source options have matured into a complete toolchain over the past few years — transcription, dubbing, depth maps, programmatic video and open editors each have real users and active maintainers. This roundup covers representative projects across five areas, real deployment difficulty and licenses, with verification notes where facts matter, so you can judge what's worth installing.

## 1. Speech transcription (ASR / captions): from Whisper to Qwen3-ASR

Representative projects: OpenAI Whisper (MIT; code and weights verified), whisper.cpp (MIT), faster-whisper (MIT), Qwen3-ASR (Apache-2.0).

Deployment difficulty: Whisper is the standard — Python 3.8–3.11 + PyTorch + ffmpeg, with tiny needing about 1 GB VRAM and large about 10 GB (verified against the official README). whisper.cpp is a pure C/C++ ggml port that runs on CPU, models from 75 MiB to 2.9 GiB, and can use Metal on Apple Silicon — the choice for embedded or low-spec machines. faster-whisper is a CTranslate2 rewrite claiming about 4× the original speed, with GPU acceleration needing CUDA12 + cuDNN9. Qwen3-ASR is Alibaba's Tongyi family released in early 2026 (0.6B/1.7B); the official repo and model card are both Apache-2.0 (verified), supporting 30 languages + 22 Chinese dialects with unified streaming/offline inference and a bundled ForcedAligner for timestamps; however it needs Python 3.12 and an NVIDIA GPU, feels closer to "LLM deployment" (transformers or vLLM), and is clearly a higher bar than the Whisper family (deployment details verified against official docs).

Who it's for: if you just want captions out of the box, prefer Whisper or faster-whisper; if you need Chinese/dialect accuracy and have an NVIDIA card, go Qwen3-ASR.

## 2. Depth estimation (depth maps): Depth Anything V1 / V2

Representative projects: Depth Anything V1 (Apache-2.0, verified), Depth Anything V2 (Small = Apache-2.0; Base/Large/Giant = CC-BY-NC-4.0, verified against the official README).

Deployment difficulty: both versions follow the DINOv2-DPT route — Python + PyTorch + OpenCV is enough, no large VRAM needed — V2 Small is only 24.8M parameters, Base 97.5M, Large 335.3M, Giant 1.3B; default input resolution is 518, with run.py and run_video.py scripts provided (verified against the official README).

Who it's for: pseudo-3D, depth-of-field covers, background blur, and pre-toon guidance — prefer Depth Anything V2 Small; Base if you want finer edges. Mind the license trap: V2 Small is safe for commercial use, but Base and Large are CC-BY-NC-4.0 non-commercial (verified) — commercial projects should use Small or reassess licensing.

## 3. Programmatic video: Remotion

Representative project: Remotion (React + Node.js, 56k+ stars, verified). It lets you make videos by writing code — describe each frame with React components and batch-render with one command, naturally suited to data visualization, caption animation and automated batch production.

Deployment difficulty: needs a Node.js environment, start with \`npx create-video@latest\`, rendering depends on Chrome/Chromium (official docs, verified); no GPU, no Python required. The real gotcha is licensing: Remotion isn't under a standard open-source license — it uses a custom license, and some commercial scenarios require a company license (verified against the official README).

Who it's for: frontend folks and teams building template-based / batched short video or animated captions; it's also the foundation of many "AI-generated video" products.

## 4. Local TTS and voice cloning: CosyVoice / IndexTTS2 / GPT-SoVITS / OpenVoice

Projects and difficulty (all verified against official repos):

- CosyVoice / CosyVoice2 (now QwenAudio/CosyVoice): code Apache-2.0, and CosyVoice2-0.5B weights are Apache-2.0 too; Python 3.10 + conda install, ~0.5B model, zero-shot cloning from 1–2 sentences, stable across Chinese/dialects/cross-lingual, with the ecosystem extended into Fun-CosyVoice 3.0 (0.5B).
- IndexTTS2 / IndexTTS2.5 (index-tts): emotion/speed/pinyin-phoneme control with first-tier open-source TTS quality; but it's under a Bilibili model-use license, not a standard open license — commercial use needs to contact the vendor (verified); install via uv, officially needs CUDA 12.8+, IndexTTS2 ~1.5B and 2.5 ~0.8B.
- GPT-SoVITS (RVC-Boss): MIT, zero-shot from 5-second audio, few-shot from 1 minute of fine-tuning, supports Chinese/English/Japanese/Korean/Cantonese, friendly WebUI, runs on CUDA / Apple Silicon / CPU.
- OpenVoice (myshell-ai): MIT, commercial-friendly, focused on instant cloning + style control.

Who it's for: for the least effort in dubbing and cloning, choose GPT-SoVITS or OpenVoice; for Chinese voice quality and cross-lingual use with an NVIDIA environment you can maintain, CosyVoice2 is the best value; for commercial dubbing services, avoid IndexTTS2's license first, then confirm the MIT/Apache terms of CosyVoice/OpenVoice (all verified).

## 5. Open-source editors: Kdenlive / Shotcut / Olive / DaVinci Resolve

Representative projects (verified): Kdenlive (GPL-3.0, built on MLT + KDE frameworks, cross-platform); Shotcut (free, open-source, cross-platform, built on MLT + FFmpeg; the official site states "free & open source"; the exact license is publicly listed as GPL-3.0, SPDX detail not verified); Olive (the site now says "Olive will return…" — in a regression/rebuild phase, old releases downloadable from GitHub Releases, verified); DaVinci Resolve free — note it is **not open-source software**, it's Blackmagic's proprietary software, with the free tier topping out at UHD 3840×2160, 8-bit, 60fps (verified against the official page), and it's often mistaken for an open-source alternative.

Who it's for: everyday editing and multi-track color — Kdenlive/Shotcut are enough at zero cost; for heavy color grading and Fusion effects, the DaVinci free tier is still the free ceiling, just don't count it as "open source".

## 6. Putting the whole chain in one App: Recut

The five categories above are "one tool, one job". If you don't want to assemble Python environments, GPU drivers and a stack of command lines yourself, take a look at Recut: it's itself a free, open-source local AI video editing workspace that carries capabilities in Apps — timeline editing, AI short films, captions and dubbing, covers, depth maps — media never uploads and everything runs locally.

Its relationship to the open-source projects in this roundup is "compatible and wrapping", not empty naming: the Depth Map App is built on Depth Anything Small/Base/Large with false-color/grayscale output and PNG/MP4 export, no uploads; Audio Studio does local transcription (Qwen3-ASR) and dubbing (CosyVoice2); the Remotion Video App wraps a real Remotion project where AI rewrites code to edit the video. Want more freedom? You can extend Recut in JavaScript and connect your own models and tools (all of the above are Recut's official capability statements; no other unverified project lists are claimed).

## 7. How to choose

- Captions fast: Whisper (CPU is enough) or faster-whisper (NVIDIA speeds it up) → move up to Qwen3-ASR for Chinese dialects/lyrics.
- Covers / pseudo-3D only: Depth Anything V2 Small (Apache-2.0, commercial OK); for commercial use avoid Base/Large's CC-BY-NC.
- Batch template video: Remotion — confirm a company license covers it first.
- Dubbing/cloning: GPT-SoVITS/OpenVoice (MIT) for easy setup; CosyVoice2 for quality; commercial — check licenses before choosing.
- Editing: Kdenlive / Shotcut; Hollywood-grade color, add DaVinci free (remember it's not open source).
- All-in-one and local-minded: use Recut as the workspace and plug in the open-source models above as needed.

## 8. Conclusion

The open-source AI video editing chain stopped being a "does it exist" question long ago — it's now "do you want to deploy it yourself": Whisper-family transcription, Depth Anything V2 depth maps, CosyVoice/GPT-SoVITS dubbing, Remotion programmatic video, Kdenlive/Shotcut editing — each area has solid MIT/Apache-level representatives (licenses verified). Only three things really need care: one, DaVinci, which is proprietary but often mistaken for open source; two, commercial restrictions like CC-BY-NC (Depth Anything V2 large models), the Bilibili license (IndexTTS2) and Remotion's custom license; three, the VRAM and CUDA bar — for low-spec machines, whisper.cpp and Depth Anything Small are the safest entry points. Keep those three in mind and a local-first AI video workflow can really run.`,
  },
  "qwen-asr-local-transcription-deployment": {
    title: "Deploying Qwen local speech transcription (ASR): from the command line to zero-config",
    description: "Qwen3-ASR is an excellent local transcription model, but deploying it means installing Python, downloading weights and tuning VRAM. See how Recut Audio Studio turns local transcription into a zero-config auto-caption tool.",
    content: `Local speech transcription (ASR) has advanced quickly, and Qwen3-ASR is one of the standout open-source models: accurate on Chinese, timestamped, and a great fit for turning talking-head, interview and course videos into captions and transcripts. Its only hurdle is deployment.

## What self-hosting Qwen ASR involves

A typical self-host flow looks like: create a Python environment and install torch and dependencies, download the model weights (Qwen3-ASR 0.6B plus the timestamp aligner is about 3.5 GB), then prepare FFmpeg and the audio-processing chain for transcription; for speed you'll also want a CUDA GPU. Every step means debugging command lines.

## Recut Audio Studio: making transcription an everyday tool

Recut's "Audio Studio" App uses the same Qwen ASR capability but wraps away all environment problems: installing prepares Python and FFmpeg automatically, models download on demand at first use and work offline after that. Drag audio or video into the workspace and local transcription automatically produces timestamped captions and an editable transcript — no terminal required.

## How to use the results

- **Captions:** export SRT or ASS and load straight into CapCut, Premiere and similar.

- **Transcripts:** export Markdown for scripting, lecture notes or publishing.

- **Remixing:** combine with AI dubbing and transcript editing to chain "transcribe — review — dub — edit" into one complete local pipeline.

## Hardware requirements

Basic transcription is recommended with at least 16 GB RAM; an NVIDIA CUDA GPU with 8 GB+ VRAM speeds things up noticeably, while CPU-only and Apple silicon Macs work too, just slower.

## Why local transcription is worth it

No media uploads, works offline, and no longer limited by cloud transcription usage and pricing — for people who regularly handle long interviews or confidential content, local transcription isn't just about saving money, it's about taking control back. To try it, install Recut and Audio Studio and start with your first caption.`,
  },
  "remotion-batch-video-template": {
    title: "Batch-generating videos with Remotion: one template, many videos",
    description: "Remotion makes video code-driven, so the same template can produce many videos by swapping data. Recut's Remotion Video App brings template-based batch production into the local workspace — change data, re-render.",
    content: `When you need to produce a batch of videos that share a style but differ in content — a weekly leaderboard, brand films customized per client, fixed intro cards for a course series — hand-editing hits a ceiling. Remotion defines video in code, making "swap data, re-render" the core of batch production.

## The right way to do batch production with Remotion

The key to batch video in Remotion is a single source of truth for the template: put visual primitives, caption themes and layout logic into one template, feed the same template different copy and media, and you get a batch of consistent finished videos. When data changes, just change parameters and re-render — no per-video manual re-editing.

## The cost of building a Remotion project from scratch

Setting up a batch-producible Remotion project yourself isn't easy: you configure the render environment, manage media, handle frame determinism and the export pipeline, and turn the copy-and-media ingestion into a reusable flow. For a content team, maintaining that infrastructure often costs more than it returns.

## Recut's Remotion Video App: batch production inside the workspace

Recut's "Remotion Video" App brings template-based batch production into the local workspace: pick a template, fill in topic and media, and AI arranges the copy and picture into a video; the project is a real Remotion project, so when you need precise control you can open the code and change any frame. Exports render locally as MP4, archive automatically as media and set as the project cover, and dozens of videos can queue up without any cloud dependency.

## Who it's for

Rolling content with fixed templates — weekly reports, leaderboards, market reviews; teams that ship batches for clients; and any creator who wants to turn "a video every episode" into "one template producing many videos".

## Conclusion

Batch video isn't about opening more timelines — it's about making the template the single source of truth. Run Remotion batch production through Recut, and your next batch of finished videos will be ready much faster.`,
  },
  "remotion-tutorial-beginner-guide": {
    title: "Remotion for beginners: a complete tutorial on making videos with code, with real examples",
    description: "A Remotion tutorial for beginners: from Composition, DurationInFrames, useCurrentFrame and Sequence core concepts, to a real runnable minimal example and the `npx remotion render` command, then batch templating, plus the Recut Remotion App local workspace when you'd rather not write code.",
    content: `Remotion for beginners: making videos with code is becoming a side skill for more and more frontend engineers. Traditional video editing is dragging on a timeline with a mouse; Remotion does the opposite — a video isn't "edited", it's **rendered**: you write each frame as a React render, Remotion screenshots frames one by one in the browser, and FFmpeg encodes them into an MP4. Its own positioning is "Make videos programmatically", with about 56k stars on GitHub and 5M+ monthly downloads. This is a Remotion tutorial aimed at Chinese-speaking developers; every API below was checked against the current official docs (remotion@4.0.512), and the code can be copied as-is.

If you've searched for "Remotion 入门", "Remotion tutorial" or "make video with React", you probably already know the core value: **determinism** and **batch** — the same code with a different dataset generates endless videos. That's the most fundamental difference from traditional editing software.

## What Remotion is

In one sentence: **Remotion abstracts a video as "a React component that changes over time"**. A video is essentially a continuous sequence of frames; Remotion numbers each frame and gives you \`useCurrentFrame()\` to know "which frame are we on", then you render the picture based on that number. The further the frame advances, the more continuous the change, and it all connects into one video.

The mental gap from a normal React app is almost zero: the same JSX, the same CSS, the same componentization — only the render target changes from "web page" to "frame after frame of video". That's why the official recommendation is to know **a bit of React** — you don't need to learn AE or Premiere first.

Before writing code, remember the five core concepts of Remotion (these are the ontology defined by the official Terminology page):

- **Composition:** an exportable "video unit" made of a React component + width + height + fps + duration + a unique id, registered in \`src/Root.tsx\` and listed in Remotion Studio's left panel;
- **durationInFrames:** the total number of frames; combined with fps you get seconds: \`duration (seconds) = durationInFrames / fps\`;
- **fps:** frame rate, commonly 30 or 60;
- **useCurrentFrame():** returns the current frame number (0-based) — the "clock" of all animation;
- **Sequence:** a "layer" on the timeline. Use \`from\` to delay when something appears, \`durationInFrames\` to trim its length, and nest Sequences to stack time offsets.

## Core concepts and a minimal example (real APIs)

A minimal runnable Remotion project needs only three files. First, scaffold the project:

\`\`\`bash
npx create-video@latest
# or npm init video --blank
\`\`\`

Then the **video component** (\`src/Composition.tsx\`) — it decides what each frame draws:

\`\`\`tsx
import {AbsoluteFill, useCurrentFrame} from 'remotion';

export const MyComposition = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        fontSize: 100,
        backgroundColor: 'white',
      }}
    >
      The current frame is {frame}.
    </AbsoluteFill>
  );
};
\`\`\`

Next register the root in the **entry file** (\`src/index.ts\`):

\`\`\`tsx
import {registerRoot} from 'remotion';
import {RemotionRoot} from './Root';

registerRoot(RemotionRoot);
\`\`\`

Finally declare the video's metadata in the **Root file** (\`src/Root.tsx\`) with \`<Composition>\`:

\`\`\`tsx
import {Composition} from 'remotion';
import {MyComposition} from './Composition';

export const RemotionRoot = () => {
  return (
    <Composition
      id="MyComposition"
      component={MyComposition}
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
\`\`\`

150 frames at 30fps is exactly 5 seconds. \`useVideoConfig()\` lets a component read all four metadata values, and \`interpolate()\` plus \`spring()\` are the most common pure functions for transitions.

Previewing is one command:

\`\`\`bash
npx remotion studio src/index.ts
\`\`\`

It starts Remotion Studio, a local dev console with a timeline, frame-by-frame preview and a props-editing panel.

## The render command and frame determinism

When you're done, export. The render command is:

\`\`\`bash
npx remotion render src/index.ts MyComposition out/video.mp4
\`\`\`

\`composition-id\` can be omitted — then the CLI shows a picker. The default codec is **H.264**, producing the most universal MP4; you can switch to \`h265\`, \`vp8\`, \`vp9\`, \`av1\`, \`prores\`, or export audio only (\`mp3\`/\`wav\`/\`aac\`) or GIF. The container format is decided automatically by the output extension.

Many Remotion tutorials stress a killer feature: **frame determinism (preview == export)**. Why does it matter? In traditional tools there's often an invisible difference between the preview and the final export — the effect you tuned doesn't match after export. Remotion runs preview and export through the same render pipeline: every frame you see in Studio is also rendered frame-by-frame by a browser engine at export (since Remotion 4.0.247 it downloads and **pins a specific version** of Chrome Headless Shell automatically, then encodes with FFmpeg). The docs even warn: if you replace the built-in browser binary with your own, results "may be less deterministic".

The single rule for keeping determinism: **don't use time- or environment-dependent values like \`Math.random()\` or \`Date.now()\` in your components**. Drive all animation from \`useCurrentFrame()\`, computing intermediates with \`interpolate()\` and \`spring()\` — then the same frame renders identically on any machine, at any moment. That's the precondition for "preview is export", and the bedrock for batch production later.

## Batch and templating: one template, N videos

Determinism's direct dividend is **batch video generation**. Remotion's templating matches React exactly — make data into props.

First declare \`defaultProps\` on the \`<Composition>\` to define the data shape:

\`\`\`tsx
<Composition
  id="MyComp"
  component={MyComposition}
  durationInFrames={150}
  fps={30}
  width={1920}
  height={1080}
  defaultProps={{titleText: 'Hello'}}
/>
\`\`\`

Render from props directly in the component:

\`\`\`tsx
type Props = {titleText: string};
export const MyComposition: React.FC<Props> = ({titleText}) => {
  return <AbsoluteFill>{titleText}</AbsoluteFill>;
};
\`\`\`

At render time, override data with \`--props\` and each run produces one video:

\`\`\`bash
npx remotion render MyComp out/a.mp4 --props="./input-props.json"
\`\`\`

To scale, write a loop with the Node.js API. The official dataset-render tutorial does: \`bundle()\` to package the project → \`selectComposition()\` to pick a composition per dataset entry → loop \`renderMedia()\` to export each:

\`\`\`ts
import {renderMedia, selectComposition} from '@remotion/renderer';
import {data} from './dataset';

for (const entry of data) {
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'MyComp',
    inputProps: entry,
  });

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: \`out/\${entry.name}.mp4\`,
    inputProps: entry,
  });
}
\`\`\`

Data can be JSON or CSV (converted to JSON); pushing copy, e-commerce hero videos and personalized marketing videos are all classic use cases — this is where "making videos with code" actually pays off: data changes, the template stays, and output becomes a pipeline.

## The no-code path: Recut Remotion App

If "Remotion 入门" still feels like a high bar, or you don't want to scaffold a project from scratch, there's an easier route — a Remotion project wrapped inside a local workspace: **Recut Remotion App**.

- Recut wraps a real Remotion project (the \`remotion-skeleton\` copied into a project-private workspace) as a local workspace: pick a template, fill in the topic and media, and AI rewrites the composition code in the project with live preview — no manual scaffolding or code;
- because the project is a real Remotion project, you can open the code and change any frame whenever you want, and it's fully open if you want to go deep at the code level;
- export renders locally to MP4, archives automatically as media and sets it as the cover; local-first, no uploads, with privacy and control guaranteed.

In other words, Recut doesn't replace Remotion — it lowers the bar on "making videos with code": finish your first video in the workspace first, then drop down to the code level as needed.

## Conclusion

Starting from zero with code-made video is actually a clear path: scaffold with \`npx create-video\` → write your first animation with \`Composition\` + \`useCurrentFrame()\` → export MP4 with \`npx remotion render\` → template the video with props → batch produce. The core is always four concepts: Composition, durationInFrames, useCurrentFrame and Sequence.

This Remotion tutorial gives you a "actually works" map rather than outdated APIs — every snippet was checked against the official remotion@4.0.512 docs. What's left is to draw that first frame. Once you run a minimal example, you'll find that advanced topics like "Remotion rendering" and "batch video generation" all rest on one intuition: **video = a React component that changes with the frame number**. And if you'd rather finish a video before talking code, you can start from Recut Remotion App's local workspace.`,
  },
  "remotion-video-for-code-lovers": {
    title: "Getting started with Remotion video: making editable videos with code",
    description: "Use React and code to arrange data, copy and media into programmatic videos with live preview and batch export.",
    content: `When video needs repeat production, needs to follow data changes, or must keep dozens of outputs perfectly consistent in style, hand-editing hits its ceiling. That's when one particular class of video tool becomes extremely fitting: **programmatic video**. And one of the most mature, most active-community options in that class is Remotion.

## What Remotion is

Remotion lets you describe video with React components — every frame of the picture comes from a line of deterministic code. Since it's code, it can be version-controlled, parameterized and batch-run: feed the same template different copy and media and you get a batch of consistently styled finished videos.

## When code-made video fits

- **Data visualization:** turn charts, metrics and conclusions into rhythmic motion, and re-render when data changes.

- **Template batch production:** course covers, brand outros, fixed layouts for series voice-over — write once, reuse forever.

- **Precise control:** frame-exact deterministic animation, transitions and layout without dragging a timeline.

- **Team collaboration:** the video description is code, so review happens on diffs — communication cost drops sharply.

## The real bar of code video

Remotion itself is a developer tool. To create fluently with it you need: to read code, configure a render environment, and manage the handoff between media and models. For many creators, that bar sits in front of "easy to use".

Recut's "Remotion Video" App tries to remove that bar: it arranges topics, copy and media into a reviewable, live-preview, exportable Remotion programmatic video, while keeping your control over the code — the project is a real Remotion project, so you can open the code and make deep changes whenever you want.

## One path from template to finished video

1. Describe your topic, target duration and style, and let the creation guide generate a storyboard and script.

2. Add media in the workspace and preview the picture and pacing live.

3. Export when the preview looks right, or keep refining any frame in code.

The whole path runs locally: media, project and generated pictures are all on your device, so cloud render quotas never interrupt creation.

## Who it's for

If you already know a bit of code and are bothered by "remaking video every time", a Remotion-style workflow is worth investing in. If you're a content team needing a reusable, batchable, hand-off-able pipeline, programmatic video may be a more sustainable answer than manual editing.`,
  },
  "video-subtitle-tools-comparison": {
    title: "Video-to-caption tools compared: cloud vs. local offline transcription",
    description: "A comparison of video-to-caption tools: cloud options like CapCut, iFlytek, Huiying and Feishu Minutes vs. local transcription like Whisper, faster-whisper and Qwen3-ASR — broken down by billing, privacy, Chinese accuracy and export formats, with real prices and recommendations.",
    content: `Vertical short video, talking heads, courses, podcasts, overseas distribution... captions stopped being a mere accessibility aid long ago. About 80% of people on the subway watch video without sound — captions directly decide completion rates; for creators, captions are also the textual draft for secondary editing (removing fillers, compressing pauses, rough cuts). So "video-to-caption tools" have become a necessity — but the market splits into two completely different camps: **cloud online transcription** like CapCut, iFlytek, Huiying Subtitle and Feishu Minutes, versus **local offline transcription** like Whisper, faster-whisper and Qwen3-ASR. This post spreads them out and compares across four dimensions.

## Dimension 1: privacy — who is uploading your raw video

This is the easiest difference to overlook and possibly the most consequential. The essence of cloud tools is "trade uploading your media to a server you don't control for accuracy": Huiying is web-based — you import a video before it can recognize it (verified; the official flow is "import video → recognize → download"); iFlytek asks you to import audio/video into the platform before transcribing (verified; the official site's "import file" entry); Feishu Minutes likewise accepts uploaded local audio/video to generate transcripts (verified against Feishu's help center). CapCut's smart captions also require login and online recognition (unverified: whether recognition actually processes in the cloud couldn't be confirmed on the official site).

The local camp's selling point is exactly "media stays home": Whisper, whisper.cpp and faster-whisper all run inference on your machine, and whisper.cpp's official material even shows it running "fully offline, on-device" on an iPhone (verified); Qwen3-ASR can also be deployed locally with transformers or vLLM (verified). If you work with interviews, business meetings or unpublished content, media sensitivity directly decides whether you can give up the "no install" convenience.

## Dimension 2: cost — free quotas and billing units

Cloud billing per "transcribed minute" is the norm:

- Huiying Subtitle: from ¥0.6/minute, time cards down to about ¥0.2/minute, 5 free minutes for new users (verified);
- iFlytek: billed per transcription duration, free trial hours on registration, exact unit price unverified;
- Feishu Minutes: free tier for trials, subscription for advanced tiers, plans and quotas unverified;
- CapCut: basic caption recognition is free for regular users, but a membership/credits system exists; exact rules unverified;
- NetEase Sights: free quota exists but the exact figure is unverified (the official site is unreachable).

The local camp's core cost is "one-time hardware and setup" rather than "paying per minute transcribed". Whisper's official notes: tiny/base about 1 GB VRAM, small about 2 GB, medium about 5 GB, large about 10 GB (verified); whisper.cpp runs on pure CPU too, with the small model needing about 852 MB RAM (verified). Do the math: if you transcribe tens of hours a month, per-minute cloud billing quickly exceeds the time cost of a local setup; if it's just occasionally a clip or two, the cloud's "no install + draft in 5 minutes" is better value.

## Dimension 3: Chinese accuracy — don't be led around by "98%"

Commercial cloud accuracy claims are pretty: iFlytek self-reports accuracy up to 98% (verified, vendor self-measured); Huiying claims 90%+ on standard Chinese/English, dropping with accents and background music (verified, official FAQ admits it). Those numbers assume ideal recording conditions; real environments (dialects, BGM, overlapping speech, phone audio) degrade them noticeably — cloud and local alike.

The facts on the open-source side: Whisper's English strength vs. Chinese weakness is a long-standing pain point, especially in the large-model era; Alibaba's Qwen3-ASR surpasses Whisper-large-v3 across public Chinese benchmarks — WenetSpeech-net CER 4.97% vs 9.86%, AISHELL-2 2.71% vs 5.06% (verified against the official evaluation table), with the 1.7B claimed close to the strongest commercial APIs. In other words, **the stereotype that "local transcription is necessarily worse than cloud" is breaking down — for Chinese, prefer Qwen3-ASR over Whisper.** But be honest too: any "%" is just an average over ideal corpora; the final accuracy is always your own media's.

## Dimension 4: export formats — who gives SRT/ASS/VTT

Caption makers eventually all get stuck on formats:

- Whisper CLI natively exports SRT/VTT/TSV/TXT/JSON (verified);
- whisper.cpp also exports common caption formats (exact flags unverified);
- Huiying can download caption files and has an official tutorial for importing SRT into Premiere (verified);
- CapCut Pro can export caption files (exact format list unverified; commonly SRT/TXT);
- Feishu Minutes mainly exports transcripts/minutes rather than being a caption-production tool (unverified).

For post-production: if you're going into Premiere, fine-editing in CapCut, or doing bilingual overlays, choose something that hands you SRT/ASS/VTT directly; if you only need a transcript for notes or AI summarization, cloud "transcript" products are more convenient.

## How to choose: a decision table

- Occasional clip or two, convenience first, media not sensitive → CapCut or Huiying; the cloud is fastest with no install;
- Meeting minutes / interview organization, heavy Chinese usage, budget-sensitive → iFlytek (mature accuracy) or Feishu Minutes (team collaboration);
- Business secrets / unpublished content, high-frequency batch transcription → a local solution is mandatory;
- Among local solutions: Qwen3-ASR first for Chinese; faster-whisper for general English (up to 4× faster than vanilla Whisper, less memory, verified); whisper.cpp for low-spec machines or Apple silicon.

## Recut Audio Studio: a ready-made local caption path

If all those local engines sound like "environment fiddling", Recut Audio Studio turns "local transcription → captions" into an out-of-the-box product: it uses Qwen3-ASR locally to convert audio/video into timestamped captions and an editable transcript, exporting SRT/ASS/Markdown directly. No uploads, fully offline-capable; basic transcription runs on 16 GB RAM, CUDA 8 GB VRAM accelerates, and Apple silicon or CPU-only works too. It doesn't run cloud services, so cloud tools' capability boundaries (e.g. CapCut membership, iFlytek quotas) should be taken from the verified/unverified notes above — don't confuse them.

## Conclusion

There's no absolute winner between cloud and local: cloud wins on no-install, mature commercial Chinese accuracy and pay-as-you-go; local wins on media staying home, near-zero long-tail cost, and open-source Chinese accuracy approaching commercial APIs. Answer three questions first — is the media sensitive, how much do you transcribe monthly, do you need SRT/ASS caption files — and the answer follows naturally. Treat "privacy-first + high frequency + need caption files" as the bar for a local solution, and many creators will re-discover the Whisper family and Qwen3-ASR route.`,
  },
  "whisper-local-transcription-guide": {
    title: "Deploying Whisper for local transcription: from pip install to zero-config captions",
    description: "Whisper is OpenAI's open-source local transcription model, but deploying it means installing Python, downloading models and writing scripts. Recut Audio Studio turns it into a zero-config auto-caption tool — no uploads.",
    content: `Whisper is OpenAI's open-source speech-recognition model, and the most common answer behind the search term "local speech transcription": free, offline, good accuracy. But for non-developers, there's a lot of environment friction between \`pip install\` and actually getting a caption file.

## What running Whisper yourself involves

The typical path: install Python and pip, create a virtual environment, install openai-whisper and dependencies (including PyTorch), download model weights on first use, then use a command line to turn video into text. On Windows you also deal with the ffmpeg path; for more speed you configure the GPU. For someone who just wants to "turn a video into captions", the learning cost of this flow far exceeds the benefit.

## Recut Audio Studio: zero-config local transcription

Recut's "Audio Studio" App uses a local ASR model (Qwen and others) to provide the same kind of capability with all the environment issues wrapped away: installing prepares Python and FFmpeg automatically, models download on demand and work offline after that. Drop a talking-head, interview or course video into the workspace and you automatically get timestamped captions plus an editable transcript — no command line involved.

## Three ways to use the results

- Export SRT / ASS captions and load straight into CapCut or Premiere.

- Export a Markdown transcript for scripting, lecture notes and publishing.

- Combine with AI dubbing and transcript editing to chain "transcribe — review — dub — edit" into one local finished-video pipeline.

## Hardware requirements

Basic transcription is recommended with at least 16 GB RAM; an NVIDIA CUDA GPU with 8 GB+ VRAM speeds things up noticeably, while CPU-only and Apple silicon Macs work too, just slower.

## Conclusion

If what you need is local, offline, free video transcription, you don't have to start at the command line. Install Recut and Audio Studio, run your first caption, and leave the rest to the tool.`,
  },
};

function contentDir() {
  return path.join(process.cwd(), "content", "marketing", "zh");
}

function postDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function loadPosts(): MarketingPost[] {
  const dir = contentDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const { data, content } = matter(raw);
      const slug = file.replace(/\.mdx$/, "");
      const en = EN_POSTS[slug];
      const titleZh = String(data.title ?? "");
      const descriptionZh = String(data.description ?? "");
      const contentZh = content.trim();
      return {
        slug,
        date: postDate(data.date),
        title: { zh: titleZh, en: en?.title ?? titleZh },
        description: { zh: descriptionZh, en: en?.description ?? descriptionZh },
        content: { zh: contentZh, en: en?.content ?? contentZh },
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export const marketingPosts: MarketingPost[] = loadPosts();

export function getMarketingPost(slug: string): MarketingPost | null {
  return marketingPosts.find((post) => post.slug === slug) ?? null;
}

// 取某语言下可用标题（含缺失降级：缺该语言时返回 undefined 由调用方 notFound）。
export function postHasLocale(post: MarketingPost, locale: Locale): boolean {
  return Boolean(post.title[locale] && post.description[locale] && post.content[locale]);
}
