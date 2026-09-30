/**
 * [INPUT]: 依赖 comfy.settings.set（agentDefaults）、shadcn Dialog/Button/Input/Label/Select/Textarea、i18n 与 useGenerateStore
 * [OUTPUT]: 「AI 调用默认参数」弹框：按工作流 formSchema 逐非 media 字段编辑 AI/Agent 调用时的默认值（留空=不设置），保存写入 comfy_settings，供 comfy.generate 在非手动调用（origin≠manual）时补全缺省字段
 * [POS]: comfyui-studio UI 的默认参数设置面；WorkflowTab 提交行入口打开，保存后回调刷新目录
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useState } from "react";
import { Check, Eraser, Loader2, Wand2 } from "lucide-react";
import { interpolate, t, type Locale } from "../i18n";
import { recut } from "../recut-sdk";
import { useGenerateStore } from "../state/generate";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogApp, FormField, LocalLabel } from "../types";

interface Props {
  app: CatalogApp;
  locale: Locale;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

function labelText(value: LocalLabel | undefined, locale: Locale, fallback: string) {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  return (locale === "en" ? value.en : value.zh) || value.zh || value.en || fallback;
}

function optionalText(value: LocalLabel | undefined, locale: Locale): string | undefined {
  if (!value) return undefined;
  const text = typeof value === "string" ? value : ((locale === "en" ? value.en : value.zh) || value.zh || value.en || "");
  return text || undefined;
}

function defaultValue(field: FormField): string {
  if (field.default === undefined || field.default === null) return "";
  return String(field.default);
}

// AI 默认可配字段：排除 media（参考素材单独传）与 seed（默认随机，不预设；Agent 需要固定种子时自行显式传）。
function editableFields(app: CatalogApp): FormField[] {
  return app.formSchema.filter((field) => field.type !== "media" && field.key !== "seed");
}

// 初值：已保存的 AI 默认参数，否则用清单默认（formSchema[].default）预填——用户可一键保存整套默认值。
function seedValues(app: CatalogApp): Record<string, string> {
  const next: Record<string, string> = {};
  for (const field of editableFields(app)) next[field.key] = defaultValue(field);
  for (const [key, value] of Object.entries(app.agentDefaults ?? {})) {
    if (key in next && value !== undefined && value !== null) next[key] = String(value);
  }
  return next;
}

export function AgentDefaultsDialog({ app, locale, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>(() => seedValues(app));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDraft(seedValues(app));
    setError("");
    setDone(false);
  }, [app.app]);

  const setValue = (key: string, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

  const useCurrent = () => {
    const values = useGenerateStore.getState().values;
    const next: Record<string, string> = {};
    for (const field of editableFields(app)) next[field.key] = values[field.key] ?? "";
    setDraft(next);
  };

  const clearAll = () => {
    const next: Record<string, string> = {};
    for (const field of editableFields(app)) next[field.key] = "";
    setDraft(next);
  };

  const save = async () => {
    setBusy(true);
    setError("");
    setDone(false);
    try {
      const params: Record<string, unknown> = {};
      for (const field of editableFields(app)) {
        const raw = draft[field.key];
        if (raw === undefined || raw === "") continue;
        params[field.key] = field.type === "number" ? Number(raw) : raw;
      }
      await recut.background.call("comfy.settings.set", { agentDefaults: { app: app.app, params } });
      setDone(true);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{interpolate(t(locale, "defaults.title"), { app: labelText(app.label, locale, app.app) })}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <DialogDescription className="text-[10px] leading-4">{t(locale, "defaults.hint")}</DialogDescription>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => useCurrent()}>
              <Wand2 className="size-3.5" />{t(locale, "defaults.use-current")}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => clearAll()}>
              <Eraser className="size-3.5" />{t(locale, "defaults.clear")}
            </Button>
          </div>

          <div className="mt-4 grid gap-3">
            {editableFields(app).map((field) => {
              const fallback = defaultValue(field);
              const inputPlaceholder = optionalText(field.placeholder, locale) ?? (fallback || undefined);
              const placeholder = fallback ? interpolate(t(locale, "defaults.manifest"), { value: fallback }) : t(locale, "defaults.unset");
              return (
                <div key={field.key} className="grid gap-2">
                  <Label className="text-xs/relaxed text-muted-foreground">{labelText(field.label, locale, field.key)}</Label>
                  {field.type === "textarea" ? (
                    <Textarea value={draft[field.key] ?? ""} placeholder={inputPlaceholder} onChange={(event) => setValue(field.key, event.target.value)} />
                  ) : field.type === "select" ? (
                    <Select value={draft[field.key] ?? ""} onValueChange={(value) => setValue(field.key, value)}>
                      <SelectTrigger className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
                      <SelectContent>
                        {(field.options ?? []).map((option) => (
                          <SelectItem key={option} value={option}>{option}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : field.type === "boolean" ? (
                    <Select value={draft[field.key] ?? ""} onValueChange={(value) => setValue(field.key, value)}>
                      <SelectTrigger className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">{t(locale, "generate.bool-on")}</SelectItem>
                        <SelectItem value="false">{t(locale, "generate.bool-off")}</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type={field.type === "number" ? "number" : "text"}
                      min={field.min}
                      max={field.max}
                      placeholder={inputPlaceholder}
                      value={draft[field.key] ?? ""}
                      onChange={(event) => setValue(field.key, event.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {error ? <p className="mt-3 text-[11px] text-destructive">{interpolate(t(locale, "defaults.error"), { error })}</p> : null}
          {done && !error ? <p className="mt-3 text-[11px] text-success">{t(locale, "defaults.saved")}</p> : null}

          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => void save()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {t(locale, "defaults.save")}
            </Button>
            <span className="text-[10px] text-muted-foreground">{t(locale, "defaults.unset-hint")}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
