/*
 * [INPUT]: 依赖 editor-features 的各模块演示组件；纯展示，不连接 service、不读取用户项目
 * [OUTPUT]: 对外提供 editorShowcase——editor App 的「小官网」特性清单：资源模块、自定义组件、字体与排版、AI 导演，每节都有对应局部 UI 演示
 * [POS]: web/components/app-showcase 的 editor 专属 showcase；editor 是第一个完整实现的 App，未来其他 App 在 registry 注册自己的 showcase
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "@/lib/i18n";
import type { AppShowcase } from "./types";
import { EditorAssetModuleDemo, EditorComponentDemo, EditorFontDemo, EditorDirectorDemo } from "@/components/app-demo/editor-features";

export const editorShowcase: AppShowcase = {
  features: [
    {
      id: "assets",
      title: (locale: Locale) => (locale === "zh" ? "资源模块" : "Asset module"),
      description: (locale: Locale) => (locale === "zh" ? "素材、文本、音频与组件统一进入一个库，拖入即可落到时间线，所有媒体与项目都留在你的机器上。" : "Media, text, audio and components live in one library; drop anything onto the timeline. Your media and projects stay on your machine."),
      demo: EditorAssetModuleDemo,
    },
    {
      id: "components",
      title: (locale: Locale) => (locale === "zh" ? "自定义组件" : "Custom components"),
      description: (locale: Locale) => (locale === "zh" ? "把重复的图形与信息做成可复用组件，参数由你改；每个组件都经过验证再进入成片。" : "Turn repeated graphics and info into reusable components with your own editable params; every component is verified before it lands in the cut."),
      demo: EditorComponentDemo,
    },
    {
      id: "typography",
      title: (locale: Locale) => (locale === "zh" ? "字体与排版" : "Fonts & typography"),
      description: (locale: Locale) => (locale === "zh" ? "标题、字幕与组件文字共享同一套排版系统，字重与字体切换即时可见。" : "Titles, captions and component text share one typographic system; weight and font changes are visible instantly."),
      demo: EditorFontDemo,
    },
    {
      id: "director",
      title: (locale: Locale) => (locale === "zh" ? "AI 导演" : "AI director"),
      description: (locale: Locale) => (locale === "zh" ? "用 Codex 或 Claude Code 描述创作意图，Agent 把它变成可审阅、可编辑、可撤销的剪辑操作；你不必先成为专业剪辑师。" : "Describe the intent to Codex or Claude Code; the Agent turns it into reviewable, editable, reversible edit operations — no professional editing background required."),
      demo: EditorDirectorDemo,
    },
  ],
};
