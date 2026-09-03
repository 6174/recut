import type { EffectParam } from "../types";

interface ParamControlsProps {
  param: EffectParam;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  onPreset: (presets: Record<string, unknown>) => void;
  optionSwatches?: Record<string, string>;
}

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || "#ffffff"}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-9 cursor-pointer rounded border border-white/15 bg-transparent"
      />
      <span className="font-mono text-[11px] uppercase text-white/50">{value}</span>
    </div>
  );
}

function ParamRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] text-white/70">{label}</span>
      </div>
      {children}
    </div>
  );
}

export function ParamControl({ param, value, onChange, onPreset, optionSwatches }: ParamControlsProps) {
  switch (param.type) {
    case "float": {
      const min = param.min ?? 0;
      const max = param.max ?? 1;
      const step = param.step ?? (max - min) / 200;
      const num = typeof value === "number" ? value : (param.default as number);
      return (
        <ParamRow label={param.label}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={num}
              onChange={(e) => onChange(param.key, parseFloat(e.target.value))}
              className="h-1 flex-1 accent-white"
            />
            <span className="w-12 text-right font-mono text-[11px] text-white/50">
              {num.toFixed(2)}
            </span>
          </div>
        </ParamRow>
      );
    }
    case "select": {
      const options = param.options ?? [];
      const swatches = optionSwatches && Object.keys(optionSwatches).length > 0 ? optionSwatches : null;
      return (
        <ParamRow label={param.label}>
          <div className={swatches ? "grid grid-cols-3 gap-1.5" : "flex flex-wrap gap-1.5"}>
            {options.map((opt) => {
              const active = value === opt.value;
              const swatch = swatches?.[opt.value];
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    onChange(param.key, opt.value);
                    if (opt.presets) onPreset(opt.presets);
                  }}
                  className={
                    swatches
                      ? `overflow-hidden rounded-lg border transition ${
                          active ? "border-white ring-1 ring-white/60" : "border-white/10 hover:border-white/40"
                        }`
                      : `rounded-md border px-2.5 py-1 text-[12px] transition ${
                          active
                            ? "border-white/70 bg-white text-black"
                            : "border-white/10 bg-white/5 text-white/70 hover:border-white/30"
                        }`
                  }
                  title={opt.label}
                >
                  {swatch ? (
                    <span className="relative block aspect-[4/3] w-full">
                      <img src={swatch} alt={opt.label} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                      <span
                        className={`absolute inset-x-0 bottom-0 px-1 py-0.5 text-center text-[10px] ${
                          active ? "bg-white/90 text-black" : "bg-black/55 text-white/90"
                        }`}
                      >
                        {opt.label}
                      </span>
                    </span>
                  ) : (
                    opt.label
                  )}
                </button>
              );
            })}
          </div>
        </ParamRow>
      );
    }
    case "toggle": {
      const on = !!value;
      return (
        <ParamRow label={param.label}>
          <button
            onClick={() => onChange(param.key, !on)}
            className={`relative h-6 w-10 rounded-full transition ${on ? "bg-white" : "bg-white/15"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
                on ? "left-[18px] bg-black" : "left-0.5 bg-white/80"
              }`}
            />
          </button>
        </ParamRow>
      );
    }
    case "color": {
      const v = typeof value === "string" ? value : (param.default as string);
      return (
        <ParamRow label={param.label}>
          <ColorField value={v} onChange={(c) => onChange(param.key, c)} />
        </ParamRow>
      );
    }
    case "colors": {
      const stops = Array.isArray(value) ? (value as string[]) : [];
      return (
        <ParamRow label={param.label}>
          <div className="space-y-1.5">
            {stops.map((stop, i) => (
              <ColorField
                key={i}
                value={stop}
                onChange={(c) => {
                  const next = [...stops];
                  next[i] = c;
                  onChange(param.key, next);
                }}
              />
            ))}
          </div>
        </ParamRow>
      );
    }
    case "float2": {
      const v = Array.isArray(value) ? (value as number[]) : (param.default as number[]);
      return (
        <ParamRow label={param.label}>
          <div className="flex gap-2">
            {[0, 1].map((i) => (
              <input
                key={i}
                type="number"
                step={0.01}
                value={v[i] ?? 0}
                onChange={(e) => {
                  const next = [...v];
                  next[i] = parseFloat(e.target.value) || 0;
                  onChange(param.key, next);
                }}
                className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-[12px] text-white/80"
              />
            ))}
          </div>
        </ParamRow>
      );
    }
    default:
      return null;
  }
}
