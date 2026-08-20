/*
 * [INPUT]: 依赖 Locale 与 LandingStep；依据 Vox B-roll 的立项、研究、人工闸门、场景生成、确定性交付和交接包契约
 * [OUTPUT]: 对外提供 VoxBrollLanding
 * [POS]: Vox B-roll 专属营销 Landing；用纵向创作闸门和双轨交付台表达真实短片工作流，不与其他 App 共享主体布局
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "@/lib/i18n";
import { LandingStep } from "./landing-primitives";

const steps = ["立项", "资料研究", "创作方案", "剧本与场景", "视觉与声音", "场景视频"];

export function VoxBrollLanding({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  return <section className="border-t border-white/10 pt-14">
    <header className="mx-auto max-w-3xl text-center">
      <p className="font-mono text-[10px] font-semibold tracking-[.18em] text-primary">{zh ? "AI 短片导演台" : "AI SHORT-FILM DIRECTOR"}</p>
      <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-[-.04em] sm:text-5xl">{zh ? "不是一键生成。是一个可审阅的短片制作流程。" : "Not one-click video. A reviewable film workflow."}</h2>
      <p className="mx-auto mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">{zh ? "从资料证据、导演方法到每一段昂贵的场景视频，AI 只推进当前允许的一步。你在两个关键点做决定，最后得到可继续创作的项目和交接包。" : "From research evidence to direction and expensive scene generation, AI advances only one allowed step. You decide at two critical gates, then receive an editable project and handoff package."}</p>
    </header>

    <section className="relative mx-auto mt-12 max-w-4xl">
      <div className="absolute bottom-8 left-5 top-8 w-px bg-gradient-to-b from-primary/70 via-primary/20 to-transparent sm:left-1/2" />
      <div className="space-y-4">
        <FilmBrief locale={locale} />
        <ResearchGate locale={locale} />
        <ProposalGate locale={locale} />
        <SceneProduction locale={locale} />
      </div>
    </section>

    <DeliveryDesk locale={locale} />
  </section>;
}

function FilmBrief({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  return <article className="relative grid gap-4 rounded-2xl border border-white/10 bg-card p-5 sm:grid-cols-[.78fr_1.22fr] sm:p-6">
    <span className="relative z-10 grid size-10 place-items-center rounded-full border border-primary/45 bg-primary text-xs font-bold text-primary-foreground sm:absolute sm:left-1/2 sm:top-6 sm:-translate-x-1/2">01</span>
    <div className="sm:pr-8"><LandingStep step="START" label={zh ? "冻结立项" : "LOCK THE BRIEF"} /><h3 className="mt-4 text-xl font-semibold">{zh ? "先把这支片子讲清楚。" : "First, make the film explicit."}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{zh ? "选题、画幅、时长和导演模板写入项目，之后的每个场景都遵守这份简报。" : "Topic, format, duration and director template become the project brief every later scene follows."}</p></div>
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/25 p-3 font-mono text-[10px] text-white/55">
      <BriefCell label="TOPIC" value={zh ? "城市里的孤独" : "Loneliness in cities"} />
      <BriefCell label="FORMAT" value="9:16 · 60s" />
      <BriefCell label="DIRECTOR" value="editorial-vox" />
      <BriefCell label="STATUS" value={zh ? "已冻结" : "LOCKED"} accent />
    </div>
  </article>;
}

function ResearchGate({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  return <article className="relative grid gap-4 rounded-2xl border border-white/10 bg-card p-5 sm:grid-cols-[1.2fr_.8fr] sm:p-6">
    <span className="relative z-10 grid size-10 place-items-center rounded-full border border-white/20 bg-[#151c1b] text-xs font-bold text-white/70 sm:absolute sm:left-1/2 sm:top-6 sm:-translate-x-1/2">02</span>
    <div className="order-2 sm:order-1 sm:pr-8"><div className="grid grid-cols-3 gap-2">{["Article", "Video", "Web"].map((source, index) => <div className="rounded-lg border border-white/10 bg-white/[.035] p-3" key={source}><span className={`block h-8 rounded ${index === 0 ? "bg-[#80725d]" : index === 1 ? "bg-[#485f72]" : "bg-[#744d57]"}`} /><p className="mt-2 font-mono text-[8px] text-white/45">REFERENCE / 0{index + 1}</p><p className="mt-1 text-[10px] text-white/70">{source}</p></div>)}</div><p className="mt-3 text-[11px] leading-5 text-white/45">{zh ? "文章、网页与视频资料先变成可审阅、可复用的全局 reference Asset，而不是散落在提示词里。" : "Articles, webpages and videos become reviewable, reusable global reference Assets—not fragments lost inside a prompt."}</p></div>
    <div className="order-1 sm:order-2 sm:pl-8"><LandingStep step="RESEARCH" label={zh ? "资料库先于创意" : "RESEARCH BEFORE CONCEPT"} /><h3 className="mt-4 text-xl font-semibold">{zh ? "证据够不够，由你确认。" : "You decide when evidence is enough."}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{zh ? "至少三条不同来源；AI 不能自行越过这道闸门开始写创意。" : "At least three independent sources; AI cannot cross this gate and start creating on its own."}</p><GateLabel text={zh ? "用户确认资料研究" : "USER APPROVES RESEARCH"} /></div>
  </article>;
}

function ProposalGate({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  return <article className="relative rounded-2xl border border-primary/30 bg-primary/[.055] p-5 sm:p-6">
    <span className="relative z-10 grid size-10 place-items-center rounded-full border border-primary/45 bg-primary text-xs font-bold text-primary-foreground sm:absolute sm:left-1/2 sm:top-6 sm:-translate-x-1/2">03</span>
    <div className="grid gap-5 sm:grid-cols-[.7fr_1.3fr]"><div className="sm:pr-8"><LandingStep step="PROPOSALS" label={zh ? "选择叙事方案" : "CHOOSE A DIRECTION"} /><h3 className="mt-4 text-xl font-semibold">{zh ? "先比较几个讲法，再写剧本。" : "Compare approaches before writing the script."}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{zh ? "不是让模型暗中挑一个方案。你的选择才会打开剧本与约 5 秒场景计划。" : "The model does not secretly pick a direction. Your selection unlocks the script and ~5-second scene plan."}</p><GateLabel text={zh ? "用户选定创作方案" : "USER SELECTS A PROPOSAL"} /></div><div className="grid gap-2 sm:grid-cols-3">{["01 · essay", "02 · character", "03 · archive"].map((title, index) => <div className={`rounded-xl border p-3 ${index === 1 ? "border-primary/55 bg-primary/10" : "border-white/10 bg-black/20"}`} key={title}><p className="font-mono text-[9px] text-white/45">{title}</p><div className={`mt-5 h-12 rounded-lg ${index === 0 ? "bg-[linear-gradient(135deg,#c4a071,#37575c)]" : index === 1 ? "bg-[linear-gradient(135deg,#3c6670,#d48b62)]" : "bg-[linear-gradient(135deg,#5c4d70,#b3b875)]"}`} /><p className="mt-3 text-[10px] text-white/65">{index === 1 ? (zh ? "已选定" : "SELECTED") : (zh ? "候选方案" : "CANDIDATE")}</p></div>)}</div></div>
  </article>;
}

function SceneProduction({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  return <article className="relative grid gap-5 rounded-2xl border border-white/10 bg-card p-5 sm:grid-cols-[1.25fr_.75fr] sm:p-6">
    <span className="relative z-10 grid size-10 place-items-center rounded-full border border-white/20 bg-[#151c1b] text-xs font-bold text-white/70 sm:absolute sm:left-1/2 sm:top-6 sm:-translate-x-1/2">04</span>
    <div className="sm:pr-8"><LandingStep step="SCENE PRODUCTION" label={zh ? "一次只做下一段" : "ONE NEXT SCENE"} /><div className="mt-4 grid grid-cols-3 gap-2">{steps.map((step, index) => <div className={`rounded-lg border px-2 py-3 ${index === 5 ? "border-primary/50 bg-primary/[.11]" : "border-white/10 bg-black/20"}`} key={step}><p className="font-mono text-[8px] text-white/35">0{index + 1}</p><p className="mt-1 text-[10px] text-white/75">{zh ? step : ["Brief", "Research", "Direction", "Script", "Look + sound", "Scene video"][index]}</p></div>)}</div><p className="mt-3 text-[11px] leading-5 text-white/45">{zh ? "关键画面、声音设计和场景视频沿同一条线推进。昂贵的视频默认只生成下一段，满意后才继续。" : "Keyframes, sound design and scene video advance in one line. Expensive video generates one next scene by default, then waits for your approval."}</p></div>
    <div className="sm:pl-8"><div className="overflow-hidden rounded-xl border border-white/10 bg-black/35 p-3"><div className="flex items-center justify-between font-mono text-[9px] text-white/35"><span>SCENE 03</span><span>05.0s</span></div><div className="mt-3 aspect-video rounded-lg bg-[radial-gradient(circle_at_65%_35%,#d2a16c_0_10%,transparent_28%),linear-gradient(135deg,#23464a,#221d2b)]" /><div className="mt-3 flex items-center gap-2"><span className="size-2 rounded-full bg-primary shadow-[0_0_10px_#8ee9a6]" /><span className="text-[10px] text-primary">{zh ? "等待确认后继续" : "WAITING FOR APPROVAL"}</span></div></div></div>
  </article>;
}

function DeliveryDesk({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  return <section className="mt-14 overflow-hidden rounded-2xl border border-white/10 bg-card p-5 sm:p-7"><div className="grid gap-7 lg:grid-cols-[.76fr_1.24fr]"><div><p className="font-mono text-[10px] font-semibold tracking-[.18em] text-primary">DELIVERY.EXPORT</p><h3 className="mt-4 text-2xl font-semibold tracking-[-.03em]">{zh ? "最后一段不是 AI 猜的。" : "The last mile is not AI guesswork."}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{zh ? "成片交付只组装已确认的视频与声音轨：能调整顺序、设置画幅、24/30 FPS 与质量，然后由 media.compose 确定性生成成片。" : "Delivery only assembles approved video and audio tracks: reorder them, select format, 24/30 FPS and quality, then compose deterministically."}</p><p className="mt-5 rounded-lg border border-primary/25 bg-primary/[.07] px-3 py-2 text-xs leading-5 text-primary">{zh ? "同时可发布不可变短片交接包，交给 Remotion Studio 继续代码化编排。" : "You can also publish an immutable film handoff package for continued work in Remotion Studio."}</p></div><div className="rounded-xl border border-white/10 bg-black/25 p-4"><div className="flex items-center justify-between font-mono text-[9px] text-white/40"><span>FINAL CUT</span><span>01:00 · 16:9 · 30 FPS</span></div><TimelineLane label="VIDEO" colors={["#b66c4e", "#4c7d72", "#476679"]} widths={[35, 27, 38]} /><TimelineLane label="AUDIO" colors={["rgba(142,233,166,.5)", "rgba(142,233,166,.3)"]} widths={[58, 42]} small /><div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4"><span className="font-mono text-[9px] text-white/40">media.compose</span><span className="rounded-md bg-primary px-3 py-2 text-[10px] font-semibold text-primary-foreground">{zh ? "导出真实 MP4" : "EXPORT REAL MP4"}</span></div></div></div></section>;
}

function BriefCell({ accent, label, value }: { accent?: boolean; label: string; value: string }) { return <div className="rounded-lg border border-white/10 bg-white/[.035] p-2.5"><p className="text-[8px] text-white/35">{label}</p><p className={`mt-2 truncate text-[10px] ${accent ? "text-primary" : "text-white/70"}`}>{value}</p></div>; }
function GateLabel({ text }: { text: string }) { return <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/[.08] px-3 py-1.5 font-mono text-[9px] font-semibold tracking-[.08em] text-primary"><span className="size-1.5 rounded-full bg-primary" />{text}</p>; }
function TimelineLane({ colors, label, small, widths }: { colors: string[]; label: string; small?: boolean; widths: number[] }) { return <div className="mt-4 flex items-center gap-3"><span className="w-9 font-mono text-[8px] text-white/35">{label}</span><div className={`flex flex-1 gap-1 rounded border border-white/10 bg-black/25 p-1 ${small ? "h-6" : "h-11"}`}>{widths.map((width, index) => <span className="rounded" key={`${label}-${index}`} style={{ backgroundColor: colors[index], width: `${width}%` }} />)}</div></div>; }
