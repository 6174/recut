/*
 * [INPUT]: 不依赖浏览器、服务端或 UI 状态；依赖 locales.ts 的 Locale
 * [OUTPUT]: 对外提供官网首页的静态营销数据：常见问题（FAQ）与「三步开始」流程，按 Locale 逐语言；供页面渲染与首页 FAQPage JSON-LD 共用
 * [POS]: web/lib 的公开首页数据源；避免客户端组件与首页服务端页面各自维护一份 FAQ；en 为 default 面必须恒有内容
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "@/lib/i18n/locales";

export type HomeFaqItem = { question: string; answer: string };
export type HowItWorksItem = { step: string; title: string; description: string };

export const HOME_FAQ: Record<Locale, HomeFaqItem[]> = {
  zh: [
    {
      question: "Recut 是免费的吗？会不会限时或收费？",
      answer: "Recut 完全免费开源。安装、剪辑、AI 生成、字幕配音与扩展 App 都不按项目或时长计费，也没有云端积分墙；代码公开可审阅，可自部署长期使用。",
    },
    {
      question: "Recut 和剪映（CapCut）有什么区别？",
      answer: "剪映的 AI 字幕、配音、数字人等能力多在云端，需要上传素材并受时长和会员限制；Recut 让剪辑与 AI 生成都在你的电脑里运行，素材不上传、可离线使用，还支持用 JavaScript 扩展自己的工作流。",
    },
    {
      question: "我的视频素材会被上传到云端吗？",
      answer: "不会。Recut 本地优先：素材、项目与凭据都留在你的设备或自控的远程 service 上，AI 模型在本机运行。首次使用按需下载模型权重，之后断网也能继续剪辑与创作。",
    },
    {
      question: "Recut 需要什么电脑配置？",
      answer: "支持 macOS、Linux、Windows 与 FreeBSD。基础剪辑很轻量；本地转写字幕建议 16 GB 内存以上，创建声音角色和 AI 配音建议 32 GB；NVIDIA CUDA 显卡能显著加速转写与配音，Apple 芯片与纯 CPU 也能运行。",
    },
    {
      question: "我不会写代码，能使用 Recut 吗？",
      answer: "可以。官方应用已覆盖 AI 短片、时间线剪辑、自动字幕、AI 配音、封面与深度图等场景，安装后开箱即用。JavaScript 扩展是给进阶用户和团队的可选项，不是使用门槛。",
    },
    {
      question: "Recut 能做什么？支持 AI 视频生成吗？",
      answer: "能。AI 短片把选题变成可审阅的解说视频，声音工坊提供本地转写、字幕与 AI 配音，Worlds 保持角色与场景一致，还有 Remotion 程序化视频等应用；你还可以安装或自写 App 接入新的模型与工具。",
    },
  ],
  en: [
    {
      question: "Is Recut free? Will it become time-limited or paid?",
      answer: "Recut is completely free and open source. Installing, editing, AI generation, captions, dubbing and extension Apps are never billed per project or per minute, and there is no cloud credit wall; the code is public and auditable, and it can be self-hosted long-term.",
    },
    {
      question: "What's the difference between Recut and CapCut?",
      answer: "CapCut's AI captions, dubbing and avatars mostly run in the cloud — you upload media and hit length and membership limits. Recut runs editing and AI generation on your computer: no uploads, works offline, and you can extend your workflow with JavaScript.",
    },
    {
      question: "Will my video media be uploaded to the cloud?",
      answer: "No. Recut is local-first: media, projects and credentials stay on your device or a self-controlled remote service, and AI models run locally. Model weights download on demand at first use; after that you can keep editing and creating offline.",
    },
    {
      question: "What kind of computer does Recut need?",
      answer: "macOS, Linux, Windows and FreeBSD are supported. Basic editing is light; local caption transcription is recommended with 16 GB+ RAM, and creating voice characters plus AI dubbing with 32 GB+. An NVIDIA CUDA GPU noticeably accelerates transcription and dubbing; Apple silicon and CPU-only machines work too.",
    },
    {
      question: "I don't write code. Can I still use Recut?",
      answer: "Yes. Official Apps already cover AI short films, timeline editing, auto-captions, AI dubbing, covers and depth maps — install and go. JavaScript extension is an option for power users and teams, not a requirement.",
    },
    {
      question: "What can Recut do? Does it support AI video generation?",
      answer: "Yes. AI Short Films turns a topic into a reviewable narrated video, the Audio Studio provides local transcription, captions and AI dubbing, Worlds keeps characters and scenes consistent, and there are Remotion programmatic-video and more Apps. You can also install or write your own Apps to connect new models and tools.",
    },
  ],
};

export const HOW_IT_WORKS: Record<Locale, HowItWorksItem[]> = {
  zh: [
    { step: "01", title: "安装本地 service", description: "一条命令或安装包完成，支持 macOS、Linux、Windows 与 FreeBSD。" },
    { step: "02", title: "导入素材、选择应用", description: "导入你的素材，挑一个创作应用：AI 短片、声音工坊或 Remotion 视频。" },
    { step: "03", title: "生成、剪辑并导出", description: "生成与剪辑都在你的电脑里完成，断网也能继续，导出即成片。" },
  ],
  en: [
    { step: "01", title: "Install the local service", description: "Done in one command or installer, available on macOS, Linux, Windows and FreeBSD." },
    { step: "02", title: "Import media and pick an App", description: "Import your media and choose a creation App: AI Short Films, Audio Studio or Remotion Video." },
    { step: "03", title: "Generate, edit and export", description: "Generation and editing all happen on your computer, keep working offline, and export to a finished video." },
  ],
};
