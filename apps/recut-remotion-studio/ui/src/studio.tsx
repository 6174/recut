import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Wand2, Download } from "lucide-react";
import { recut, mediaContentURL } from "./recut-sdk";
import { PlayerPanel } from "./player-panel";
import { ExportPanel } from "./export-panel";
import type { Catalog, DesignResource, MediaAsset, MediaMap } from "./app";
import type { Design, Scene } from "@compositions/types";

type Tab = "script" | "style" | "materials" | "export";

const TEXT_EFFECT_IDS = ["bounce-text", "typewriter", "glitch", "cinematic-title", "slide-text", "lower-third"];

function emptyDesign(resource: DesignResource): Design {
  const content = resource?.content ?? resource;
  return {
    title: content.title ?? "未命名视频",
    durationSec: content.durationSec ?? 30,
    fps: content.fps ?? 30,
    width: content.width ?? 1920,
    height: content.height ?? 1080,
    template: content.template ?? "clean-editorial",
    style: { ...(content.style ?? {}) },
    scenes: (content.scenes ?? []).map((scene) => ({ ...scene })),
  };
}

/** composition.update returns a platform Artifact ({ value: designResource }); unwrap it. */
function unwrapResource(result: unknown): DesignResource {
  const artifact = result as { value?: DesignResource };
  if (artifact && typeof artifact === "object" && artifact.value && artifact.value.content) return artifact.value;
  return result as DesignResource;
}

function recomputeDuration(design: Design): Design {
  const durationSec = Math.max(1, Number((design.scenes || []).reduce((sum, scene) => sum + Number(scene.durationSec || 0), 0).toFixed(1)));
  return { ...design, durationSec };
}

interface StudioProps {
  assets: MediaAsset[];
  catalog: Catalog;
  designResource: DesignResource;
  mediaMap: MediaMap;
  onDesignSaved: (resource: DesignResource) => void;
  onRedesign: () => void;
  setStatus: (status: string) => void;
}

export function Studio({ assets, catalog, designResource, mediaMap, onDesignSaved, onRedesign, setStatus }: StudioProps) {
  const [tab, setTab] = useState<Tab>("script");
  const [design, setDesign] = useState<Design>(() => emptyDesign(designResource));
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const pendingRef = useRef<Design | null>(null);
  const lastSaved = useRef<string>("");

  useEffect(() => {
    setDesign(emptyDesign(designResource));
  }, [designResource.id]);

  const flush = async () => {
    if (!pendingRef.current) return;
    const next = pendingRef.current;
    pendingRef.current = null;
    const snapshot = JSON.stringify({ title: next.title, durationSec: next.durationSec, fps: next.fps, width: next.width, height: next.height, template: next.template, style: next.style, scenes: next.scenes });
    if (snapshot === lastSaved.current) return;
    setSaving(true);
    try {
      const updated = await recut.background.call("composition.update", { id: designResource.id, contentPatch: JSON.parse(snapshot) });
      lastSaved.current = snapshot;
      onDesignSaved(unwrapResource(updated));
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "保存失败");
      throw cause;
    } finally {
      setSaving(false);
    }
  };

  const save = (next: Design) => {
    pendingRef.current = next;
    setDesign(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), 700);
  };

  const flushSave = async () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await flush();
  };

  const patchScene = (sceneId: string, patch: Partial<Scene>) => save(recomputeDuration({ ...design, scenes: design.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)) }));
  const patchStyle = (key: keyof Design["style"], value: string | null) => save({ ...design, style: { ...design.style, [key]: value === "" ? null : value } });
  const patchTop = (key: keyof Design, value: unknown) => save({ ...design, [key]: value });

  const pickSceneImage = async (sceneId: string) => {
    try {
      const selection = await recut.media.pick({ kinds: ["image"], multiple: false });
      if (selection && !Array.isArray(selection)) patchScene(sceneId, { imageAssetId: selection.id });
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "素材选择失败");
    }
  };
  const pickBgm = async () => {
    try {
      const selection = await recut.media.pick({ kinds: ["audio"], multiple: false });
      if (selection && !Array.isArray(selection)) patchStyle("bgmAssetId", selection.id);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "音乐选择失败");
    }
  };
  const addScene = () => {
    const kind: Scene["kind"] = "content";
    const id = `scene-${Date.now().toString(36)}`;
    save(recomputeDuration({ ...design, scenes: [...design.scenes, { id, kind, title: "新场景", narration: "", durationSec: 5 }] }));
    setTab("script");
  };
  const removeScene = (sceneId: string) => save(recomputeDuration({ ...design, scenes: design.scenes.filter((scene) => scene.id !== sceneId) }));

  const scene = (id: string) => design.scenes.find((item) => item.id === id);
  const imageAsset = (assetId?: string) => assets.find((item) => item.id === assetId);
  const bgmAsset = design.style.bgmAssetId ? assets.find((item) => item.id === design.style.bgmAssetId) : null;
  const kindName: Record<Scene["kind"], string> = { title: "开场", content: "内容", outro: "收尾" };
  const captionThemes = catalog.captionThemes;
  const backgroundEffects = catalog.effects.filter((effect) => effect.kind === "background");
  const textEffects = catalog.effects.filter((effect) => effect.kind === "text");

  return (
    <div className="studio">
      <section className="stage-area">
        <div className="stage-box">
          <PlayerPanel design={design} mediaMap={mediaMap} />
          <div className="flex between" style={{ marginTop: 14 }}>
            <span className="muted mono">{design.width}×{design.height} @ {design.fps}fps · {design.durationSec}s · {design.scenes.length} 场景</span>
            <div className="flex">
              {saving && <span className="muted mono">保存中…</span>}
              <button className="btn" onClick={addScene} type="button"><Plus className="size-4" />添加场景</button>
              <button className="btn" onClick={onRedesign} type="button"><Wand2 className="size-4" />重新设计</button>
            </div>
          </div>
        </div>
      </section>

      <aside className="side-area">
        <div className="side-tabs" role="tablist">
          {(["script", "style", "materials", "export"] as Tab[]).map((key) => (
            <button aria-selected={tab === key} className={`side-tab ${tab === key ? "active" : ""}`} key={key} onClick={() => setTab(key)} role="tab" type="button">
              {key === "script" ? "脚本" : key === "style" ? "样式" : key === "materials" ? "素材" : "导出"}
            </button>
          ))}
        </div>
        <div className="side-body">
          {tab === "script" && (
            <div className="row-gap">
              <div className="field">
                <label htmlFor="design-title">视频标题</label>
                <input className="input" id="design-title" onChange={(event) => patchTop("title", event.target.value)} value={design.title} />
              </div>
              {design.scenes.map((sceneItem, index) => {
                const image = imageAsset(sceneItem.imageAssetId);
                return (
                  <div className="scene-card" key={sceneItem.id}>
                    <div className="scene-head">
                      <span className="kind-badge">{kindName[sceneItem.kind]}</span>
                      <span className="mono muted">#{index + 1}</span>
                      <span className="grow" />
                      <button aria-label={`删除场景 ${sceneItem.title}`} className="btn ghost small danger" onClick={() => removeScene(sceneItem.id)} type="button"><Trash2 className="size-3.5" /></button>
                    </div>
                    <div className="scene-body">
                      <div className="grid-2">
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label htmlFor={`scene-kind-${sceneItem.id}`}>类型</label>
                          <select className="select" id={`scene-kind-${sceneItem.id}`} onChange={(event) => patchScene(sceneItem.id, { kind: event.target.value as Scene["kind"] })} value={sceneItem.kind}>
                            <option value="title">开场</option>
                            <option value="content">内容</option>
                            <option value="outro">收尾</option>
                          </select>
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label htmlFor={`scene-duration-${sceneItem.id}`}>时长（秒）</label>
                          <input className="input" id={`scene-duration-${sceneItem.id}`} min={1} onChange={(event) => patchScene(sceneItem.id, { durationSec: Math.max(1, Number(event.target.value) || 1) })} type="number" value={sceneItem.durationSec} />
                        </div>
                      </div>
                      <div className="field">
                        <label htmlFor={`scene-title-${sceneItem.id}`}>标题文字</label>
                        <input className="input" id={`scene-title-${sceneItem.id}`} onChange={(event) => patchScene(sceneItem.id, { title: event.target.value })} value={sceneItem.title} />
                      </div>
                      {sceneItem.kind === "content" ? (
                        <div className="field">
                          <label htmlFor={`scene-narration-${sceneItem.id}`}>旁白（自动生成字幕）</label>
                          <textarea className="textarea" id={`scene-narration-${sceneItem.id}`} onChange={(event) => patchScene(sceneItem.id, { narration: event.target.value })} placeholder="这段场景说的新信息…" value={sceneItem.narration ?? ""} />
                        </div>
                      ) : null}
                      <div className="grid-2">
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label htmlFor={`scene-image-${sceneItem.id}`}>画面素材</label>
                          <div className="flex">
                            <select className="select" id={`scene-image-${sceneItem.id}`} onChange={(event) => patchScene(sceneItem.id, { imageAssetId: event.target.value || undefined })} value={sceneItem.imageAssetId ?? ""}>
                              <option value="">（不使用图片）</option>
                              {assets.filter((item) => item.kind === "image" || item.kind === "video").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                            <button className="btn small" onClick={() => void pickSceneImage(sceneItem.id)} type="button">选</button>
                          </div>
                          {image ? <img alt={image.name} src={mediaContentURL(image.id)} style={{ width: "100%", height: 72, objectFit: "cover", borderRadius: 8, marginTop: 8 }} /> : null}
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label htmlFor={`scene-effect-${sceneItem.id}`}>表达特效</label>
                          <select className="select" id={`scene-effect-${sceneItem.id}`} onChange={(event) => patchScene(sceneItem.id, { effectId: event.target.value || undefined })} value={sceneItem.effectId ?? ""}>
                            <option value="">（无 / 默认）</option>
                            {[...textEffects, ...backgroundEffects].map((effect) => <option key={effect.id} value={effect.id}>{effect.label}</option>)}
                          </select>
                          <span className="muted mono" style={{ fontSize: 11 }}>开场面文字特效 · 内容面背景特效</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <button className="btn" onClick={addScene} type="button"><Plus className="size-4" />添加场景</button>
            </div>
          )}

          {tab === "style" && (
            <div className="row-gap">
              <div className="field">
                <label htmlFor="style-template">风格模板</label>
                <select className="select" id="style-template" onChange={(event) => patchTop("template", event.target.value)} value={design.template}>
                  {Object.entries(catalog.styleTemplates).map(([id, templateInfo]) => <option key={id} value={id}>{templateInfo.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="style-caption-theme">字幕主题</label>
                <select className="select" id="style-caption-theme" onChange={(event) => patchStyle("captionTheme", event.target.value || null)} value={design.style.captionTheme ?? ""}>
                  <option value="">（不加字幕）</option>
                  {captionThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="style-effect">背景特效</label>
                <select className="select" id="style-effect" onChange={(event) => patchStyle("effectId", event.target.value || null)} value={design.style.effectId ?? ""}>
                  <option value="">（纯色背景）</option>
                  {backgroundEffects.map((effect) => <option key={effect.id} value={effect.id}>{effect.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="style-font">字体</label>
                <input className="input" id="style-font" onChange={(event) => patchStyle("fontFamily", event.target.value)} placeholder="例如 Georgia, 'Times New Roman', serif" value={design.style.fontFamily ?? ""} />
              </div>
              <div className="field">
                <label>色板</label>
                <div className="grid-2">
                  {([["background", "背景"], ["primary", "主色"], ["accent", "强调色"], ["text", "文字"]] as Array<[keyof Design["style"], string]>).map(([key, label]) => (
                    <div className="color-row" key={key}>
                      <span>{label}</span>
                      <input aria-label={`${label}色`} className="color-input" onChange={(event) => patchStyle(key, event.target.value)} type="color" value={design.style[key] ?? "#000000"} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>字幕配色</label>
                <div className="grid-2">
                  <div className="color-row"><span>主色</span><input aria-label="字幕主色" className="color-input" onChange={(event) => patchStyle("captionPrimary", event.target.value)} type="color" value={design.style.captionPrimary ?? "#ffffff"} /></div>
                  <div className="color-row"><span>强调色</span><input aria-label="字幕强调色" className="color-input" onChange={(event) => patchStyle("captionSecondary", event.target.value)} type="color" value={design.style.captionSecondary ?? "#ffd700"} /></div>
                </div>
              </div>
              <div className="field">
                <label>背景音乐</label>
                <div className="flex">
                  <select className="select" onChange={(event) => patchStyle("bgmAssetId", event.target.value || null)} value={design.style.bgmAssetId ?? ""}>
                    <option value="">（无背景音乐）</option>
                    {assets.filter((item) => item.kind === "audio").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <button className="btn small" onClick={() => void pickBgm()} type="button">选</button>
                </div>
                {bgmAsset ? <div className="audio-card asset-card" style={{ marginTop: 8 }}><span className="kind-badge">audio</span><span className="grow name">{bgmAsset.name}</span><audio controls src={mediaContentURL(bgmAsset.id)} style={{ width: 180, height: 32 }} /></div> : null}
              </div>
            </div>
          )}

          {tab === "materials" && (
            <div className="row-gap">
              <p className="muted" style={{ margin: 0 }}>项目中已完成且可用的素材。画面与音乐都会在此选择。</p>
              {assets.filter((item) => item.status === "completed").map((asset) => (
                <div className="asset-card" key={asset.id}>
                  {asset.kind === "image" ? <img alt={asset.name} src={mediaContentURL(asset.id)} /> : asset.kind === "video" ? <video muted src={mediaContentURL(asset.id)} /> : null}
                  <span className="kind-badge">{asset.kind}</span>
                  <span className="grow name">{asset.name}</span>
                  <span className="mono muted">{asset.id.slice(0, 8)}</span>
                </div>
              ))}
              {assets.filter((item) => item.status === "completed").length === 0 ? <p className="muted">暂无素材；到素材库上传或生成后回到这里引用。</p> : null}
            </div>
          )}

          {tab === "export" && (
            <ExportPanel catalog={catalog} designId={designResource.id} flushSave={flushSave} onRenderStarted={(renderId) => setStatus(`渲染任务 ${renderId} 已启动`)} />
          )}
        </div>
      </aside>
    </div>
  );
}
