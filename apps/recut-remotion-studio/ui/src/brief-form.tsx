import { useState } from "react";
import { recut } from "./recut-sdk";
import type { Brief, Catalog, MediaAsset } from "./app";

interface BriefFormProps {
  brief: Brief | null;
  catalog: Catalog;
  status: string;
  onStart: (input: { template: string; topic: string; details: string; expectedDurationSec: number; materialAssetIds: string[] }) => Promise<void>;
}

export function BriefForm({ brief, catalog, status, onStart }: BriefFormProps) {
  const [template, setTemplate] = useState(brief?.template ?? "clean-editorial");
  const [topic, setTopic] = useState(brief?.topic ?? "");
  const [details, setDetails] = useState(brief?.details ?? "");
  const [duration, setDuration] = useState(brief?.expectedDurationSec ?? 60);
  const [materials, setMaterials] = useState<MediaAsset[]>([]);
  const [busy, setBusy] = useState(false);

  const pickMaterials = async () => {
    try {
      const selection = await recut.media.pick({ kinds: ["image", "video", "audio"], multiple: true });
      if (selection) {
        const picked = Array.isArray(selection) ? selection : [selection];
        setMaterials(picked.map((item) => ({ id: item.id, kind: item.kind as MediaAsset["kind"], name: item.name, status: "completed" })));
      }
    } catch (cause) {
      console.error("[remotion-studio] material pick failed", cause);
    }
  };

  const submit = async () => {
    if (!topic.trim()) return;
    setBusy(true);
    try {
      await onStart({ template, topic: topic.trim(), details: details.trim(), expectedDurationSec: duration, materialAssetIds: materials.map((item) => item.id) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px" }}>
      <h2 style={{ fontSize: 22, marginBottom: 4 }}>新建一支程序化视频</h2>
      <p className="muted" style={{ marginTop: 4, marginBottom: 24 }}>选择风格模板、写下选题与细节，把素材一并交给 AI 设计成可实时预览的 Remotion 合成。</p>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2>风格模板</h2><span className="muted mono">驱动色板、字体、字幕与动效气质</span></div>
        <div className="panel-body">
          <div className="chips" role="radiogroup" aria-label="风格模板">
            {Object.entries(catalog.styleTemplates).map(([id, templateInfo]) => (
              <button aria-checked={template === id} className={`chip ${template === id ? "active" : ""}`} key={id} onClick={() => setTemplate(id)} role="radio" type="button" style={{ maxWidth: 240 }}>
                <strong>{templateInfo.label}</strong>
                <span className="sub">{templateInfo.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2>选题与描述</h2></div>
        <div className="panel-body">
          <div className="field">
            <label htmlFor="brief-topic">选题方向</label>
            <input autoFocus className="input" id="brief-topic" onChange={(event) => setTopic(event.target.value)} placeholder="例如：为什么人人都该学会做视频" value={topic} />
          </div>
          <div className="field">
            <label htmlFor="brief-details">详细描述（可选）</label>
            <textarea className="textarea" id="brief-details" onChange={(event) => setDetails(event.target.value)} placeholder="目标观众、核心观点、风格偏好、镜头想法或任何约束…" value={details} />
          </div>
          <div className="field" style={{ maxWidth: 240 }}>
            <label htmlFor="brief-duration">预期时长（秒）</label>
            <select className="select" id="brief-duration" onChange={(event) => setDuration(Number(event.target.value))} value={duration}>
              {[15, 30, 45, 60, 90, 120].map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h2>素材</h2><button className="btn small" onClick={() => void pickMaterials()} type="button">{materials.length ? "重新选择素材" : "从素材库选择"}</button></div>
        <div className="panel-body">
          {materials.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>尚未选择素材；可在设计阶段继续补充，也可直接从空白开始。</p>
          ) : (
            <div>
              {materials.map((asset) => (
                <div className="asset-card" key={asset.id}>
                  <span className="kind-badge">{asset.kind}</span>
                  <span className="grow name">{asset.name}</span>
                  <span className="mono muted">{asset.id.slice(0, 8)}</span>
                  <button aria-label={`移除 ${asset.name}`} className="btn ghost small" onClick={() => setMaterials((items) => items.filter((item) => item.id !== asset.id))} type="button">移除</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex between" style={{ marginTop: 24 }}>
        <span className="muted">{status || (brief ? "已有 Brief，重新提交会覆盖方向。" : "")}</span>
        <button className="btn primary" disabled={busy || !topic.trim()} onClick={() => void submit()} type="button">提交给 AI 开始设计</button>
      </div>
    </div>
  );
}
