import { useMemo } from "react";
import type { EffectSchema } from "../types";
import { ParamControl } from "./ParamControl";

interface ParamPanelProps {
  effect: EffectSchema;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onPreset: (presets: Record<string, unknown>) => void;
  onReset: () => void;
  optionSwatches?: Record<string, Record<string, string>>;
}

export function ParamPanel({ effect, values, onChange, onPreset, onReset, optionSwatches }: ParamPanelProps) {
  const groups = useMemo(() => {
    if (effect.groups?.length) return effect.groups;
    return [{ label: "Parameters", keys: effect.params.map((p) => p.key) }];
  }, [effect]);

  const byKey = useMemo(() => new Map(effect.params.map((p) => [p.key, p])), [effect]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">
          Parameters
        </span>
        <button
          onClick={onReset}
          className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
        >
          重置
        </button>
      </div>
      <div className="flex-1 divide-y divide-white/5 overflow-y-auto px-5 pb-8">
        {groups.map((group) => (
          <div key={group.label} className="py-2">
            <p className="pt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
              {group.label}
            </p>
            {group.keys.map((key) => {
              const param = byKey.get(key);
              if (!param || param.hideFromUI) return null;
              return (
                <ParamControl
                  key={key}
                  param={param}
                  value={values[key]}
                  onChange={onChange}
                  onPreset={onPreset}
                  optionSwatches={optionSwatches?.[key]}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
