/**
 * [INPUT]: 依赖 gen.catalog 的模型清单/formSchema/就绪度、shadcn Select 与环境/下载动作回调
 * [OUTPUT]: 顶部模型切换器（shadcn Select）+ 未就绪时置于表单上方的核心依赖块（准备环境/下载模型/来源）+ 表单提交
 * [POS]: Left「生成」Tab；依赖准备与生成提交都在此收敛，记录 Tab 只负责历史
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { AlertTriangle, Check, Download, Play, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { interpolate, t, type Locale } from "../i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Badge, Button, Card, Field, Input, Textarea } from "../ui";
import type { CatalogModel, FormField, LocalLabel, RuntimeInfo } from "../types";

interface Props {
  models: CatalogModel[];
  runtimes: RuntimeInfo[];
  locale: Locale;
  downloadSource: string;
  onGenerate: (input: Record<string, unknown>) => Promise<void>;
  onSaveDefault: (model: string) => Promise<string>;
  onPrepare: (target: string) => Promise<void>;
  onInstall: (model: string, source: string) => Promise<void>;
  onSetSource: (source: string) => Promise<void>;
}

const SOURCES = ["automatic", "huggingface", "modelscope"] as const;

function labelText(value: LocalLabel | undefined, locale: Locale, fallback: string) {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  return (locale === "en" ? value.en : value.zh) || value.zh || value.en || fallback;
}

function defaultValue(field: FormField): string {
  if (field.default === undefined || field.default === null) return "";
  return String(field.default);
}

export function GenerateTab({ models, runtimes, locale, downloadSource, onGenerate, onSaveDefault, onPrepare, onInstall, onSetSource }: Props) {
  const [modelId, setModelId] = useState(models[0]?.model ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [source, setSource] = useState(downloadSource || "automatic");
  const [hint, setHint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [working, setWorking] = useState(false);

  const model = useMemo(() => models.find((candidate) => candidate.model === modelId) ?? models[0], [models, modelId]);
  const modelKey = model?.model ?? "";

  useEffect(() => {
    if (!modelId && models[0]) setModelId(models[0].model);
  }, [models, modelId]);

  useEffect(() => {
    if (!model) return;
    const next: Record<string, string> = {};
    for (const field of model.formSchema) next[field.key] = defaultValue(field);
    setValues(next);
  }, [modelKey]);

  useEffect(() => setSource(downloadSource || "automatic"), [downloadSource]);

  if (!model) {
    return <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground">{t(locale, "generate.empty-models")}</div>;
  }

  const runtimeReady = runtimes.find((item) => item.id === model.runtime)?.ready ?? false;
  const weightInstalled = model.weight.installed;
  const ready = runtimeReady && weightInstalled;

  const submit = async () => {
    setSubmitting(true);
    setHint("");
    try {
      const input: Record<string, unknown> = { model: model.model };
      for (const [key, raw] of Object.entries(values)) {
        if (raw === "") continue;
        const field = model.formSchema.find((candidate) => candidate.key === key);
        input[key] = field?.type === "number" ? Number(raw) : raw;
      }
      await onGenerate(input);
    } catch (error) {
      setHint(interpolate(t(locale, "generate.failed"), { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSubmitting(false);
    }
  };

  const run = async (action: () => Promise<void>) => {
    setWorking(true);
    try {
      await action();
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label={t(locale, "generate.model")}>
        <Select value={model.model} onValueChange={setModelId}>
          <SelectTrigger>
            <SelectValue placeholder={model.model} />
          </SelectTrigger>
          <SelectContent>
            {models.map((candidate) => (
              <SelectItem key={candidate.model} value={candidate.model}>
                <span className="flex items-center gap-2">
                  <span className={`size-1.5 rounded-full ${candidate.ready ? "bg-success" : "bg-warning"}`} />
                  {labelText(candidate.label, locale, candidate.model)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {!ready && (
        <Card className="border-warning/40 bg-warning/[0.06] p-3.5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">{t(locale, "generate.dep.title")}</p>
              <ul className="mt-2 space-y-1 text-[11px] leading-5 text-muted-foreground">
                <li className="flex items-center gap-1.5">
                  {runtimeReady ? <Check className="size-3 text-success" /> : <span className="size-1.5 rounded-full bg-warning" />}
                  {t(locale, "generate.dep.runtime")} · {model.runtime}
                </li>
                <li className="flex items-center gap-1.5">
                  {weightInstalled ? <Check className="size-3 text-success" /> : <span className="size-1.5 rounded-full bg-warning" />}
                  {t(locale, "generate.dep.weights")}{model.weight.sizeGb ? ` · ~${model.weight.sizeGb}GB` : ""}
                </li>
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={working || runtimeReady} onClick={() => void run(() => onPrepare(model.runtime || "all"))}>
                  <Play className="size-3.5" />{t(locale, "records.prepare")}
                </Button>
                <Button size="sm" disabled={working || weightInstalled} onClick={() => void run(() => onInstall(model.model, source))}>
                  <Download className="size-3.5" />{t(locale, "records.install")}
                </Button>
                <Select value={source} onValueChange={(value) => { setSource(value); void onSetSource(value); }}>
                  <SelectTrigger className="h-7 w-36 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((item) => (
                      <SelectItem key={item} value={item}>{t(locale, `source.${item}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {model.formSchema.map((field) => (
          <Field key={field.key} label={labelText(field.label, locale, field.key)}>
            {field.type === "textarea" ? (
              <Textarea value={values[field.key] ?? ""} onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))} />
            ) : field.type === "select" ? (
              <Select value={values[field.key] ?? ""} onValueChange={(value) => setValues((prev) => ({ ...prev, [field.key]: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                type={field.type === "number" ? "number" : "text"}
                min={field.min}
                max={field.max}
                value={values[field.key] ?? ""}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
              />
            )}
          </Field>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button disabled={!ready || submitting} onClick={() => void submit()}>
          <Wand2 className="size-3.5" />{t(locale, "generate.submit")}
        </Button>
        <Button variant="ghost" onClick={async () => setHint(await onSaveDefault(model.model))}>
          <Sparkles className="size-3.5" />{t(locale, "generate.set-default")}
        </Button>
        {ready ? <Badge tone="success" className="ml-auto">{t(locale, "generate.ready")}</Badge> : null}
      </div>
      {hint ? <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
