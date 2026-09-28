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
