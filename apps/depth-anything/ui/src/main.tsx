/**
 * [INPUT]: 依赖 Recut SDK、Depth operation、素材库上传 HTTP 与 React 状态
 * [OUTPUT]: 对外提供独立的环境安装、模型下载、图像/视频深度预览与用户确认入库工作台
 * [POS]: depth-anything UI 编排层；仅在环境和选定模型就绪后开放推理，生成结果先留在 App 私有文件区
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Image, LoaderCircle, Save, Send, SlidersHorizontal, Upload, Video } from "lucide-react";
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
  const [model, setModel] = useState<Model>("small");
  const [style, setStyle] = useState<OutputStyle>("color");
  const [busy, setBusy] = useState<"prepare" | "install" | "generate" | "save" | "upload" | "agent" | null>(null);
  const [message, setMessage] = useState("正在检查本地运行环境…");
  const [activeJob, setActiveJob] = useState<{ id: string; action: "prepare" | "install" | "generate"; outputID?: string } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextOutputs] = await Promise.all([recut.state.query("depth.status"), recut.state.query("depth.list")]);
      setStatus(nextStatus as RuntimeStatus);
      setOutputs(nextOutputs as DepthOutput[]);
      setMessage((nextStatus as RuntimeStatus).ready ? "环境已就绪。" : "需要先完成本地依赖检查。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法读取 Depth Anything 状态。"); }
  }, []);

  const loadAssets = useCallback(async () => {
    const response = await fetch("/v1/media/assets");
    if (!response.ok) throw new Error("无法读取素材库。");
    const next = await response.json() as MediaAsset[];
    setAssets(next.filter((asset) => asset.status === "completed" && (asset.kind === "image" || asset.kind === "video")));
  }, []);

  useEffect(() => { window.addEventListener("recut-sdk-ready", refresh); void refresh(); return () => window.removeEventListener("recut-sdk-ready", refresh); }, [refresh]);
  useEffect(() => { void loadAssets().catch((error) => setMessage(error.message)); }, [loadAssets]);
  useEffect(() => recut.events.subscribe((raw) => {
    const event = raw as { type?: string; log?: { jobId?: string; text?: string }; job?: ShellJob };
    if (event.type === "shell.job.log" && event.log?.jobId === activeJob?.id) setLogs((items) => [...items, event.log?.text || ""].slice(-80));
    if (event.type !== "shell.job.completed" || event.job?.id !== activeJob?.id) return;
    const completed = event.job;
    if (completed.status !== "completed") {
      setMessage(completed.error || "本地任务未完成。"); setBusy(null); setActiveJob(null); return;
    }
    void (async () => {
      try {
        if (activeJob.action === "generate" && activeJob.outputID) {
          const output = await recut.background.call("depth.complete", { id: activeJob.outputID }) as DepthOutput;
          setOutputs((items) => [output, ...items]); setMessage("深度预览已生成，尚未进入素材库。");
        } else {
          await refresh(); setMessage(activeJob.action === "prepare" ? "运行环境已就绪，请选择要下载的模型。" : "模型下载完成，可以开始转换。");
        }
      } catch (error) { setMessage(error instanceof Error ? error.message : "任务完成后无法刷新状态。"); }
      finally { setBusy(null); setActiveJob(null); }
    })();
  }), [activeJob, refresh]);

  const compatibleAssets = useMemo(() => assets.filter((asset) => asset.kind === sourceKind), [assets, sourceKind]);
  const readyModel = Boolean(status?.installedModels.includes(model));
  const currentOutput = outputs[0];

  const install = async () => {
    setBusy("install");
    setMessage(`正在安装运行环境并下载 ${models.find((item) => item.id === model)?.label} 模型…`);
    try { const result = await recut.background.call("depth.install", { model }) as { job: ShellJob }; setActiveJob({ id: result.job.id, action: "install" }); setLogs([]); setMessage(`正在下载 ${models.find((item) => item.id === model)?.label} 模型…`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "安装失败。"); setBusy(null); }
  };

  const prepare = useCallback(async () => {
    setBusy("prepare");
    setMessage("正在自动准备 Python 运行环境…");
    try { const result = await recut.background.call("depth.prepare") as { job: ShellJob }; setActiveJob({ id: result.job.id, action: "prepare" }); setLogs([]); setMessage("正在自动准备 Python 运行环境…"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "运行环境准备失败。"); setBusy(null); }
  }, []);

  const generate = async () => {
    if (!assetId) return setMessage("先选择一张图片或一个视频素材。");
    setBusy("generate");
    setMessage(sourceKind === "video" ? "正在逐帧计算深度图，视频处理会花更长时间。" : "正在生成深度图…");
    try { const result = await recut.background.call("depth.generate", { assetId, kind: sourceKind, model, style }) as { job: ShellJob; output: { id: string } }; setActiveJob({ id: result.job.id, action: "generate", outputID: result.output.id }); setLogs([]); }
    catch (error) { setMessage(error instanceof Error ? error.message : "生成失败。"); setBusy(null); }
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
      await loadAssets(); setAssetId(payload.id); setMessage("输入素材已加入素材库并选中。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "上传失败。"); }
    finally { setBusy(null); }
  };

  const askAgent = async () => {
    setBusy("agent");
    try { await recut.agent.send(`Depth Anything 本地依赖检查或安装失败。请检查并解决这个错误，然后告诉我可以如何继续：${status?.error || message}`); setMessage("诊断已发送到右侧 Codex。 "); }
    catch (error) { setMessage(error instanceof Error ? error.message : "无法发送诊断请求。"); }
    finally { setBusy(null); }
  };

  if (!status?.ready) return <Setup status={status} busy={busy} logs={logs} message={message} onPrepare={() => void prepare()} onAskAgent={() => void askAgent()} />;
  return <main className="app-shell"><header className="app-header"><div><p className="eyebrow">RECUT APP / LOCAL DEPTH</p><h1>Depth Anything</h1><p>将图片或视频转换为深度图。预览不会自动进入素材库。</p></div><button className="icon-button" aria-label="重新检查运行环境" onClick={() => void refresh()} title="重新检查运行环境"><SlidersHorizontal size={16} /></button></header><section className="workspace"><div className="controls"><SectionTitle label="输入" title="选择素材" /><div className="segmented">{(["image", "video"] as SourceKind[]).map((kind) => <button className={sourceKind === kind ? "selected" : ""} key={kind} onClick={() => { setSourceKind(kind); setAssetId(""); }} type="button">{kind === "image" ? <Image size={15} /> : <Video size={15} />}{kind === "image" ? "图片" : "视频"}</button>)}</div><label className="field-label" htmlFor="source-asset">素材库</label><select id="source-asset" onChange={(event) => setAssetId(event.target.value)} value={assetId}><option value="">选择{sourceKind === "image" ? "图片" : "视频"}素材</option>{compatibleAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name || asset.id}</option>)}</select><label className="upload-control"><Upload size={15} />上传{sourceKind === "image" ? "图片" : "视频"}<input accept={`${sourceKind}/*`} onChange={(event) => void upload(event.target.files?.[0])} type="file" /></label><SectionTitle label="模型" title="本地权重" /><label className="field-label" htmlFor="depth-model">模型尺寸</label><select id="depth-model" onChange={(event) => setModel(event.target.value as Model)} value={model}>{models.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.note}</option>)}</select>{readyModel ? <p className="model-ready"><Check size={14} />已下载</p> : <button className="secondary-button" disabled={busy !== null} onClick={() => void install()} type="button"><Download size={15} />下载此模型</button>}<SectionTitle label="输出" title="深度图样式" /><div className="segmented">{(["color", "grayscale"] as OutputStyle[]).map((item) => <button className={style === item ? "selected" : ""} key={item} onClick={() => setStyle(item)} type="button">{item === "color" ? "伪彩" : "灰度"}</button>)}</div><button className="primary-button" disabled={busy !== null || !assetId || !readyModel} onClick={() => void generate()} type="button">{busy === "generate" ? <LoaderCircle className="spin" size={16} /> : <Image size={16} />}{busy === "generate" ? "正在生成…" : "生成深度图"}</button></div><OutputPanel output={currentOutput} busy={busy} onSave={save} /></section><History outputs={outputs.slice(1)} busy={busy} onSave={save} />{logs.length > 0 && <pre className="job-log">{logs.join("")}</pre>}<p className="status" role="status">{message}</p></main>;
}

function Setup({ status, busy, logs, message, onPrepare, onAskAgent }: { status: RuntimeStatus | null; busy: string | null; logs: string[]; message: string; onPrepare: () => void; onAskAgent: () => void }) {
  const started = useRef(false);
  useEffect(() => { if (status && !started.current) { started.current = true; onPrepare(); } }, [status, onPrepare]);
  return <main className="setup"><div className="setup-mark"><AlertTriangle size={22} /></div><p className="eyebrow">DEPTH ANYTHING / LOCAL SETUP</p><h1>准备本地运行环境</h1><p>Depth Anything 在本机 Python 中执行。进入应用后会自动安装依赖与官方代码；模型权重将在工作台中由你自行选择下载，全部保存在 <code>~/.recut/models/depth-anything-v2</code>。</p>{status?.error && <div className="error-box"><strong>检查结果</strong><pre>{status.error}</pre><button className="link-button" disabled={busy !== null} onClick={onAskAgent} type="button"><Send size={14} />交给右侧 Codex 处理</button></div>}{logs.length > 0 && <pre className="job-log">{logs.join("")}</pre>}<button className="secondary-button" disabled={busy !== null} onClick={onPrepare} type="button">{busy === "prepare" ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}{busy === "prepare" ? "正在自动准备…" : "重试运行环境准备"}</button><p className="status" role="status">{message}</p></main>;
}

function OutputPanel({ output, busy, onSave }: { output?: DepthOutput; busy: string | null; onSave: (output: DepthOutput) => void }) {
  return <section className="output-panel"><header><SectionTitle label="预览" title="本次输出" />{output && <span className={output.savedAssetId ? "saved-pill" : "private-pill"}>{output.savedAssetId ? "已保存" : "私有预览"}</span>}</header><div className="preview">{output ? output.kind === "image" ? <img alt="本次生成的深度图" src={output.previewURL} /> : <video controls src={output.previewURL} /> : <div className="empty"><Image size={28} /><p>选择素材并生成后，深度预览会显示在这里。</p></div>}</div>{output && <footer><div><strong>{models.find((item) => item.id === output.model)?.label} · {output.style === "color" ? "伪彩" : "灰度"}</strong><span>先预览，再自行决定是否保存到素材库。</span></div>{output.savedAssetId ? <span className="saved-copy"><Check size={15} />素材库已保存</span> : <button className="primary-button compact" disabled={busy !== null} onClick={() => onSave(output)} type="button">{busy === "save" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存到素材库</button>}</footer>}</section>;
}

function History({ outputs, busy, onSave }: { outputs: DepthOutput[]; busy: string | null; onSave: (output: DepthOutput) => void }) { return <section className="history"><header><SectionTitle label="历史" title="之前的输出" /><span>{outputs.length} 条</span></header>{outputs.length ? <div className="history-grid">{outputs.map((output) => <article key={output.id}><div className="thumb">{output.kind === "image" ? <img alt="历史深度图" src={output.previewURL} /> : <video muted preload="metadata" src={output.previewURL} />}</div><div><strong>{models.find((item) => item.id === output.model)?.label} · {output.kind === "image" ? "图片" : "视频"}</strong><span>{new Date(output.createdAt).toLocaleString("zh-CN")}</span>{output.savedAssetId ? <em>已保存到素材库</em> : <button className="text-button" disabled={busy !== null} onClick={() => onSave(output)} type="button"><Save size={13} />保存到素材库</button>}</div></article>)}</div> : <p className="empty-history">还没有历史输出。</p>}</section>; }

function SectionTitle({ label, title }: { label: string; title: string }) { return <div className="section-title"><span>{label}</span><h2>{title}</h2></div>; }

createRoot(document.getElementById("root")!).render(<App />);
