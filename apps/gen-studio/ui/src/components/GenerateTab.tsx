/**
 * [INPUT]: 依赖 gen.catalog 的模型清单/formSchema/inputModes/就绪度、shadcn Select、recut.media.pick 全局素材选择器、recut.media.preview 全屏预览、环境/下载动作回调与 useGenerateStore
 * [OUTPUT]: 顶部模型切换器（shadcn Select）+ 未就绪时置于表单上方的核心依赖块（准备环境/下载模型/来源）+ 支持 image 输入的模型上的多选参考图（缩略图点击经 recut.media.preview 全屏预览；预览图经 injectedReference 一键回填）+ 表单提交；模型/参数/参考图/下载源由 useGenerateStore 持有并持久化
 * [POS]: Left「生成」Tab；依赖准备与生成提交都在此收敛，记录 Tab 只负责历史；表单状态在 store，切 Tab 不丢
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { AlertTriangle, Check, Download, ImagePlus, Play, Sparkles, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { interpolate, t, type Locale } from "../i18n";
import { recut } from "../recut-sdk";
import { mediaContentPath, mediaContentURL } from "../lib/media";
import { useGenerateStore } from "../state/generate";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Badge, Button, Card, Field, Input, Textarea } from "../ui";
import type { CatalogModel, FormField, InjectedReference, LocalLabel, MediaAsset, RuntimeInfo } from "../types";

interface Props {
  models: CatalogModel[];
  runtimes: RuntimeInfo[];
  locale: Locale;
  downloadSource: string;
  injectedReference: InjectedReference | null;
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

function formDefaults(model: CatalogModel | undefined): Record<string, string> {
  const next: Record<string, string> = {};
  if (model) for (const field of model.formSchema) next[field.key] = defaultValue(field);
  return next;
}

export function GenerateTab({ models, runtimes, locale, downloadSource, injectedReference, onGenerate, onSaveDefault, onPrepare, onInstall, onSetSource }: Props) {
  const modelId = useGenerateStore((state) => state.modelId);
  const values = useGenerateStore((state) => state.values);
  const references = useGenerateStore((state) => state.references);
  const source = useGenerateStore((state) => state.source);
  const selectModel = useGenerateStore((state) => state.selectModel);
  const setModelId = useGenerateStore((state) => state.setModelId);
  const setValue = useGenerateStore((state) => state.setValue);
  const mergeValues = useGenerateStore((state) => state.mergeValues);
  const setValues = useGenerateStore((state) => state.setValues);
  const setReferences = useGenerateStore((state) => state.setReferences);
  const setSource = useGenerateStore((state) => state.setSource);

  const [hint, setHint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [working, setWorking] = useState(false);
  const injectedNonceRef = useRef(0);

  const model = useMemo(() => models.find((candidate) => candidate.model === modelId) ?? models[0], [models, modelId]);
  const modelKey = model?.model ?? "";
  const canUseImage = Array.isArray(model?.inputModes) && model.inputModes.includes("image");

  useEffect(() => {
    if (!modelId && models[0]) setModelId(models[0].model);
  }, [models, modelId, setModelId]);

  // 模型 schema 就绪/切换时对齐字段：值已属于该模型则只补默认键（保留持久化与草稿输入），
  // 否则视为切换模型，重置字段与参考图。仅在 modelKey 变化时运行，目录刷新不覆盖输入。
  useEffect(() => {
    if (!model) return;
    const defaults = formDefaults(model);
    const stored = useGenerateStore.getState();
    if (stored.modelId === model.model) {
      const merged = { ...defaults };
      for (const [key, value] of Object.entries(stored.values)) if (key in merged) merged[key] = value;
      setValues(merged);
      return;
    }
    setModelId(model.model);
    setValues(defaults);
    setReferences([]);
  }, [modelKey]);

  useEffect(() => {
    if (!injectedReference || injectedReference.nonce === injectedNonceRef.current) return;
    injectedNonceRef.current = injectedReference.nonce;
    if (injectedReference.error) {
      setHint(interpolate(t(locale, "generate.edit-failed"), { error: injectedReference.error }));
      return;
    }
    const draft = injectedReference.draft;
    if (draft) {
      const target = models.find((candidate) => candidate.model === draft.model);
      if (target && target.model !== modelId) setModelId(target.model);
      const next: Record<string, string> = formDefaults(target);
      next.prompt = draft.prompt ?? next.prompt ?? "";
      if (draft.negativePrompt) next.negativePrompt = draft.negativePrompt;
      if (draft.aspectRatio) next.aspectRatio = draft.aspectRatio;
      if (draft.seed !== undefined) next.seed = String(draft.seed);
      if (draft.steps !== undefined) next.steps = String(draft.steps);
      if (draft.cfg !== undefined) next.cfg = String(draft.cfg);
      mergeValues(next);
      const targetCanUseImage = Array.isArray(target?.inputModes) && target.inputModes.includes("image");
      if (targetCanUseImage) {
        setReferences((draft.referenceAssetIds ?? []).filter((item) => item.available !== false).map((item) => ({ id: item.id, name: item.name, kind: "image" })));
      } else {
        setReferences([]);
        setHint(t(locale, "generate.edit-unsupported"));
      }
      return;
    }
    if (!canUseImage) {
      setHint(t(locale, "generate.edit-unsupported"));
      return;
    }
    setReferences((prev) => (prev.some((item) => item.id === injectedReference.id) ? prev : [...prev, { id: injectedReference.id, name: injectedReference.name, kind: "image" }]));
    setHint("");
  }, [injectedReference, canUseImage, locale, models, modelId]);

  useEffect(() => setSource(downloadSource || "automatic"), [downloadSource]);

  if (!model) {
    return <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground">{t(locale, "generate.empty-models")}</div>;
  }

  const runtimeReady = runtimes.find((item) => item.id === model.runtime)?.ready ?? false;
  const weightInstalled = model.weight.installed;
  const ready = runtimeReady && weightInstalled;
  const supportsImage = canUseImage;

  const pickReferences = async () => {
    try {
      const selected = (await recut.media.pick(["image"], { multiple: true, selectedIDs: references.map((item) => item.id) })) as MediaAsset[] | null;
      if (!selected) return;
      setReferences(selected.map((asset) => ({ id: asset.id, name: asset.name, kind: asset.kind ?? "image" })));
      setHint("");
    } catch (error) {
      setHint(interpolate(t(locale, "generate.pick-failed"), { error: error instanceof Error ? error.message : String(error) }));
    }
  };

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
      if (supportsImage && references.length) input.referenceAssetIds = references.map((asset) => asset.id);
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
        <Select value={model.model} onValueChange={(value) => selectModel(value, formDefaults(models.find((candidate) => candidate.model === value)))}>
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
              <Textarea value={values[field.key] ?? ""} onChange={(event) => setValue(field.key, event.target.value)} />
            ) : field.type === "select" ? (
              <Select value={values[field.key] ?? ""} onValueChange={(value) => setValue(field.key, value)}>
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
                onChange={(event) => setValue(field.key, event.target.value)}
              />
            )}
          </Field>
        ))}

        {supportsImage ? (
          <Field label={t(locale, "generate.references")} hint={t(locale, "generate.references-hint")}>
            <div className="flex flex-wrap items-center gap-2">
              {references.map((asset) => (
                <div key={asset.id} className="group relative size-16 overflow-hidden rounded-md border bg-muted">
                  <button
                    type="button"
                    title={t(locale, "generate.preview-reference")}
                    onClick={() => void recut.media.preview(mediaContentURL(asset.id), { name: asset.name || asset.id })}
                    className="block size-full cursor-zoom-in"
                  >
                    <img className="size-full object-cover" src={mediaContentPath(asset.id)} alt={asset.name || asset.id} />
                  </button>
                  <button
                    type="button"
                    title={t(locale, "generate.remove-reference")}
                    onClick={() => setReferences((prev) => prev.filter((item) => item.id !== asset.id))}
                    className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-background/85 text-foreground opacity-0 transition group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => void pickReferences()}>
                <ImagePlus className="size-3.5" />{t(locale, "generate.add-reference")}
              </Button>
            </div>
          </Field>
        ) : null}
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
