/*
 * [INPUT]: 依赖 lucide 图标、RichComposer（统一富文本输入，支持 @ 引用）、CustomSelect、共享素材选择器 AssetReferenceDialog（含上传）、lib/scenarios 的场景契约与 scenario i18n
 * [OUTPUT]: 对外提供 ScenarioDialog：弹框壳 + 标题头；主体按场景选择——声明了 Form 的自定义场景渲染该组件，否则按 fields 渲染通用结构化表单（文本 / 富文本 @ / 下拉 / 从资源库选素材），校验必填后把「场景提示词 + 创作需求（含 <media> 引用）」组装为草稿
 * [POS]: web/components 的创作场景表单宿主；只组装文本草稿，绝不自动发送（遵循 agent-panel-context 草稿契约）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Globe2, Music2, Upload, Video, X } from "lucide-react";
import { useMemo, useState } from "react";

import { AssetReferenceDialog } from "@/components/asset-reference-picker";
import { RichComposer } from "@/components/rich-composer/rich-composer";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/select-field";
import { MediaAssetEventsProvider } from "@/components/use-media-asset-events";
import { WorldPicker, type WorldPick } from "@/components/world-picker";
import { useI18n } from "@/lib/i18n/index";
import { serializeAttributes } from "@/lib/rich-composer/protocol/xml";
import { localizedLabel, type Scenario, type ScenarioAssetKind, type ScenarioField, type ScenarioFieldOption } from "@/lib/scenarios";
import type { RichComposerValue } from "@/lib/rich-composer/value";

type PickedAsset = { assetId: string; name: string; kind: ScenarioAssetKind; mimeType: string };

const emptyValue: RichComposerValue = { text: "", refs: [], isEmpty: true };

function assetContentUrl(apiBase: string, assetId: string): string {
  return `${apiBase}/v1/media/assets/${encodeURIComponent(assetId)}/content`;
}

export function ScenarioDialog({ apiBase, onClose, onSubmit, scenario }: { apiBase: string; onClose: () => void; onSubmit: (text: string) => void; scenario: Scenario }) {
  const { locale, t } = useI18n();
  const Icon = scenario.icon;
  const Form = scenario.Form;
  return (
    <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog" aria-labelledby="scenario-form-title">
      <section className="flex max-h-[86vh] w-full max-w-xl flex-col rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()} onKeyDownCapture={(event) => { if (event.key === "Escape") onClose(); }}>
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-4" /></span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold" id="scenario-form-title">{localizedLabel(scenario.title, locale)}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{localizedLabel(scenario.description, locale)}</p>
            </div>
          </div>
          <button aria-label={t("scenario.form.close")} className="grid size-8 shrink-0 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button"><X className="size-4" /></button>
        </header>
        {Form
          ? <Form apiBase={apiBase} locale={locale} onClose={onClose} onSubmit={onSubmit} scenario={scenario} />
          : <DefaultScenarioForm apiBase={apiBase} onClose={onClose} onSubmit={onSubmit} scenario={scenario} />}
      </section>
    </div>
  );
}

function DefaultScenarioForm({ apiBase, onClose, onSubmit, scenario }: { apiBase: string; onClose: () => void; onSubmit: (text: string) => void; scenario: Scenario }) {
  const { locale, t } = useI18n();
  const [values, setValues] = useState<Record<string, RichComposerValue>>(() => Object.fromEntries(scenario.fields.filter((field) => field.type !== "select" && field.type !== "assets" && field.type !== "world").map((field) => [field.key, emptyValue])));
  const [selects, setSelects] = useState<Record<string, string>>(() => Object.fromEntries(scenario.fields.filter((field) => field.type === "select").map((field) => [field.key, ""])));
  const [assets, setAssets] = useState<Record<string, PickedAsset[]>>(() => Object.fromEntries(scenario.fields.filter((field) => field.type === "assets").map((field) => [field.key, []])));
  const [worlds, setWorlds] = useState<Record<string, WorldPick | null>>(() => Object.fromEntries(scenario.fields.filter((field) => field.type === "world").map((field) => [field.key, null])));
  const [pickerField, setPickerField] = useState<ScenarioField | null>(null);
  const [pickerWorld, setPickerWorld] = useState<ScenarioField | null>(null);
  const [error, setError] = useState("");
  const separator = locale === "zh" ? "：" : ": ";

  const optionsByField = useMemo(() => Object.fromEntries(scenario.fields.map((field) => [field.key, (field.options ?? []).map((option: ScenarioFieldOption) => ({ value: option.value, label: localizedLabel(option.label, locale) }))])), [locale, scenario.fields]);

  function addAssets(fieldKey: string, picked: PickedAsset[]) {
    setAssets((prev) => {
      const merged = [...(prev[fieldKey] ?? [])];
      for (const asset of picked) if (!merged.some((item) => item.assetId === asset.assetId)) merged.push(asset);
      return { ...prev, [fieldKey]: merged };
    });
  }

  function submit() {
    const missing = scenario.fields.some((field) => {
      if (!field.required) return false;
      if (field.type === "select") return !selects[field.key];
      if (field.type === "assets") return !(assets[field.key] ?? []).length;
      if (field.type === "world") return !worlds[field.key];
      return !values[field.key]?.text.trim();
    });
    if (missing) {
      setError(t("scenario.form.missing"));
      return;
    }
    const lines = scenario.fields.flatMap((field) => {
      if (field.type === "select") {
        const option = optionsByField[field.key]?.find((item) => item.value === selects[field.key]);
        return option ? [`${localizedLabel(field.label, locale)}${separator}${option.label}`] : [];
      }
      if (field.type === "assets") {
        const tags = (assets[field.key] ?? []).map((asset) => `<media${serializeAttributes({ type: asset.kind, assetid: asset.assetId, name: asset.name }, ["type", "assetid", "name"])} />`);
        return tags.length ? [`${localizedLabel(field.label, locale)}${separator}${tags.join(" ")}`] : [];
      }
      if (field.type === "world") {
        const picked = worlds[field.key];
        return picked ? [`${localizedLabel(field.label, locale)}${separator}<creation_world${serializeAttributes({ worldid: picked.worldId, name: picked.name }, ["worldid", "name"])} />`] : [];
      }
      const text = values[field.key]?.text.trim();
      return text ? [`${localizedLabel(field.label, locale)}${separator}${text}`] : [];
    });
    const brief = [t("scenario.form.briefHeading"), ...lines].join("\n");
    onSubmit(`${localizedLabel(scenario.prompt, locale)}\n\n${brief}`);
  }

  return <>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <p className="text-xs text-muted-foreground">{t("scenario.form.subtitle")}</p>
      <div className="mt-4 flex flex-col gap-4">
        {scenario.fields.map((field) => {
          const label = localizedLabel(field.label, locale);
          return <div key={field.key}>
            <div className="flex items-baseline justify-between gap-2">
              <label className="text-xs font-medium" htmlFor={`scenario-field-${field.key}`}>{label}{field.required && <span className="ml-0.5 text-primary">*</span>}</label>
              {field.required && <span className="text-[10px] text-muted-foreground">{t("scenario.form.required")}</span>}
            </div>
            {field.type === "select"
              ? <CustomSelect id={`scenario-field-${field.key}`} onChange={(value) => setSelects((prev) => ({ ...prev, [field.key]: value }))} options={optionsByField[field.key] ?? []} value={selects[field.key] ?? ""} />
              : field.type === "assets"
                ? <div className="mt-1 flex flex-wrap items-center gap-2">
                  {(assets[field.key] ?? []).map((asset) => <span className="flex items-center gap-1.5 rounded-sm border bg-background py-0.5 pl-0.5 pr-1.5 text-xs" key={asset.assetId}>{asset.kind === "image" ? <img alt="" className="size-6 rounded-xs object-cover" src={assetContentUrl(apiBase, asset.assetId)} /> : <span className="grid size-6 place-items-center rounded-xs bg-muted text-muted-foreground">{asset.kind === "audio" ? <Music2 className="size-3" /> : <Video className="size-3" />}</span>}<span className="max-w-32 truncate">{asset.name}</span><button aria-label={`${t("scenario.form.removeAsset")} ${asset.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => setAssets((prev) => ({ ...prev, [field.key]: (prev[field.key] ?? []).filter((item) => item.assetId !== asset.assetId) }))} type="button"><X className="size-3" /></button></span>)}
                  <button className="inline-flex items-center gap-1 rounded-sm border border-dashed px-2 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground" onClick={() => setPickerField(field)} type="button"><Upload className="size-3.5" />{t("scenario.form.pickAssets")}</button>
                </div>
                : field.type === "world"
                  ? <div className="mt-1 flex flex-wrap items-center gap-2">
                    {worlds[field.key]
                      ? <span className="flex items-center gap-1.5 rounded-sm border bg-background py-1 pl-1 pr-1.5 text-xs"><span className="grid size-5 shrink-0 place-items-center rounded-xs bg-muted text-muted-foreground"><Globe2 className="size-3" /></span><span className="max-w-48 truncate">{worlds[field.key]?.name}</span><button aria-label={t("scenario.form.removeWorld")} className="text-muted-foreground hover:text-foreground" onClick={() => setWorlds((prev) => ({ ...prev, [field.key]: null }))} type="button"><X className="size-3" /></button></span>
                      : <button className="inline-flex items-center gap-1 rounded-sm border border-dashed px-2 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground" onClick={() => setPickerWorld(field)} type="button"><Globe2 className="size-3.5" />{t("scenario.form.pickWorld")}</button>}
                  </div>
                  : <div className="mt-1 rounded-md border bg-background px-2 py-1.5 focus-within:border-primary">
                    <RichComposer apiBase={apiBase} aria-label={label} maxRows={field.type === "textarea" ? 8 : 3} mode="referencing" onChange={(value) => setValues((prev) => ({ ...prev, [field.key]: value }))} placeholder={field.placeholder ? localizedLabel(field.placeholder, locale) : undefined} value={values[field.key] ?? emptyValue} variant="field" />
                  </div>}
          </div>;
        })}
      </div>
      <p className="mt-3 text-[10px] text-muted-foreground">{t("scenario.form.referenceHint")}</p>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
    <footer className="flex items-center justify-end gap-2 border-t px-5 py-3">
      <Button onClick={onClose} type="button" variant="ghost">{t("scenario.form.cancel")}</Button>
      <Button onClick={submit} type="button">{t("scenario.form.submit")}</Button>
    </footer>
    {pickerField && <MediaAssetEventsProvider apiBase={apiBase}><AssetReferenceDialog allowUpload apiBase={apiBase} completedOnly description={t("scenario.form.pickAssets")} kinds={pickerField.kinds ?? ["image", "video"]} multiple onClose={() => setPickerField(null)} onPick={(asset) => addAssets(pickerField.key, [{ assetId: asset.id, kind: asset.kind as ScenarioAssetKind, mimeType: asset.mimeType, name: asset.name }])} onPickMany={(picked) => { setAssets((prev) => ({ ...prev, [pickerField.key]: picked.map((asset) => ({ assetId: asset.id, kind: asset.kind as ScenarioAssetKind, mimeType: asset.mimeType, name: asset.name })) })); setPickerField(null); }} open preselectedIDs={(assets[pickerField.key] ?? []).map((asset) => asset.assetId)} projectID={null} selectedIDs={[]} title={t("scenario.form.pickAssets")} /></MediaAssetEventsProvider>}
    {pickerWorld && <WorldPicker apiBase={apiBase} onClose={() => setPickerWorld(null)} onPick={(pick) => setWorlds((prev) => ({ ...prev, [pickerWorld.key]: pick }))} open />}
  </>;
}
