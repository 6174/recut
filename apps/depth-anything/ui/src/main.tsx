/**
 * [INPUT]: 依赖 Recut SDK、Depth operation、平台素材选择器、素材库上传 HTTP 与 React 状态
 * [OUTPUT]: 对外提供简洁的环境安装、模型下载、平台素材挑选与预览、应用内选择组件、可打开的图像/视频预览、全量历史、实时计时/日志和用户确认入库工作台
 * [POS]: depth-anything UI 编排层；仅在环境和选定模型就绪后开放推理，生成结果先留在 App 私有文件区
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Clock3, Download, FolderOpen, Image, LoaderCircle, Save, Send, Upload, Video, X } from "lucide-react";
import { recut } from "./recut-sdk";
import type { DepthOutput, MediaAsset, Model, OutputStyle, RuntimeStatus, ShellJob, SourceKind } from "./types";
import "./style.css";

const models: { id: Model; label: string; note: string }[] = [
  { id: "small", label: "Small", note: "最快，适合快速预览" },
  { id: "base", label: "Base", note: "质量与速度平衡" },
  { id: "large", label: "Large", note: "细节和视频稳定性更好" },
];

function App() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [outputs, setOutputs] = useState<DepthOutput[]>([]);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [sourceKind, setSourceKind] = useState<SourceKind>("image");
  const [assetId, setAssetId] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);
  const [model, setModel] = useState<Model>("small");
  const [style, setStyle] = useState<OutputStyle>("color");
  const [busy, setBusy] = useState<"prepare" | "install" | "generate" | "save" | "upload" | "agent" | null>(null);
  const [message, setMessage] = useState("正在启动…");
  const [activeJob, setActiveJob] = useState<{ id: string; action: "prepare" | "install" | "generate"; outputID?: string; startedAt: number } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [bottomTab, setBottomTab] = useState<"history" | "logs">("history");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [previewOutput, setPreviewOutput] = useState<DepthOutput | null>(null);
  const [failure, setFailure] = useState("");

  const refresh = useCallback(async (): Promise<RuntimeStatus | null> => {
    try {
      const nextStatus = await recut.state.query("depth.status") as RuntimeStatus;
      setStatus(nextStatus);
      setMessage(nextStatus.ready ? "请选择要下载的模型。" : "正在启动…");
      try { setOutputs(await recut.state.query("depth.list") as DepthOutput[]); }
      catch (error) { setMessage(error instanceof Error ? error.message : "无法读取历史输出。"); }
      return nextStatus;
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法读取 Depth Anything 状态。"); }
    return null;
  }, []);

  const loadAssets = useCallback(async (): Promise<MediaAsset[]> => {
    const response = await fetch("/v1/media/assets");
    if (!response.ok) throw new Error("无法读取素材库。");
    const next = await response.json() as MediaAsset[];
    const completed = next.filter((asset) => asset.status === "completed" && (asset.kind === "image" || asset.kind === "video"));
    setAssets(completed); return completed;
  }, []);

  useEffect(() => { window.addEventListener("recut-sdk-ready", refresh); void refresh(); return () => window.removeEventListener("recut-sdk-ready", refresh); }, [refresh]);
  useEffect(() => { void loadAssets().catch((error) => setMessage(error.message)); }, [loadAssets]);
  useEffect(() => {
    if (!activeJob) return;
    const updateElapsed = () => setElapsedSeconds(Math.floor((Date.now() - activeJob.startedAt) / 1000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [activeJob]);
  useEffect(() => recut.events.subscribe((raw) => {
    const event = raw as { type?: string; log?: { jobId?: string; text?: string }; job?: ShellJob };
    if (event.type === "shell.job.log" && event.log?.jobId === activeJob?.id) setLogs((items) => [...items, event.log?.text || ""].slice(-80));
    if (event.type !== "shell.job.completed" || event.job?.id !== activeJob?.id) return;
    const completed = event.job;
    if (completed.status !== "completed") {
      const error = completed.error || "本地任务未完成。";
      setFailure(error); setMessage(error); setBusy(null); setActiveJob(null); return;
    }
    void (async () => {
      try {
        if (activeJob.action === "generate" && activeJob.outputID) {
          const output = await recut.background.call("depth.complete", { id: activeJob.outputID }) as DepthOutput;
          setOutputs((items) => [output, ...items.filter((item) => item.id !== output.id)]); setMessage("深度预览已生成，尚未进入素材库。");
        } else {
          const nextStatus = await refresh();
          if (!nextStatus?.ready) {
            const error = nextStatus?.error || "运行环境检查尚未完成，请重新尝试。";
            setFailure(error); setMessage(error); return;
          }
          setMessage(activeJob.action === "prepare" ? "运行环境已就绪，请选择要下载的模型。" : "模型下载完成，可以开始转换。");
        }
      } catch (error) { setMessage(error instanceof Error ? error.message : "任务完成后无法刷新状态。"); }
      finally { setBusy(null); setActiveJob(null); }
    })();
  }), [activeJob, refresh]);

  const compatibleAssets = useMemo(() => assets.filter((asset) => asset.kind === sourceKind), [assets, sourceKind]);
  const sourceAsset = selectedAsset?.id === assetId ? selectedAsset : compatibleAssets.find((asset) => asset.id === assetId) ?? null;
  const readyModel = Boolean(status?.installedModels.includes(model));
  const currentOutput = outputs[0];

  const beginJob = (job: ShellJob, action: "prepare" | "install" | "generate", outputID?: string) => {
    setElapsedSeconds(0);
    setActiveJob({ id: job.id, action, outputID, startedAt: Date.now() });
  };

  const install = async () => {
    setBusy("install");
    setFailure("");
    setBottomTab("logs");
    setLogs([]);
    setMessage(`正在安装运行环境并下载 ${models.find((item) => item.id === model)?.label} 模型…`);
    try { const result = await recut.background.call("depth.install", { model }) as { job: ShellJob }; beginJob(result.job, "install"); setMessage(`正在下载 ${models.find((item) => item.id === model)?.label} 模型…`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "安装失败。"); setBusy(null); }
  };

  const prepare = useCallback(async () => {
    setBusy("prepare");
    setFailure("");
    setBottomTab("logs");
    setLogs([]);
    setMessage("正在启动…");
    try { const result = await recut.background.call("depth.prepare") as { job: ShellJob }; beginJob(result.job, "prepare"); }
    catch (error) { const message = error instanceof Error ? error.message : "暂时无法启动。"; setFailure(message); setMessage(message); setBusy(null); }
  }, []);

  const generate = async () => {
    if (!assetId) return setMessage("先选择一张图片或一个视频素材。");
    setBusy("generate");
    setBottomTab("logs");
    setLogs([]);
    setMessage(sourceKind === "video" ? "正在逐帧计算深度图，视频处理会花更长时间。" : "正在生成深度图…");
    try { const result = await recut.background.call("depth.generate", { assetId, kind: sourceKind, model, style }) as { job: ShellJob; output: { id: string } }; beginJob(result.job, "generate", result.output.id); }
    catch (error) { setMessage(error instanceof Error ? error.message : "生成失败。"); setBusy(null); }
  };

  const chooseSource = async () => {
    try {
      const selected = await recut.media.pick([sourceKind]) as MediaAsset | null;
      if (!selected) return;
      setAssets((items) => items.some((asset) => asset.id === selected.id) ? items : [selected, ...items]);
      setSelectedAsset(selected); setAssetId(selected.id); setMessage(`已选择${sourceKind === "image" ? "图片" : "视频"}素材：${selected.name}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法打开素材选择器。"); }
  };

  const save = async (output: DepthOutput) => {
    setBusy("save");
    try { const result = await recut.background.call("depth.save", { id: output.id }) as { assetId: string }; setOutputs((items) => items.map((item) => item.id === output.id ? { ...item, savedAssetId: result.assetId } : item)); setMessage("已保存到素材库。"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "保存失败。"); }
    finally { setBusy(null); }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith(`${sourceKind}/`)) return setMessage(`请上传${sourceKind === "image" ? "图片" : "视频"}文件。`);
    setBusy("upload");
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/v1/media/assets", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.error || "上传失败。");
      const nextAssets = await loadAssets(); const selected = nextAssets.find((asset) => asset.id === payload.id) ?? { id: payload.id, name: file.name, kind: sourceKind, mimeType: file.type, status: "completed" };
      setSelectedAsset(selected); setAssetId(payload.id); setMessage("输入素材已加入素材库并选中。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "上传失败。"); }
    finally { setBusy(null); }
  };

  const askAgent = async () => {
    setBusy("agent");
    try { await recut.agent.send(`Depth Anything 本地依赖检查或安装失败。请检查并解决这个错误，然后告诉我可以如何继续：${status?.error || message}`); setMessage("诊断已发送到右侧 Codex。 "); }
    catch (error) { setMessage(error instanceof Error ? error.message : "无法发送诊断请求。"); }
    finally { setBusy(null); }
  };

  if (!status?.ready) return <Setup busy={busy} elapsedSeconds={elapsedSeconds} failure={failure || (!status?.pending ? status?.error || "" : "")} logs={logs} message={message} onPrepare={() => void prepare()} onAskAgent={() => void askAgent()} />;
  return <main className="app-shell"><header className="app-header"><div><p className="eyebrow">RECUT APP / LOCAL DEPTH</p><h1>Depth Anything</h1><p>将图片或视频转换为深度图。预览不会自动进入素材库。</p></div></header><section className="workspace"><div className="controls"><SectionTitle label="输入" title="选择素材" /><div className="segmented">{(["image", "video"] as SourceKind[]).map((kind) => <button className={sourceKind === kind ? "selected" : ""} key={kind} onClick={() => { setSourceKind(kind); setAssetId(""); setSelectedAsset(null); }} type="button">{kind === "image" ? <Image size={15} /> : <Video size={15} />}{kind === "image" ? "图片" : "视频"}</button>)}</div><p className="field-label">素材库</p><button className="secondary-button" disabled={busy !== null} onClick={() => void chooseSource()} type="button"><FolderOpen size={15} />{sourceAsset ? "更换素材" : `从素材库选择${sourceKind === "image" ? "图片" : "视频"}`}</button>{sourceAsset && <SelectedSource asset={sourceAsset} />}<label className="upload-control"><Upload size={15} />上传{sourceKind === "image" ? "图片" : "视频"}<input accept={`${sourceKind}/*`} onChange={(event) => void upload(event.target.files?.[0])} type="file" /></label><SectionTitle label="模型" title="本地权重" /><p className="field-label">模型尺寸</p><AppSelect ariaLabel="模型尺寸" disabled={busy !== null} onChange={setModel} options={models} value={model} />{readyModel ? <p className="model-ready"><Check size={14} />已下载</p> : <button className="secondary-button" disabled={busy !== null} onClick={() => void install()} type="button"><Download size={15} />下载此模型</button>}<SectionTitle label="输出" title="深度图样式" /><div className="segmented">{(["color", "grayscale"] as OutputStyle[]).map((item) => <button className={style === item ? "selected" : ""} key={item} onClick={() => setStyle(item)} type="button">{item === "color" ? "伪彩" : "灰度"}</button>)}</div><button className="primary-button" disabled={busy !== null || !assetId || !readyModel} onClick={() => void generate()} type="button">{busy === "generate" ? <LoaderCircle className="spin" size={16} /> : <Image size={16} />}{busy === "generate" ? "正在生成…" : "生成深度图"}</button></div><OutputPanel output={currentOutput} busy={busy} onSave={save} /></section><BottomPanel activeTab={bottomTab} elapsedSeconds={elapsedSeconds} logs={logs} outputs={outputs} busy={busy} onPreview={setPreviewOutput} onSave={save} onTabChange={setBottomTab} /><p className="status" role="status">{message}</p>{previewOutput && <PreviewDialog output={previewOutput} onClose={() => setPreviewOutput(null)} />}</main>;
}

function SelectedSource({ asset }: { asset: MediaAsset }) { const source = `/v1/media/assets/${encodeURIComponent(asset.id)}/content`; return <figure className="source-preview"><div>{asset.kind === "image" ? <img alt={`已选素材：${asset.name}`} src={source} /> : <video controls preload="metadata" src={source} />}</div><figcaption><strong>{asset.name}</strong><span>{asset.kind === "image" ? "图片" : "视频"} · 已选择</span></figcaption></figure>; }

function Setup({ busy, elapsedSeconds, failure, logs, message, onPrepare, onAskAgent }: { busy: string | null; elapsedSeconds: number; failure: string; logs: string[]; message: string; onPrepare: () => void; onAskAgent: () => void }) {
  const started = useRef(false);
  useEffect(() => { if (!started.current) { started.current = true; onPrepare(); } }, [onPrepare]);
  return <main className="setup"><div className="setup-mark"><LoaderCircle className="spin" size={22} /></div><p className="eyebrow">DEPTH ANYTHING</p><h1>正在启动</h1><p>首次使用需要一点时间，完成后即可选择模型并开始转换。</p>{busy === "prepare" && <><JobTimer elapsedSeconds={elapsedSeconds} /><pre className="job-log" aria-label="准备过程">{logs.length ? logs.join("") : "正在连接…"}</pre></>}{failure && <div className="error-box"><strong>暂时无法启动</strong><pre>{failure}</pre><button className="link-button" disabled={busy !== null} onClick={onAskAgent} type="button"><Send size={14} />交给右侧 Codex 处理</button></div>}<button className="secondary-button" disabled={busy !== null} onClick={onPrepare} type="button">{busy === "prepare" ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}{busy === "prepare" ? "正在启动…" : "重新尝试"}</button><p className="status" role="status">{message}</p></main>;
}

function OutputPanel({ output, busy, onSave }: { output?: DepthOutput; busy: string | null; onSave: (output: DepthOutput) => void }) {
  return <section className="output-panel"><header><SectionTitle label="预览" title="本次输出" />{output && <span className={output.savedAssetId ? "saved-pill" : "private-pill"}>{output.savedAssetId ? "已保存" : "私有预览"}</span>}</header><div className="preview">{output ? output.kind === "image" ? <img alt="本次生成的深度图" src={output.previewURL} /> : <video controls src={output.previewURL} /> : <div className="empty"><Image size={28} /><p>选择素材并生成后，深度预览会显示在这里。</p></div>}</div>{output && <footer><div><strong>{models.find((item) => item.id === output.model)?.label} · {output.style === "color" ? "伪彩" : "灰度"}</strong><span>先预览，再自行决定是否保存到素材库。</span></div>{output.savedAssetId ? <span className="saved-copy"><Check size={15} />素材库已保存</span> : <button className="primary-button compact" disabled={busy !== null} onClick={() => onSave(output)} type="button">{busy === "save" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存到素材库</button>}</footer>}</section>;
}

function BottomPanel({ activeTab, elapsedSeconds, logs, outputs, busy, onPreview, onSave, onTabChange }: { activeTab: "history" | "logs"; elapsedSeconds: number; logs: string[]; outputs: DepthOutput[]; busy: string | null; onPreview: (output: DepthOutput) => void; onSave: (output: DepthOutput) => void; onTabChange: (tab: "history" | "logs") => void }) { const running = busy === "prepare" || busy === "install" || busy === "generate"; return <section className="bottom-panel"><div className="bottom-tabs" role="tablist" aria-label="输出记录"><button aria-controls="depth-history" aria-selected={activeTab === "history"} id="depth-history-tab" onClick={() => onTabChange("history")} role="tab" type="button">历史 <span>{outputs.length}</span></button><button aria-controls="depth-logs" aria-selected={activeTab === "logs"} id="depth-logs-tab" onClick={() => onTabChange("logs")} role="tab" type="button">执行日志 <span>{logs.length}</span></button></div><div className="bottom-panel-content">{activeTab === "history" ? <History outputs={outputs} busy={busy} onPreview={onPreview} onSave={onSave} /> : <div aria-labelledby="depth-logs-tab" id="depth-logs" role="tabpanel">{running && <JobTimer elapsedSeconds={elapsedSeconds} />}<pre className="job-log">{logs.length ? logs.join("") : "正在等待任务输出…"}</pre></div>}</div></section>; }

function History({ outputs, busy, onPreview, onSave }: { outputs: DepthOutput[]; busy: string | null; onPreview: (output: DepthOutput) => void; onSave: (output: DepthOutput) => void }) { return <div aria-labelledby="depth-history-tab" id="depth-history" role="tabpanel"><header className="history-header"><SectionTitle label="历史" title="全部输出" /><span>{outputs.length} 条</span></header>{outputs.length ? <div className="history-grid">{outputs.map((output) => <article className="history-card" key={output.id} onClick={() => onPreview(output)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPreview(output); } }} role="button" tabIndex={0}><div className="thumb">{output.kind === "image" ? <img alt="历史深度图" src={output.previewURL} /> : <video muted preload="metadata" src={output.previewURL} />}</div><div><strong>{models.find((item) => item.id === output.model)?.label} · {output.kind === "image" ? "图片" : "视频"}</strong><span>{new Date(output.createdAt).toLocaleString("zh-CN")}</span>{output.savedAssetId ? <em>已保存到素材库</em> : <button className="text-button" disabled={busy !== null} onClick={(event) => { event.stopPropagation(); onSave(output); }} type="button"><Save size={13} />保存到素材库</button>}</div></article>)}</div> : <p className="empty-history">还没有历史输出。</p>}</div>; }

function JobTimer({ elapsedSeconds }: { elapsedSeconds: number }) { return <p className="job-timer"><Clock3 size={14} />任务运行中 · {formatElapsed(elapsedSeconds)}</p>; }

function PreviewDialog({ output, onClose }: { output: DepthOutput; onClose: () => void }) { return <div className="preview-dialog-backdrop" onMouseDown={onClose} role="presentation"><section aria-label="深度输出预览" aria-modal="true" className="preview-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog"><header><div><p className="eyebrow">DEPTH OUTPUT</p><h2>{models.find((item) => item.id === output.model)?.label} · {output.kind === "image" ? "图片" : "视频"}</h2></div><button aria-label="关闭预览" className="icon-button" onClick={onClose} type="button"><X size={16} /></button></header><div className="preview-dialog-media">{output.kind === "image" ? <img alt="历史深度图预览" src={output.previewURL} /> : <video autoPlay controls playsInline src={output.previewURL} />}</div></section></div>; }

function AppSelect<T extends string>({ ariaLabel, disabled, onChange, options, value }: { ariaLabel: string; disabled?: boolean; onChange: (value: T) => void; options: { id: T; label: string; note: string }[]; value: T }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.id === value) ?? options[0];
  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    if (open) document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);
  return <div className="app-select" ref={root}><button aria-expanded={open} aria-haspopup="listbox" aria-label={ariaLabel} className="app-select-trigger" disabled={disabled} onClick={() => setOpen((visible) => !visible)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} type="button"><span><strong>{selected.label}</strong><small>{selected.note}</small></span><ChevronDown className={open ? "rotate" : ""} size={16} /></button>{open && <div aria-label={ariaLabel} className="app-select-menu" role="listbox">{options.map((option) => <button aria-selected={option.id === value} key={option.id} onClick={() => { onChange(option.id); setOpen(false); }} role="option" type="button"><span><strong>{option.label}</strong><small>{option.note}</small></span>{option.id === value && <Check size={15} />}</button>)}</div>}</div>;
}

function formatElapsed(totalSeconds: number) { const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0"); const seconds = (totalSeconds % 60).toString().padStart(2, "0"); return `${minutes}:${seconds}`; }

function SectionTitle({ label, title }: { label: string; title: string }) { return <div className="section-title"><span>{label}</span><h2>{title}</h2></div>; }

createRoot(document.getElementById("root")!).render(<App />);
