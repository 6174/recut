/**
 * [INPUT]: 依赖 modal.catalog 的预设包/函数清单/formSchema/output/gpuTiers/就绪度、shadcn Select/Label/Input/Textarea/Card/Badge/Button、recut.media.pick 全局素材选择器、recut.media.preview 全屏预览、部署/下载/运行回调与 useRunStore
 * [OUTPUT]: 顶部预设包切换器 + 函数切换器 + 常驻环境块（未就绪时部署/下载权重；就绪时「重新部署」单一手动更新入口，deploy 自带 bootstrap，stale=目录 hash 变更时高亮提示）+ GPU 档位选择 + **按 formSchema 逐字段渲染的参考素材输入**（首帧/尾帧/参考图/参考视频/参考音频各自独立，按字段 kind 过滤素材、multiple 决定单选或多选；缩略图全屏预览；预览图经 injectedReference 一键回填）+ 表单提交；提交按字段分组 references={field:[assetId]}；表单状态由 useRunStore 持有并持久化
 * [POS]: Left「功能」Tab；部署、权重与运行都在此收敛，记录 Tab 只负责历史
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { AlertTriangle, Check, Download, ImagePlus, Rocket, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { interpolate, t, type Locale } from "../i18n";
import { recut } from "../recut-sdk";
import { mediaContentPath, mediaContentURL } from "../lib/media";
import { useRunStore } from "../state/run";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FormField, InjectedReference, LocalLabel, MediaAsset, ModalApp, ModalFunction } from "../types";

interface Props {
  modalapps: ModalApp[];
  locale: Locale;
  defaultGpuTier: string;
  injectedReference: InjectedReference | null;
  onRun: (input: Record<string, unknown>) => Promise<void>;
  onDeploy: (modalapp: string) => Promise<void>;
  onInstall: (modalapp: string, source: string) => Promise<void>;
}

const DEFAULT_SOURCE = "huggingface";

function labelText(value: LocalLabel | undefined, locale: Locale, fallback: string) {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  return (locale === "en" ? value.en : value.zh) || value.zh || value.en || fallback;
}

function defaultValue(field: FormField): string {
  if (field.default === undefined || field.default === null) return "";
  return String(field.default);
}

function formDefaults(fn: ModalFunction | undefined): Record<string, string> {
  const next: Record<string, string> = {};
  if (fn) {
    for (const field of fn.formSchema) next[field.key] = defaultValue(field);
    for (const [key, value] of Object.entries(fn.defaultParams ?? {})) if (key in next) next[key] = String(value);
  }
  return next;
}

function mediaFields(fn: ModalFunction | undefined): FormField[] {
  return (fn?.formSchema ?? []).filter((field) => field.type === "media");
}

function fieldAccepts(field: FormField, asset: MediaAsset): boolean {
  return (field.kind ?? "image") === (asset.kind ?? "image");
}

// 把一组素材按字段声明的 kind/multiple 落位（图像 → image 字段，视频 → video 字段…），
// 供「编辑/返修回填」这类没有字段归属的入参推断目标字段。
function placeReferences(fields: FormField[], assets: MediaAsset[]): Record<string, MediaAsset[]> {
  const out: Record<string, MediaAsset[]> = {};
  for (const asset of assets) {
    const target = fields.find((field) => fieldAccepts(field, asset) && (field.multiple !== false || !(out[field.key]?.length)))
      ?? fields.find((field) => field.multiple !== false);
    if (!target) continue;
    (out[target.key] ??= []).push(asset);
  }
  return out;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label className="text-xs/relaxed text-muted-foreground">{label}</Label>
      {children}
      {hint ? <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function RunTab({ modalapps, locale, defaultGpuTier, injectedReference, onRun, onDeploy, onInstall }: Props) {
  const modalappId = useRunStore((state) => state.modalappId);
  const functionId = useRunStore((state) => state.functionId);
  const values = useRunStore((state) => state.values);
  const references = useRunStore((state) => state.references);
  const gpuTier = useRunStore((state) => state.gpuTier);
  const selectModalapp = useRunStore((state) => state.selectModalapp);
  const selectFunction = useRunStore((state) => state.selectFunction);
  const setValue = useRunStore((state) => state.setValue);
  const mergeValues = useRunStore((state) => state.mergeValues);
  const setValues = useRunStore((state) => state.setValues);
  const setReferences = useRunStore((state) => state.setReferences);
  const setFieldReferences = useRunStore((state) => state.setFieldReferences);
  const setGpuTier = useRunStore((state) => state.setGpuTier);

  const [hint, setHint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [working, setWorking] = useState(false);
  const injectedNonceRef = useRef(0);

  const modalapp = useMemo(() => modalapps.find((candidate) => candidate.id === modalappId) ?? modalapps[0], [modalapps, modalappId]);
  const fn = useMemo(() => modalapp?.functions.find((candidate) => candidate.id === functionId) ?? modalapp?.functions[0], [modalapp, functionId]);
  const appKey = modalapp?.id ?? "";
  const fnKey = `${appKey}:${fn?.id ?? ""}`;
  const acceptsMedia = mediaFields(fn).length > 0;

  useEffect(() => {
    if (!modalappId && modalapps[0]) selectModalapp(modalapps[0].id, modalapps[0].functions[0]?.id ?? "", formDefaults(modalapps[0].functions[0]));
  }, [modalapps, modalappId, selectModalapp]);

  // 预设包/函数切换时对齐字段：同一函数只补默认键，切换则重置字段与参考图。
  useEffect(() => {
    if (!modalapp || !fn) return;
    const defaults = formDefaults(fn);
    const stored = useRunStore.getState();
    if (stored.modalappId === modalapp.id && stored.functionId === fn.id) {
      const merged = { ...defaults };
      for (const [key, value] of Object.entries(stored.values)) if (key in merged) merged[key] = value;
      setValues(merged);
      return;
    }
    selectModalapp(modalapp.id, fn.id, defaults);
  }, [fnKey]);

  useEffect(() => {
    if (!injectedReference || injectedReference.nonce === injectedNonceRef.current) return;
    injectedNonceRef.current = injectedReference.nonce;
    if (injectedReference.error) {
      setHint(interpolate(t(locale, "run.edit-failed"), { error: injectedReference.error }));
      return;
    }
    const draft = injectedReference.draft;
    if (draft) {
      const targetApp = modalapps.find((candidate) => candidate.id === draft.modalapp);
      const targetFn = targetApp?.functions.find((candidate) => candidate.id === draft.function) ?? targetApp?.functions[0];
      if (targetApp && targetFn) {
        const next: Record<string, string> = formDefaults(targetFn);
        for (const [key, value] of Object.entries(draft.values ?? {})) if (key in next) next[key] = String(value);
        next.prompt = draft.prompt ?? next.prompt ?? "";
        if (targetApp.id !== modalappId || targetFn.id !== functionId) selectModalapp(targetApp.id, targetFn.id, next);
        else mergeValues(next);
        if (draft.gpuTier) setGpuTier(draft.gpuTier);
        const targetMediaFields = mediaFields(targetFn);
        if (targetMediaFields.length) {
          const assets = (draft.referenceAssetIds ?? []).filter((item) => item.available !== false)
            .map((item) => ({ id: item.id, name: item.name, kind: "image" }));
          setReferences(placeReferences(targetMediaFields, assets));
        } else {
          setReferences({});
          setHint(t(locale, "run.edit-unsupported"));
        }
      }
      return;
    }
    if (!acceptsMedia) {
      setHint(t(locale, "run.edit-unsupported"));
      return;
    }
    const fields = mediaFields(fn);
    const asset: MediaAsset = { id: injectedReference.id, name: injectedReference.name, kind: "image" };
    const current = useRunStore.getState().references;
    const target = fields.find((field) => fieldAccepts(field, asset) && (field.multiple !== false || !(current[field.key]?.length)))
      ?? fields.find((field) => field.multiple !== false);
    if (target) setFieldReferences(target.key, (prev) => (prev.some((item) => item.id === asset.id) ? prev : [...prev, asset]));
    setHint("");
  }, [injectedReference, acceptsMedia, locale, modalapps, modalappId, functionId]);

  if (!modalapp || !fn) {
    return <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground">{t(locale, "run.empty")}</div>;
  }

  const deployed = modalapp.deployed;
  const volumeReady = modalapp.volumeReady;
  const ready = deployed && volumeReady;
  const gpuOptions = modalapp.gpuTiers?.options ?? [];
  const gpuValue = gpuTier || defaultGpuTier || modalapp.gpuTiers?.default || "";

  const pickFieldReferences = async (field: FormField) => {
    try {
      const multiple = field.multiple !== false;
      const selected = (await recut.media.pick([field.kind ?? "image"], { multiple, selectedIDs: (references[field.key] ?? []).map((item) => item.id) })) as MediaAsset[] | null;
      if (!selected) return;
      setFieldReferences(field.key, selected.map((asset) => ({ id: asset.id, name: asset.name, kind: asset.kind ?? field.kind ?? "image" })));
      setHint("");
    } catch (error) {
      setHint(interpolate(t(locale, "run.pick-failed"), { error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setHint("");
    try {
      const params: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(values)) {
        if (raw === "") continue;
        const field = fn.formSchema.find((candidate) => candidate.key === key);
        if (field?.type === "media") continue;
        params[key] = field?.type === "number" ? Number(raw) : raw;
      }
      const input: Record<string, unknown> = { modalapp: modalapp.id, function: fn.id, params, gpuTier: gpuValue, confirmCost: true };
      const grouped: Record<string, string[]> = {};
      for (const field of mediaFields(fn)) {
        const ids = (references[field.key] ?? []).map((asset) => asset.id);
        if (ids.length) grouped[field.key] = ids;
      }
      if (Object.keys(grouped).length) input.references = grouped;
      await onRun(input);
    } catch (error) {
      setHint(interpolate(t(locale, "run.failed"), { error: error instanceof Error ? error.message : String(error) }));
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
    <div className="grid gap-4">
      <Field label={t(locale, "run.modalapp")}>
        <div className="grid gap-1.5">
          <Select value={modalapp.id} onValueChange={(value) => {
            const next = modalapps.find((candidate) => candidate.id === value);
            if (next) selectModalapp(next.id, next.functions[0]?.id ?? "", formDefaults(next.functions[0]));
          }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={modalapp.id} />
            </SelectTrigger>
            <SelectContent>
              {modalapps.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`size-1.5 shrink-0 rounded-full ${candidate.deployed && candidate.volumeReady && !candidate.stale ? "bg-success" : "bg-warning"}`} />
                    <span className="min-w-0 truncate">{labelText(candidate.label, locale, candidate.id)}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={modalapp.origin === "user" ? "border-primary/40 text-primary" : "text-muted-foreground"}>
              {t(locale, modalapp.origin === "user" ? "run.origin-user" : "run.origin-builtin")}
            </Badge>
            {modalapp.origin === "user" && modalapp.path ? (
              <span className="truncate font-mono text-[10px] text-muted-foreground" title={modalapp.path}>{modalapp.path}</span>
            ) : null}
          </div>
        </div>
      </Field>

      {modalapp.functions.length > 1 ? (
        <Field label={t(locale, "run.function")}>
          <Select value={fn.id} onValueChange={(value) => {
            const next = modalapp.functions.find((candidate) => candidate.id === value);
            if (next) selectFunction(next.id, formDefaults(next));
          }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={fn.id} />
            </SelectTrigger>
            <SelectContent>
              {modalapp.functions.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>{labelText(candidate.label, locale, candidate.id)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {!ready ? (
        <Card size="sm" className="border-warning/40 bg-warning/[0.06] p-3.5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">{t(locale, "run.dep.title")}</p>
              <ul className="mt-2 space-y-1 text-[11px] leading-5 text-muted-foreground">
                <li className="flex items-center gap-1.5">
                  {deployed ? <Check className="size-3 text-success" /> : <span className="size-1.5 rounded-full bg-warning" />}
                  {t(locale, "run.dep.deploy")} · {modalapp.appName}
                </li>
                <li className="flex items-center gap-1.5">
                  {volumeReady ? <Check className="size-3 text-success" /> : <span className="size-1.5 rounded-full bg-warning" />}
                  {t(locale, "run.dep.weights")}{modalapp.weights?.sizeGb ? ` · ~${modalapp.weights.sizeGb}GB` : ""}
                </li>
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* 部署与权重合并：未部署→一次「准备（部署 + 权重）」；已部署仅缺权重→「下载权重（续传）」。来源固定 Hugging Face。 */}
                <Button size="sm" disabled={working} onClick={() => void run(() => (deployed ? onInstall(modalapp.id, DEFAULT_SOURCE) : onDeploy(modalapp.id)))}>
                  {deployed ? <Download className="size-3.5" /> : <Rocket className="size-3.5" />}
                  {deployed ? t(locale, "run.install") : t(locale, "run.prepare")}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card size="sm" className={`p-3.5 ${modalapp.stale ? "border-warning/40 bg-warning/[0.06]" : ""}`}>
          <div className="flex items-start gap-2.5">
            {modalapp.stale ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            ) : (
              <Check className="mt-0.5 size-4 shrink-0 text-success" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">{modalapp.stale ? t(locale, "run.stale.title") : t(locale, "run.ready")}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{t(locale, "run.env-hint")} · {modalapp.appName}</p>
            </div>
          </div>
          {/* 常驻手动更新入口：一个动作即可——deploy 自带 bootstrap，权重会一并刷新（bootstrap 自身跳过已下载）。 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant={modalapp.stale ? "default" : "outline"} disabled={working} onClick={() => void run(() => onDeploy(modalapp.id))}>
              <Rocket className="size-3.5" />{t(locale, "run.redeploy")}
            </Button>
          </div>
        </Card>
      )}

      <div className="grid gap-3">
        {fn.formSchema.filter((field) => field.type !== "media").map((field) => (
          <Field key={field.key} label={labelText(field.label, locale, field.key)}>
            {field.type === "textarea" ? (
              <Textarea value={values[field.key] ?? ""} onChange={(event) => setValue(field.key, event.target.value)} />
            ) : field.type === "select" ? (
              <Select value={values[field.key] ?? ""} onValueChange={(value) => setValue(field.key, value)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "boolean" ? (
              <Select value={values[field.key] ?? "false"} onValueChange={(value) => setValue(field.key, value)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">{t(locale, "run.bool-on")}</SelectItem>
                  <SelectItem value="false">{t(locale, "run.bool-off")}</SelectItem>
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

        {mediaFields(fn).map((field) => {
          const fieldRefs = references[field.key] ?? [];
          const multiple = field.multiple !== false;
          return (
            <Field key={field.key} label={labelText(field.label, locale, field.key)} hint={multiple ? t(locale, "run.references-hint") : undefined}>
              <div className="flex flex-wrap items-center gap-2">
                {fieldRefs.map((asset) => (
                  <div key={asset.id} className="group relative size-16 overflow-hidden rounded-md border bg-muted">
                    <button
                      type="button"
                      title={t(locale, "run.preview-reference")}
                      onClick={() => void recut.media.preview(mediaContentURL(asset.id), { name: asset.name || asset.id })}
                      className="block size-full cursor-zoom-in"
                    >
                      <img className="size-full object-cover" src={mediaContentPath(asset.id)} alt={asset.name || asset.id} />
                    </button>
                    <button
                      type="button"
                      title={t(locale, "run.remove-reference")}
                      onClick={() => setFieldReferences(field.key, (prev) => prev.filter((item) => item.id !== asset.id))}
                      className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-background/85 text-foreground opacity-0 transition group-hover:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                {multiple || fieldRefs.length === 0 ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => void pickFieldReferences(field)}>
                    <ImagePlus className="size-3.5" />{t(locale, "run.add-reference")}
                  </Button>
                ) : null}
              </div>
            </Field>
          );
        })}

        {fn.minReferences ? (
          <p className="text-[11px] leading-4 text-muted-foreground">{interpolate(t(locale, "run.references-min"), { count: String(fn.minReferences) })}</p>
        ) : null}

        {gpuOptions.length > 0 ? (
          <Field label={t(locale, "run.gpu")} hint={t(locale, "run.cost-hint")}>
            <Select value={gpuValue} onValueChange={setGpuTier}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {gpuOptions.map((option) => (
                  <SelectItem key={option.id} value={option.gpu}>{labelText(option.label, locale, option.gpu)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button disabled={!ready || submitting} onClick={() => void submit()}>
          <Wand2 className="size-3.5" />{t(locale, "run.submit")}
        </Button>
        {ready ? (
          modalapp.stale
            ? <Badge variant="outline" className="ml-auto gap-1.5 border-warning/40 text-warning"><AlertTriangle className="size-3" />{t(locale, "run.stale.badge")}</Badge>
            : <Badge variant="outline" className="ml-auto gap-1.5 border-success/40 text-success"><Check className="size-3" />{t(locale, "run.ready")}</Badge>
        ) : (
          <Badge variant="outline" className="ml-auto border-warning/40 text-warning">{deployed ? t(locale, "run.no-weights") : t(locale, "run.not-deployed")}</Badge>
        )}
      </div>
      {hint ? <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
