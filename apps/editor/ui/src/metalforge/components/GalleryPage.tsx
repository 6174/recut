import { useEffect, useRef, useState } from "react";
import { effectsByGallery } from "../catalog";

export function GalleryPage() {
  const groups = effectsByGallery();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const stateRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const all = groups.flatMap((g) => g.effects);
    (async () => {
      const { renderThumbnail } = await import("../engine/thumbnails");
      // small concurrency so the GPU stays responsive
      const queue = [...all];
      const worker = async () => {
        while (!cancelled && queue.length) {
          const effect = queue.shift()!;
          try {
            const url = await renderThumbnail(effect);
            if (cancelled) return;
            stateRef.current = { ...stateRef.current, [effect.id]: url };
            setThumbs(stateRef.current);
          } catch {
            // leave swatch fallback for this card
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
          Editor UI · Internal Components
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">MetalForge Effects</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/50">
          付费源码已导入 <code className="rounded bg-white/10 px-1.5 py-0.5 text-[12px]">src/metalforge/imports/</code>，
          卡片为各效果 WGSL 的真实单帧渲染（WebGPU）。点击卡片进入调参页。
        </p>
      </header>
      {groups.map((group) => (
        <section key={group.id} className="mb-12">
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="text-lg font-medium text-white">{group.label}</h2>
            <span className="font-mono text-xs text-white/35">{group.effects.length}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {group.effects.map((effect) => (
              <a
                key={effect.id}
                href={`#/effect/${encodeURIComponent(effect.id)}`}
                className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] transition hover:border-white/25 hover:bg-white/[0.06]"
              >
                <div className="aspect-[4/3] w-full" style={{ background: effect.swatch || "#111" }}>
                  {thumbs[effect.id] && (
                    <img
                      src={thumbs[effect.id]}
                      alt={effect.name}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  )}
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-white/90">{effect.name}</p>
                    <p className="truncate font-mono text-[10px] text-white/35">{effect.id}</p>
                  </div>
                  <span className="ml-2 shrink-0 rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-white/40">
                    {effect.kind}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
