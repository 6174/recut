import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Play, XCircle } from "lucide-react";
import { recut, mediaContentURL } from "./recut-sdk";
import type { Catalog } from "./app";

interface ExportPanelProps {
  catalog: Catalog;
  designId: string;
  flushSave: () => Promise<void>;
  onRenderStarted: (renderId: string) => void;
}

interface ExportRecord {
  renderId: string;
  status: string;
  label: string;
  settings: { width: number; height: number; fps: number; codec: string };
  assetId?: string;
  error?: string;
  createdAt: string;
}

interface RenderState {
  renderId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  progress?: { phase?: string; progress?: number; message?: string };
  assetId?: string;
  error?: string;
}

const statusLabel: Record<string, string> = {
  queued: "排队中",
  running: "渲染中",
  completed: "完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "被中断",
};

export function ExportPanel({ catalog, designId, flushSave, onRenderStarted }: ExportPanelProps) {
  const [size, setSize] = useState("1080p");
  const [fps, setFps] = useState(30);
  const [codec, setCodec] = useState("h264");
  const [label, setLabel] = useState("remotion 渲染导出");
  const [setup, setSetup] = useState<{ ready: boolean; checks: Record<string, { ok: boolean; version?: string; error?: string }> } | null>(null);
  const [checkingSetup, setCheckingSetup] = useState(false);
  const [render, setRender] = useState<RenderState | null>(null);
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef<number | null>(null);

  const selectedSize = catalog.canvasSizes.find((item) => item.id === size) ?? catalog.canvasSizes[0];

  const refreshExports = useCallback(async () => {
    try {
      setExports(await recut.state.query("export.list"));
    } catch { /* 历史记录读取失败不阻塞 */ }
  }, []);

  useEffect(() => { void refreshExports(); }, [refreshExports]);

  useEffect(() => () => { if (pollTimer.current) window.clearInterval(pollTimer.current); }, []);

  const poll = useCallback((renderId: string) => {
    if (pollTimer.current) window.clearInterval(pollTimer.current);
    pollTimer.current = window.setInterval(async () => {
      try {
        const next = await recut.background.call("render.status", { renderId });
        setRender(next);
        if (["completed", "failed", "cancelled", "interrupted"].includes(next.status)) {
          if (pollTimer.current) window.clearInterval(pollTimer.current);
          pollTimer.current = null;
          void refreshExports();
        }
      } catch (cause) {
        if (pollTimer.current) window.clearInterval(pollTimer.current);
        pollTimer.current = null;
        setRender((current) => current ? { ...current, status: "failed", error: cause instanceof Error ? cause.message : "状态查询失败" } : null);
      }
    }, 2000);
  }, [refreshExports]);

  const checkSetup = async () => {
    setCheckingSetup(true);
    try {
      const result = await recut.background.call("render.setup", {});
      setSetup(result);
      return result as { ready: boolean; checks: Record<string, { ok: boolean; version?: string; error?: string }> };
    } catch (cause) {
      const result = { ready: false, checks: { error: { ok: false, error: cause instanceof Error ? cause.message : "检查失败" } } };
      setSetup(result);
      return result;
    } finally {
      setCheckingSetup(false);
    }
  };

  const startRender = async () => {
    setBusy(true);
    try {
      await flushSave();
      const setupResult = await checkSetup();
      if (!setupResult.ready) throw new Error("渲染环境未就绪，请先修复下方检查项");
      const started = await recut.background.call("render.export", { designId, width: selectedSize.width, height: selectedSize.height, fps, codec, label });
      setRender({ renderId: started.renderId, status: "queued" });
      onRenderStarted(started.renderId);
      poll(started.renderId);
    } catch (cause) {
      setRender({ renderId: "", status: "failed", error: cause instanceof Error ? cause.message : "渲染启动失败" });
    } finally {
      setBusy(false);
    }
  };

  const cancelRender = async () => {
    if (!render?.renderId) return;
    try {
      await recut.background.call("render.cancel", { renderId: render.renderId });
      if (pollTimer.current) window.clearInterval(pollTimer.current);
      pollTimer.current = null;
      setRender({ ...render, status: "cancelled" });
    } catch { /* 取消失败不阻塞 */ }
  };

  const progress = render?.progress?.progress ?? 0;
  const progressPercent = render?.status === "completed" ? 100 : Math.round((progress || 0) * 100);

  return (
    <div className="row-gap">
      <div className="panel">
        <div className="panel-head"><h2>导出设置</h2></div>
        <div className="panel-body">
          <div className="field">
            <label htmlFor="export-size">画布</label>
            <select className="select" id="export-size" onChange={(event) => setSize(event.target.value)} value={size}>
              {catalog.canvasSizes.map((item) => <option key={item.id} value={item.id}>{item.label}（{item.width}×{item.height}）</option>)}
            </select>
          </div>
          <div className="grid-2">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="export-fps">帧率</label>
              <select className="select" id="export-fps" onChange={(event) => setFps(Number(event.target.value))} value={fps}>
                <option value={30}>30 fps</option>
                <option value={24}>24 fps</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="export-codec">编码</label>
              <select className="select" id="export-codec" onChange={(event) => setCodec(event.target.value)} value={codec}>
                <option value="h264">H.264</option>
                <option value="h265">H.265</option>
                <option value="vp9">VP9</option>
              </select>
            </div>
          </div>
          <button className="btn primary" disabled={busy || render?.status === "running" || render?.status === "queued"} onClick={() => void startRender()} style={{ width: "100%", marginTop: 14 }} type="button">
            {busy ? <Loader2 className="size-4 spin" /> : <Download className="size-4" />}开始渲染导出
          </button>
          {busy && <p className="muted" style={{ marginTop: 10 }}>正在检查渲染环境并启动任务…首次运行会安装 Remotion 依赖并下载浏览器，可能耗时几分钟。</p>}
        </div>
      </div>

      {setup && (
        <div className="panel">
          <div className="panel-head"><h2>渲染环境</h2><button className="btn ghost small" onClick={() => void checkSetup()} type="button">{checkingSetup ? "检查中…" : "重新检查"}</button></div>
          <div className="panel-body">
            {Object.entries(setup.checks).map(([key, check]) => (
              <div className="flex between" key={key} style={{ padding: "4px 0" }}>
                <span className="mono">{key}</span>
                <span className={check.ok ? "" : "danger"} style={{ color: check.ok ? "var(--accent-2)" : "var(--danger)" }}>{check.ok ? `就绪${check.version ? ` · ${check.version}` : ""}` : (check.error ?? "不可用")}</span>
              </div>
            ))}
            {!setup.ready && <p className="muted" style={{ marginTop: 10 }}>渲染需要本机 Node.js 18+；依赖与浏览器会自动安装到 App 工作区。</p>}
          </div>
        </div>
      )}

      {render && (
        <div className="panel">
          <div className="panel-head"><h2>当前渲染</h2><span className="mono muted">{render.renderId.slice(0, 8)}</span></div>
          <div className="panel-body">
            <div className="flex between">
              <span>{statusLabel[render.status] ?? render.status}</span>
              {(render.status === "running" || render.status === "queued") && <button className="btn ghost small danger" onClick={() => void cancelRender()} type="button"><XCircle className="size-3.5" />取消</button>}
            </div>
            {(render.status === "running" || render.status === "queued") && (
              <>
                <div className="progress-wrap" style={{ marginTop: 10 }}>
                  <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>
                <p className="muted mono" style={{ marginTop: 8 }}>{render.progress?.message ?? "等待任务开始…"}</p>
              </>
            )}
            {render.status === "completed" && render.assetId && (
              <div style={{ marginTop: 12 }}>
                <video controls muted playsInline src={mediaContentURL(render.assetId)} style={{ width: "100%", borderRadius: 8, background: "#000" }} />
                <div className="flex" style={{ marginTop: 10 }}>
                  <a className="btn" download href={mediaContentURL(render.assetId)} type="button"><Download className="size-4" />下载 MP4</a>
                  <span className="mono muted">{render.assetId.slice(0, 10)}… 已作为新素材加入素材库</span>
                </div>
              </div>
            )}
            {render.status === "failed" && <p className="muted" style={{ marginTop: 10 }}>失败：{render.error ?? "未知错误"}。可在素材库查看详情，或检查渲染环境后重试。</p>}
          </div>
        </div>
      )}

      {exports.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>历史导出</h2></div>
          <div className="panel-body">
            {exports.map((record) => (
              <div className="flex between" key={record.renderId} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <div className="grow">
                  <div className="flex"><span>{record.label}</span><span className="kind-badge">{statusLabel[record.status] ?? record.status}</span></div>
                  <div className="mono muted">{record.settings.width}×{record.settings.height} @ {record.settings.fps}fps · {record.createdAt}</div>
                </div>
                {record.assetId ? <a className="btn small" download href={mediaContentURL(record.assetId)} type="button"><Play className="size-3.5" /></a> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
