/*
 * [INPUT]: 依赖 Locale 与 LandingMetric/LandingStep；依据 Audio Studio 的本地 ASR、角色验证、配音验收和显式保存契约
 * [OUTPUT]: 对外提供 AudioStudioLanding
 * [POS]: Audio Studio 专属营销 Landing；以可听、可读、可验证的声音工作流组织多个功能分区
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Locale } from "@/lib/i18n";
import { LandingMetric, LandingStep } from "./landing-primitives";

const waveform = [18, 34, 25, 47, 30, 52, 23, 42, 29, 49, 22, 38, 31, 44, 27, 51, 35, 20, 46, 28];

export function AudioStudioLanding({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  return <section className="border-t border-white/10 pt-14">
    <section className="grid gap-8 lg:grid-cols-[.78fr_1.22fr] lg:items-end"><div><p className="font-mono text-[10px] font-semibold tracking-[.18em] text-primary">{zh ? "免费本地声音工具" : "FREE LOCAL VOICE TOOLS"}</p><h2 className="mt-4 text-3xl font-semibold leading-tight tracking-[-.04em] sm:text-5xl">{zh ? "先理解你的用户视频，再让它开口说话。" : "Understand your footage first. Then let it speak."}</h2><p className="mt-5 max-w-md text-sm leading-6 text-muted-foreground">{zh ? "免费、本地的 ASR 先理解视频里的语音；再用已授权声音克隆做语音解说、补录和配音，最后把字幕、文稿和 WAV 交回剪辑器继续剪。" : "Free local ASR understands the speech in your footage first. Then use an authorized cloned voice for narration, pickups and dubbing, and send captions, transcripts and WAVs back to the editor."}</p></div><TranscriptionConsole locale={locale} /></section>
    <section className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><VoiceCharacter locale={locale} /><DubbingQuality locale={locale} /></section>
    <SaveBoundary locale={locale} />
  </section>;
}

function TranscriptionConsole({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  return <article className="overflow-hidden rounded-2xl border border-white/10 bg-card"><header className="flex items-center justify-between border-b border-white/10 px-5 py-3 font-mono text-[9px] text-white/40"><span>TRANSCRIBE / LOCAL</span><span className="text-primary">READY</span></header><div className="grid gap-4 p-5 sm:grid-cols-[.66fr_1.34fr]"><div className="rounded-xl border border-white/10 bg-black/25 p-3"><LandingStep step="01" label={zh ? "选择本地 ASR" : "CHOOSE LOCAL ASR"} /><div className="mt-4 space-y-2"><Model name="Qwen3-ASR · 0.6B" selected /><Model name="Qwen3-ASR · 1.7B" /><Model name="Whisper · Large-v3" /></div><p className="mt-4 text-[10px] leading-5 text-white/45">{zh ? "Qwen3-ASR 与 Whisper 都在本机工作。" : "Qwen3-ASR and Whisper both run locally."}</p></div><div className="rounded-xl border border-white/10 bg-black/25 p-4"><div className="flex items-center justify-between font-mono text-[9px] text-white/35"><span>VOICE_014.wav</span><span>00:12.4</span></div><div className="mt-4 flex h-12 items-center gap-1">{waveform.map((height, index) => <span className="w-1.5 rounded-full bg-primary/70" key={index} style={{ height }} />)}</div><div className="mt-5 space-y-2 border-t border-white/10 pt-3 text-[11px] leading-5"><p><span className="mr-2 font-mono text-primary">00:00</span>{zh ? "今天，我们从声音开始组织故事。" : "Today, we begin with the voice."}</p><p className="text-white/45"><span className="mr-2 font-mono">00:04</span>{zh ? "每一段都能直接定位到时间。" : "Every line stays time-aligned."}</p></div><div className="mt-4 flex gap-2"><FileChip label="transcript.json" /><FileChip label="source.srt" /></div></div></div></article>;
}

function VoiceCharacter({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  return <article className="rounded-2xl border border-white/10 bg-card p-5 sm:p-6"><LandingStep step="02" label={zh ? "克隆自己的声音" : "CLONE YOUR OWN VOICE"} /><div className="mt-5 grid gap-5 sm:grid-cols-[.78fr_1.22fr]"><div><h3 className="text-xl font-semibold">{zh ? "用自己的声音，做可控的语音解说。" : "Make controlled narration with your own voice."}</h3><p className="mt-3 text-xs leading-5 text-muted-foreground">{zh ? "系统只截取 3–6 秒连续人声。波形和 CosyVoice 声纹都通过，才允许创建角色，避免拿一段噪音去生成整条视频旁白。" : "The system accepts only a continuous 3–6-second voice segment and validates its waveform and CosyVoice voiceprint before creating a character."}</p></div><div className="rounded-xl border border-white/10 bg-black/25 p-4"><p className="font-mono text-[9px] text-white/35">CHARACTER CANDIDATE</p><div className="mt-3 flex items-center gap-3"><div className="grid size-12 place-items-center rounded-full border border-primary/45 bg-primary/10 text-xs text-primary">VC</div><div className="min-w-0 flex-1"><div className="h-2 rounded bg-primary/70" /><div className="mt-2 h-1.5 w-3/4 rounded bg-white/15" /><p className="mt-3 font-mono text-[9px] text-primary">WAVEFORM + VOICEPRINT PASS</p></div></div></div></div></article>;
}

function DubbingQuality({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  return <article className="rounded-2xl border border-primary/25 bg-primary/[.055] p-5 sm:p-6"><LandingStep step="03" label={zh ? "回到剪辑器继续完成" : "RETURN TO THE EDITOR"} /><h3 className="mt-5 text-xl font-semibold">{zh ? "把文稿变成旁白、补录和配音。" : "Turn the transcript into narration, pickups and dubs."}</h3><p className="mt-3 text-xs leading-5 text-muted-foreground">{zh ? "无论是 CosyVoice 默认声音还是已验证角色，生成后的 WAV 会再次经 ASR 回读。确认文本保真后，声音和字幕一起回到剪辑器的时间线上。" : "Default CosyVoice voices and verified characters are read back by ASR. Once fidelity is confirmed, the WAV and captions return to the editor timeline together."}</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><LandingMetric title={zh ? "回读门槛" : "READ-BACK THRESHOLD"} value="ASR fidelity ≥ 0.85" /><LandingMetric title={zh ? "交付格式" : "DELIVERY"} value="WAV · captions · editor" /></div></article>;
}

function SaveBoundary({ locale }: { locale: Locale }) {
  const zh = locale === "zh";
  return <section className="mt-5 rounded-2xl border border-white/10 bg-card p-5 sm:p-7"><div className="grid gap-7 lg:grid-cols-[.75fr_1.25fr]"><div><p className="font-mono text-[10px] font-semibold tracking-[.18em] text-primary">PRIVATE → LIBRARY</p><h3 className="mt-4 text-2xl font-semibold tracking-[-.03em]">{zh ? "“生成完成”不等于“已经入库”。" : "Generated does not mean automatically saved."}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{zh ? "转写包、角色和配音都先在 App 私有区域试听与检查。只有你点击保存，才会成为可被其他项目使用的全局 Asset。" : "Transcripts, characters and dubbing remain in the App’s private area for review. Only your explicit Save creates a reusable global Asset."}</p></div><div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center"><div className="rounded-xl border border-white/10 bg-black/25 p-4"><p className="font-mono text-[9px] text-white/35">AUDIO STUDIO / PRIVATE</p><div className="mt-4 space-y-2"><FileChip label="voiceover.wav" /><FileChip label="transcript bundle" /></div></div><span className="justify-self-center text-2xl text-primary">→</span><div className="rounded-xl border border-primary/30 bg-primary/[.08] p-4"><p className="font-mono text-[9px] text-primary">RECUT MEDIA LIBRARY</p><div className="mt-4 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">{zh ? "确认保存为 Asset" : "SAVE AS AN ASSET"}</div></div></div></div></section>;
}

function Model({ name, selected }: { name: string; selected?: boolean }) { return <div className={`rounded-md border px-2.5 py-2 text-[10px] ${selected ? "border-primary/35 bg-primary/10 text-primary" : "border-white/10 bg-white/[.035] text-white/55"}`}>{name}</div>; }
function FileChip({ label }: { label: string }) { return <span className="inline-flex rounded-md border border-white/10 bg-white/[.04] px-2 py-1 font-mono text-[9px] text-white/60">{label}</span>; }
