import { useEffect, useMemo, useRef, useState } from "react";
import type { EffectSchema } from "../types";
import { defaultValues } from "../engine/layout";
import { mountPreview, type PreviewHandle } from "../engine/preview";
import { PREVIEW_KINDS, importsById } from "../catalog";
import { ParamPanel } from "./ParamPanel";

interface DetailPageProps {
  effect: EffectSchema;
}

type Tab = "preview" | "code";

type ProgressMode = "shader" | "component";

const rawImports = import.meta.glob("../imports/*", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

function importRaw(file: string): Promise<string> {
  const key = Object.keys(rawImports).find((k) => k.endsWith(`/imports/${file}`));
  if (!key) return Promise.reject(new Error(`missing raw import: ${file}`));
  return rawImports[key]();
}

function ProgressComponentPreviewLazy(props: { effect: EffectSchema; values: Record<string, unknown> }) {
  const { effect, values } = props;
  const [Comp, setComp] = useState<null | React.ComponentType<{ effect: EffectSchema; values: Record<string, unknown> }>>(null);
  useEffect(() => {
    let cancelled = false;
    import("./ProgressComponentPreview").then((m) => {
      if (!cancelled) setComp(() => m.ProgressComponentPreview);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!Comp) return <div className="flex h-full items-center justify-center text-sm text-white/40">组件加载中…</div>;
  return <Comp effect={effect} values={values} />;
}

function CodeBlock({ title, source }: { title: string; source: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-white/10">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.04] px-3 py-2">
        <span className="font-mono text-[11px] text-white/60">{title}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(source).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
          className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-white/60 hover:border-white/30 hover:text-white"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="max-h-[420px] overflow-auto bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-white/70">
        {source}
      </pre>
    </div>
  );
}

export function DetailPage({ effect }: DetailPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<PreviewHandle | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>(() => defaultValues(effect));
  const [playing, setPlaying] = useState(true);
  const [tab, setTab] = useState<Tab>("preview");
  const [error, setError] = useState<string | null>(null);
  const [progressMode, setProgressMode] = useState<ProgressMode>("shader");
  const isProgress = effect.id === "progress";

  const previewable = PREVIEW_KINDS.has(effect.kind);
  const importEntry = importsById.get(effect.id);

  useEffect(() => {
    setValues(defaultValues(effect));
    handleRef.current = null;
    setError(null);
  }, [effect]);

  useEffect(() => {
    if (!previewable || !canvasRef.current) return;
    let disposed = false;
    let handle: PreviewHandle | null = null;
    mountPreview(canvasRef.current, effect, values)
      .then((h) => {
        if (disposed) {
          h.dispose();
          return;
        }
        handle = h;
        handleRef.current = h;
      })
      .catch((e) => setError((e as Error).message));
    return () => {
      disposed = true;
      handle?.dispose();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect, previewable]);

  const codeFiles = useMemo(() => {
    if (!importEntry) return [];
    return importEntry.files
      .filter((f) => !f.binary && f.size < 200_000)
      .map((f) => ({ title: `${f.platform}/${f.name}`, file: f.file }));
  }, [importEntry]);

  const [loadedCode, setLoadedCode] = useState<Record<string, string>>({});
  const [filterSwatches, setFilterSwatches] = useState<Record<string, Record<string, string>>>({});

  // filter chips for meshgradient effects (keyed by style preset so they stay stable while tweaking)
  const styleKey = typeof values.style === "string" ? values.style : "";
  useEffect(() => {
    if (effect.kind !== "meshgradient") return;
    let cancelled = false;
    (async () => {
      try {
        const { renderFilterSwatches } = await import("../engine/thumbnails");
        const base = { ...values, filter: "none" };
        delete (base as Record<string, unknown>).fAmount;
        const sw = await renderFilterSwatches(effect, base);
        if (!cancelled) setFilterSwatches({ filter: sw });
      } catch {
        // swatch rendering is best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect, styleKey]);
  useEffect(() => {
    let cancelled = false;
    const files = codeFiles.slice(0, 4);
    Promise.all(
      files.map((f) =>
        importRaw(f.file).then((src) => [f.file, src] as const),
      ),
    ).then((pairs) => {
      if (!cancelled) setLoadedCode(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [codeFiles]);

  const handleChange = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    handleRef.current?.setValues({ ...values, [key]: value });
  };
  const handlePreset = (presets: Record<string, unknown>) => {
    setValues((prev) => {
      const next = { ...prev, ...presets };
      handleRef.current?.setValues(next);
      return next;
    });
  };
  const handleReset = () => {
    const next = defaultValues(effect);
    setValues(next);
    handleRef.current?.setValues(next);
    handleRef.current?.resetTime();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-3">
        <div className="flex items-center gap-3">
          <a
            href="#/"
            className="rounded-md border border-white/10 px-2.5 py-1 text-[12px] text-white/60 transition hover:border-white/30 hover:text-white"
          >
            ← 返回
          </a>
          <h1 className="text-[15px] font-medium text-white">{effect.name}</h1>
          <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-white/40">
            {effect.kind}
          </span>
        </div>
        <div className="flex rounded-full border border-white/10 p-0.5">
          {(["preview", "code"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1 text-[12px] capitalize transition ${
                tab === t ? "bg-white text-black" : "text-white/60 hover:text-white"
              }`}
            >
              {t === "preview" ? "预览" : "代码"}
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          {tab === "preview" ? (
            previewable ? (
              isProgress ? (
                <>
                  <div className="relative min-h-0 flex-1">
                    {progressMode === "component" ? (
                      <ProgressComponentPreviewLazy effect={effect} values={values} />
                    ) : error ? (
                      <div className="flex h-full items-center justify-center px-8 text-center text-sm text-red-300/80">
                        {error}
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center p-8">
                        <div
                          className="relative w-full max-w-[760px] overflow-hidden"
                          style={{
                            aspectRatio: "3.6",
                            borderRadius: "4% / 14.4%",
                          }}
                        >
                          <canvas ref={canvasRef} className="h-full w-full" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-3 border-t border-white/10 px-4 py-2.5">
                    <div className="flex rounded-full border border-white/10 p-0.5">
                      {(["shader", "component"] as ProgressMode[]).map((m) => (
                        <button
                          key={m}
                          onClick={() => setProgressMode(m)}
                          className={`rounded-full px-3.5 py-1 text-[12px] transition ${
                            progressMode === m ? "bg-white text-black" : "text-white/60 hover:text-white"
                          }`}
                        >
                          {m === "shader" ? "着色器" : "组件"}
                        </button>
                      ))}
                    </div>
                    {progressMode === "shader" && (
                      <>
                        <button
                          onClick={() => {
                            const next = !playing;
                            setPlaying(next);
                            handleRef.current?.setPlaying(next);
                          }}
                          className="rounded-md border border-white/10 px-3 py-1 text-[12px] text-white/70 hover:border-white/30 hover:text-white"
                        >
                          {playing ? "暂停" : "播放"}
                        </button>
                        <button
                          onClick={() => handleRef.current?.resetTime()}
                          className="rounded-md border border-white/10 px-3 py-1 text-[12px] text-white/70 hover:border-white/30 hover:text-white"
                        >
                          重置时间
                        </button>
                      </>
                    )}
                    <span className="font-mono text-[11px] text-white/35">WebGPU · {effect.id}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative min-h-0 flex-1">
                    {error ? (
                      <div className="flex h-full items-center justify-center px-8 text-center text-sm text-red-300/80">
                        {error}
                      </div>
                    ) : (
                      <canvas ref={canvasRef} className="h-full w-full" />
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-3 border-t border-white/10 px-4 py-2.5">
                    <button
                      onClick={() => {
                        const next = !playing;
                        setPlaying(next);
                        handleRef.current?.setPlaying(next);
                      }}
                      className="rounded-md border border-white/10 px-3 py-1 text-[12px] text-white/70 hover:border-white/30 hover:text-white"
                    >
                      {playing ? "暂停" : "播放"}
                    </button>
                    <button
                      onClick={() => handleRef.current?.resetTime()}
                      className="rounded-md border border-white/10 px-3 py-1 text-[12px] text-white/70 hover:border-white/30 hover:text-white"
                    >
                      重置时间
                    </button>
                    <span className="font-mono text-[11px] text-white/35">WebGPU · {effect.id}</span>
                  </div>
                </>
              )
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
                <div
                  className="h-48 w-72 rounded-xl border border-white/10"
                  style={{ background: effect.swatch || "#111" }}
                />
                <p className="max-w-md px-6 text-center text-sm text-white/50">
                  <span className="font-mono text-white/70">{effect.kind}</span>{" "}
                  类型效果的交互预览需要专用模拟器，后续接入。下方参数调整与代码导出已可用。
                </p>
              </div>
            )
          ) : (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
              {codeFiles.length === 0 && (
                <p className="text-sm text-white/50">该效果没有已导入的代码文件。</p>
              )}
              {codeFiles.map((f) => (
                <CodeBlock key={f.file} title={f.title} source={loadedCode[f.file] ?? "// 加载中…"} />
              ))}
            </div>
          )}
        </main>

        <aside className="w-[340px] shrink-0 border-l border-white/10">
          <ParamPanel
            effect={effect}
            values={values}
            onChange={handleChange}
            onPreset={handlePreset}
            onReset={handleReset}
            optionSwatches={filterSwatches}
          />
        </aside>
      </div>
    </div>
  );
}
