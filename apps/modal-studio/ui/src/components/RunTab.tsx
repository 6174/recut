/**
 * [INPUT]: 依赖 modal.catalog/overview 的预设包/函数清单/formSchema/output/gpuTiers/就绪度（就绪度可缺省＝尚未探测）、shadcn Select/Label/Input/Textarea/Card/Badge/Button、recut.media.pick 全局素材选择器、recut.media.preview 全屏预览、部署/下载/运行回调、AgentDefaultsDialog 与 useRunStore
 * [OUTPUT]: 顶部预设包切换器 + 函数切换器 + 三态常驻环境块（**就绪度未知＝尚未探测**→低存在感「待检查」提示，不误报未部署；未就绪→部署/下载权重；就绪→「重新部署」单一手动更新入口，deploy 自带 bootstrap，stale=目录 hash 变更时高亮提示）+ GPU 档位选择（用户选过就记住，没选过回落到预设包默认；候选不在当前 options 内即忽略，保证永不空白）+ **按 formSchema 逐字段渲染的输入**（textarea 带 placeholder、字段带 hint；标记 `randomizable` 的数字字段如随机种子带「随机」按钮，一键填入区间内随机整数）+ **按 formSchema 逐字段渲染的参考素材输入**（首帧/尾帧/参考图/参考视频/参考音频各自独立，按字段 kind 过滤素材、multiple 决定单选或多选；缩略图全屏预览；预览图经 injectedReference 一键回填）+ 表单提交（**提交前经 onEnsureReady 动态校验该预设包的就绪度**，已确定未就绪则提示先准备或重新部署、不提交；未知则照常提交，由云端给出真实失败原因）；提交带 origin:"manual" 按字段分组 references={field:[assetId]}；**表单按预设包分片由 useRunStore 持有并持久化**（切预设包即恢复该包上次的表单与档位）+ 提交行的「AI 默认参数」入口（AgentDefaultsDialog：配置该函数 AI/Agent 调用时的默认参数）
 * [POS]: Left「功能」Tab；部署、权重与运行都在此收敛，记录 Tab 只负责历史
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { AlertTriangle, Check, Dices, Download, ImagePlus, Rocket, SlidersHorizontal, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { interpolate, t, type Locale } from "../i18n";
import { recut } from "../recut-sdk";
import { mediaContentPath, mediaContentURL } from "../lib/media";
import { EMPTY_FN, EMPTY_FORM, useRunStore } from "../state/run";
import { AgentDefaultsDialog } from "./AgentDefaultsDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FormField, GpuTier, InjectedReference, LocalLabel, MediaAsset, ModalApp, ModalFunction } from "../types";

interface Props {
  modalapps: ModalApp[];
  locale: Locale;
  defaultGpuTier: string;
  injectedReference: InjectedReference | null;
  onRun: (input: Record<string, unknown>) => Promise<void>;
  /** 提交前的就绪度动态校验：返回该预设包的最新部署/权重状态（未知字段缺省）。 */
  onEnsureReady: (modalapp: string) => Promise<{ deployed?: boolean; volumeReady?: boolean }>;
  onDeploy: (modalapp: string) => Promise<void>;
  onInstall: (modalapp: string, source: string) => Promise<void>;
  onSavedDefaults: () => Promise<void> | void;
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

// 「随机」按钮：在字段声明的 [min, max] 内取一个整数。种子无 min/max 时用 0..2^31-1，
// 与 h3_contract.normalize_seed 的取值区间一致（SGLang 只接受非负整数种子）。
function randomValue(field: FormField): number {
  const low = Math.ceil(field.min ?? 0);
  const high = Math.floor(field.max ?? 2147483647);
  if (high <= low) return low;
  return low + Math.floor(Math.random() * (high - low + 1));
}

function formDefaults(fn: ModalFunction | undefined): Record<string, string> {
  const next: Record<string, string> = {};
  if (fn) {
    for (const field of fn.formSchema) next[field.key] = defaultValue(field);
    for (const [key, value] of Object.entries(fn.defaultParams ?? {})) if (key in next) next[key] = String(value);
  }
  return next;
}

function sameValues(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

// select 的显示值：用户的值必须落在该字段的 options 内，否则回落字段默认值——持久化的历史值
// 在清单改过（选项增删）之后不该渲染成空白。
function selectValue(field: FormField, raw: string | undefined): string {
  if (raw && (field.options ?? []).includes(raw)) return raw;
  return defaultValue(field);
}

// 档位优先级：用户为该预设包选过的 > 全局默认 > 预设包默认；候选必须落在当前 options 内，否则忽略
// （跨预设包残留的档位与全局默认都可能不属于当前预设包，直接渲染就会让 Select 变空白）。
function resolveGpuTier(options: GpuTier[], selected: string, globalDefault: string, appDefault: string): string {
  const available = new Set(options.map((option) => option.gpu));
  for (const candidate of [selected, globalDefault, appDefault]) {
    if (candidate && available.has(candidate)) return candidate;
  }
  return options[0]?.gpu ?? "";
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

export function RunTab({ modalapps, locale, defaultGpuTier, injectedReference, onRun, onEnsureReady, onDeploy, onInstall, onSavedDefaults }: Props) {
  const activeId = useRunStore((state) => state.activeId);
  const forms = useRunStore((state) => state.forms);
  const selectModalapp = useRunStore((state) => state.selectModalapp);
  const selectFunction = useRunStore((state) => state.selectFunction);
  const setValue = useRunStore((state) => state.setValue);
  const setReferences = useRunStore((state) => state.setReferences);
  const setFieldReferences = useRunStore((state) => state.setFieldReferences);
  const setGpuTier = useRunStore((state) => state.setGpuTier);

  const [hint, setHint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [working, setWorking] = useState(false);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const injectedNonceRef = useRef(0);

  const modalapp = useMemo(() => modalapps.find((candidate) => candidate.id === activeId) ?? modalapps[0], [modalapps, activeId]);
  const appKey = modalapp?.id ?? "";
  const form = forms[appKey] ?? EMPTY_FORM;
  const fn = useMemo(() => modalapp?.functions.find((candidate) => candidate.id === form.functionId) ?? modalapp?.functions[0], [modalapp, form.functionId]);
  const fnKey = `${appKey}:${fn?.id ?? ""}`;
  const shard = form.functions[fn?.id ?? ""];
  const values = shard?.values ?? EMPTY_FN.values;
  const references = shard?.references ?? EMPTY_FN.references;
  const acceptsMedia = mediaFields(fn).length > 0;

  // 每个预设包一份持久分片（useRunStore.forms[预设包 id]），分片内再按函数分片（functions[函数 id]）。
  // 这里只做「对齐」：没有预设包分片/还没切过去 → 建一份；当前函数没有自己的分片 → 按默认值建一个；
  // 已有函数分片 → 只补新增字段的默认值（例如后来加的「分辨率」）。用户填过的值一律保留，所以切函数、
  // 切预设包、切 Tab、刷新后再回来都是上次的样子。依赖只用这两个 key，避免分片写入反过来再触发本 effect。
  useEffect(() => {
    if (!modalapp || !fn) return;
    const store = useRunStore.getState();
    const current = store.forms[modalapp.id];
    if (!current || store.activeId !== modalapp.id) {
      store.selectModalapp(modalapp.id, fn.id, formDefaults(fn));
      return;
    }
    if (current.functionId !== fn.id) {
      store.selectFunction(fn.id, formDefaults(fn));
      return;
    }
    const shard = current.functions[fn.id];
    if (!shard) {
      store.selectFunction(fn.id, formDefaults(fn));
      return;
    }
    const merged: Record<string, string> = { ...formDefaults(fn) };
    for (const [key, value] of Object.entries(shard.values)) if (key in merged) merged[key] = value;
    if (!sameValues(merged, shard.values)) store.setValues(merged);
  }, [appKey, fnKey]);

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
        // 回填是一份现成的表单：直接覆盖该预设包的分片并把 activeId 切过去（而不是「恢复上次」）。
        useRunStore.getState().applyForm(targetApp.id, targetFn.id, next);
        if (draft.gpuTier) useRunStore.getState().setGpuTier(draft.gpuTier);
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
    const state = useRunStore.getState();
    const current = state.forms[state.activeId]?.functions[fn.id]?.references ?? {};
    const target = fields.find((field) => fieldAccepts(field, asset) && (field.multiple !== false || !(current[field.key]?.length)))
      ?? fields.find((field) => field.multiple !== false);
    if (target) setFieldReferences(target.key, (prev) => (prev.some((item) => item.id === asset.id) ? prev : [...prev, asset]));
    setHint("");
  }, [injectedReference, acceptsMedia, locale, modalapps, fn]);

  if (!modalapp || !fn) {
    return <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground">{t(locale, "run.empty")}</div>;
  }

  // 就绪度是三态：未知（本机还没探测过）／已知未就绪／就绪。未知不当作「尚未部署」，否则首屏
  // （modal.status 还没回来）会把已部署的预设包误报成需要部署。
  const known = modalapp.deployed !== undefined;
  const deployed = modalapp.deployed === true;
  const volumeReady = modalapp.volumeReady === true;
  const ready = deployed && volumeReady;
  const gpuOptions = modalapp.gpuTiers?.options ?? [];
  const gpuValue = resolveGpuTier(gpuOptions, form.gpuTier, defaultGpuTier, modalapp.gpuTiers?.default ?? "");

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
      // 点击运行时动态校验就绪度：只有「已确定未就绪」才拦下并引导去准备/重新部署；
      // 未知（探测失败/还没探过）不拦——后台的提交契约是永不拒绝，真实失败原因由任务日志给出。
      const state = await onEnsureReady(modalapp.id);
      if (state.deployed === false || state.volumeReady === false) {
        setHint(t(locale, "run.not-ready-hint"));
        return;
      }
      const params: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(values)) {
        if (raw === "") continue;
        const field = fn.formSchema.find((candidate) => candidate.key === key);
        if (field?.type === "media") continue;
        params[key] = field?.type === "number" ? Number(raw) : raw;
      }
      const input: Record<string, unknown> = { modalapp: modalapp.id, function: fn.id, params, gpuTier: gpuValue, confirmCost: true, origin: "manual" };
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
                    <span className={`size-1.5 shrink-0 rounded-full ${candidate.deployed === undefined ? "bg-muted-foreground/40" : candidate.deployed && candidate.volumeReady && !candidate.stale ? "bg-success" : "bg-warning"}`} />
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

      {!known ? (
        // 就绪度未知：低存在感提示（不抢眼），预设包状态由后台探测回填；运行按钮保持可用，
        // 点了会先动态校验一次。
        <Card size="sm" className="p-3.5">
          <div className="flex items-start gap-2.5">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">{t(locale, "run.checking.title")}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{t(locale, "run.checking.hint")}</p>
            </div>
          </div>
        </Card>
      ) : !ready ? (
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
          <Field
            key={field.key}
            label={labelText(field.label, locale, field.key)}
            hint={field.hint ? labelText(field.hint, locale, "") : undefined}
          >
            {field.type === "textarea" ? (
              <Textarea
                value={values[field.key] ?? ""}
                placeholder={field.placeholder ? labelText(field.placeholder, locale, "") : undefined}
                onChange={(event) => setValue(field.key, event.target.value)}
              />
            ) : field.type === "select" ? (
              <Select value={selectValue(field, values[field.key])} onValueChange={(value) => setValue(field.key, value)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={field.placeholder ? labelText(field.placeholder, locale, "") : undefined} />
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
            ) : field.randomizable ? (
              <div className="flex items-center gap-2">
                <Input
                  type={field.type === "number" ? "number" : "text"}
                  min={field.min}
                  max={field.max}
                  className="flex-1"
                  value={values[field.key] ?? ""}
                  onChange={(event) => setValue(field.key, event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setValue(field.key, String(randomValue(field)))}
                >
                  <Dices className="size-3.5" />{t(locale, "run.random")}
                </Button>
              </div>
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
        {/* 运行按钮不再以就绪度为门槛：状态未知时它必须可点（点击即做一次动态校验），
            已确定未就绪时点击则给出「先准备/重新部署」的引导。 */}
        <Button disabled={submitting} onClick={() => void submit()}>
          <Wand2 className="size-3.5" />{t(locale, "run.submit")}
        </Button>
        <Button variant="ghost" onClick={() => setDefaultsOpen(true)}>
          <SlidersHorizontal className="size-3.5" />{t(locale, "run.defaults")}
        </Button>
        {!known ? (
          <Badge variant="outline" className="ml-auto text-muted-foreground">{t(locale, "run.status-unknown")}</Badge>
        ) : ready ? (
          modalapp.stale
            ? <Badge variant="outline" className="ml-auto gap-1.5 border-warning/40 text-warning"><AlertTriangle className="size-3" />{t(locale, "run.stale.badge")}</Badge>
            : <Badge variant="outline" className="ml-auto gap-1.5 border-success/40 text-success"><Check className="size-3" />{t(locale, "run.ready")}</Badge>
        ) : (
          <Badge variant="outline" className="ml-auto border-warning/40 text-warning">{deployed ? t(locale, "run.no-weights") : t(locale, "run.not-deployed")}</Badge>
        )}
      </div>
      {hint ? <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p> : null}

      {defaultsOpen ? (
        <AgentDefaultsDialog modalapp={modalapp} fn={fn} locale={locale} onClose={() => setDefaultsOpen(false)} onSaved={onSavedDefaults} />
      ) : null}
    </div>
  );
}
