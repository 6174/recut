/*
 * [INPUT]: 依赖 react、lucide-react、agent-panel-context（setDraft 交接契约）、lib/world-entity/guided
 * [OUTPUT]: 对外提供 GuidedAiSection：详情面板里的「用 AI 完善」动作区——按 ctx 过滤/排序动作、
 *   chip 行展示（收起 6 个 + 更多，展开按「生成 / 策划整理 / 文本检查」分组）、requires 置灰并给出原因、
 *   媒体显示推断解释，点击组装提示词交全局 AI 输入框（绝不自动发送）
 * [POS]: components/world-entity 的引导动作呈现层；实体与媒体两种 subject 共用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import {
  AudioLines,
  Camera,
  Clapperboard,
  FileText,
  Film,
  GitBranch,
  Image as ImageIcon,
  Languages,
  Layers,
  LayoutGrid,
  ListTree,
  MessageSquare,
  Mic,
  MountainSnow,
  Network,
  Package,
  Palette,
  Pencil,
  PersonStanding,
  PlusCircle,
  Quote,
  RotateCw,
  Scan,
  Scroll,
  Search,
  Send,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Shirt,
  Shuffle,
  Smile,
  Sparkles,
  Sun,
  SunMoon,
  Tag,
  Type,
  WandSparkles,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState, type ComponentType } from "react";

import { useAgentPanelContext } from "@/lib/agent-panel-context";
import { trackEvent } from "@/components/posthog-analytics";
import { PanelSection } from "@/components/panel-section";
import {
  actionsFor,
  buildActionText,
  draftIdFor,
  isActionEnabled,
  purposeExplanation,
  rankActions,
  type GuidedAiAction,
  type GuidedActionCategory,
  type GuidedPromptContext,
} from "@/lib/world-entity/guided";

const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  image: ImageIcon,
  clapperboard: Clapperboard,
  smile: Smile,
  "rotate-cw": RotateCw,
  shirt: Shirt,
  "audio-lines": AudioLines,
  "person-standing": PersonStanding,
  "shield-check": ShieldCheck,
  "shield-alert": ShieldAlert,
  quote: Quote,
  "wand-sparkles": WandSparkles,
  "share-2": Share2,
  mic: Mic,
  "message-square": MessageSquare,
  languages: Languages,
  "list-tree": ListTree,
  "mountain-snow": MountainSnow,
  package: Package,
  sun: Sun,
  "sun-moon": SunMoon,
  camera: Camera,
  scan: Scan,
  palette: Palette,
  layers: Layers,
  scroll: Scroll,
  "layout-grid": LayoutGrid,
  "file-text": FileText,
  zap: Zap,
  "git-branch": GitBranch,
  network: Network,
  send: Send,
  film: Film,
  type: Type,
  tag: Tag,
  search: Search,
  wrench: Wrench,
  shuffle: Shuffle,
  "plus-circle": PlusCircle,
  pencil: Pencil,
};

const INITIAL_VISIBLE = 6;

// 展开时按三大组呈现，避免一屏 20+ 个 chip
const GROUPS: Array<{ key: string; label: string; categories: GuidedActionCategory[] }> = [
  { key: "generate", label: "生成", categories: ["sheet", "derive"] },
  { key: "plan", label: "策划 / 整理", categories: ["plan", "structure"] },
  { key: "think", label: "文本 / 检查", categories: ["text", "qc", "transform", "sound", "research"] },
];

function iconFor(name: string): ComponentType<{ className?: string }> {
  return ICONS[name] ?? Sparkles;
}

export function GuidedAiSection({
  ctx,
  readOnly = false,
  divider = true,
  tone = "plain",
  first = false,
}: {
  ctx: GuidedPromptContext;
  readOnly?: boolean;
  /** 位于面板最顶部时传 false（不要分隔线） */
  divider?: boolean;
  /** section = 与面板其他分组同款（推荐）；card = 高亮卡片；plain = 内联 */
  tone?: "plain" | "card" | "section";
  /** section 模式下是否为面板首组（不画分隔线、抵消容器顶部 padding） */
  first?: boolean;
}) {
  const setDraft = useAgentPanelContext((state) => state.setDraft);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState("");

  const ranked = rankActions(ctx, actionsFor(ctx));
  if (!ranked.length) return null;
  const visible = expanded ? ranked : ranked.slice(0, INITIAL_VISIBLE);
  const hidden = ranked.length - visible.length;

  const trackBase = {
    subject: ctx.subject.kind,
    typeId: ctx.subject.kind === "entity" ? ctx.subject.entity.typeId : undefined,
    purpose: ctx.subject.kind === "media" ? ctx.subject.inferred.id : undefined,
    worldId: ctx.worldId,
  };

  const invoke = (action: GuidedAiAction, enabled: boolean) => {
    if (!enabled) return;
    setDraft({ id: draftIdFor(action, ctx), text: buildActionText(action, ctx) });
    trackEvent("recut_guided_action_invoked", { ...trackBase, actionId: action.id, category: action.category, outputKind: action.output.kind });
    setNotice(`「${action.label}」已填入输入框，确认后发送`);
    window.setTimeout(() => setNotice(""), 2400);
  };

  const showReason = (action: GuidedAiAction, reason?: string) => {
    trackEvent("recut_guided_action_blocked", { ...trackBase, actionId: action.id, reason });
    setNotice(`「${action.label}」暂不可用：${reason ?? "条件不满足"}`);
    window.setTimeout(() => setNotice(""), 2600);
  };

  const chip = (action: GuidedAiAction) => {
    const gate = isActionEnabled(action, ctx);
    const Icon = iconFor(action.icon);
    return (
      <button
        aria-disabled={!gate.ok}
        className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${gate.ok ? "hover:bg-muted" : "cursor-not-allowed opacity-50"}`}
        key={action.id}
        onClick={() => (gate.ok ? invoke(action, true) : showReason(action, gate.reason))}
        title={gate.ok ? action.desc ?? action.label : gate.reason}
        type="button"
      >
        <Icon className="size-3.5 shrink-0 text-primary" />
        <span className="truncate">{action.label}</span>
      </button>
    );
  };

  const explanation = purposeExplanation(ctx);
  const grouped = expanded
    ? GROUPS.map((group) => ({ ...group, actions: visible.filter((action) => group.categories.includes(action.category)) })).filter((group) => group.actions.length > 0)
    : [{ key: "flat", label: "", actions: visible }];

  const body = (
    <>
      {explanation && <p className="text-[10px] text-muted-foreground">{explanation}</p>}
      {grouped.map((group) => (
        <div key={group.key}>
          {group.label && <p className="mb-1 text-[10px] font-medium text-muted-foreground/80">{group.label}</p>}
          <div className="flex flex-wrap gap-1.5">{group.actions.map(chip)}</div>
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {hidden > 0 && (
          <button
            className="rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
            onClick={() => setExpanded(true)}
            type="button"
          >
            更多 {hidden}
          </button>
        )}
        {expanded && ranked.length > INITIAL_VISIBLE && (
          <button
            className="rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
            onClick={() => setExpanded(false)}
            type="button"
          >
            收起
          </button>
        )}
      </div>
      {notice && <p className="text-[10px] text-primary">{notice}</p>}
    </>
  );

  // section：与面板其他分组同款（不特殊化颜色）
  if (tone === "section") {
    return (
      <div className="hidden md:block">
        <PanelSection first={first} action={readOnly ? <span className="text-[10px] text-muted-foreground">只读世界 · 先 Fork 再写回</span> : undefined} title={`用 AI 完善（${ranked.length}）`}>
          {body}
        </PanelSection>
      </div>
    );
  }

  return (
    <div className={`hidden md:block ${tone === "card" ? "rounded-md border border-primary/20 bg-primary/5 p-3" : divider ? "border-t pt-3" : ""}`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-muted-foreground">用 AI 完善（{ranked.length}）</p>
        {readOnly && <span className="text-[10px] text-muted-foreground">只读世界 · 先 Fork 再写回</span>}
      </div>
      <div className="mt-2 space-y-2">{body}</div>
    </div>
  );
}
