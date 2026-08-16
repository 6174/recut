/*
 * [INPUT]: 依赖 World Entity、平台素材选择器、媒体 API 与多模态 Evidence 契约
 * [OUTPUT]: 对外提供设定卡片、空态与对象内嵌的图片/视频/声音/文字证据面板
 * [POS]: worlds/[worldID] 的展示区；将 Canon 投影为用户可读、可感知的创作状态，不显示 JSON、revision 或 hash
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Clapperboard, ImagePlus, Pencil, Plus, Trash2, Volume2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlatformMediaPicker } from "@/components/platform-media-picker";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/select-field";
import { useI18n, useLocaleStore, t as plainT } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import {
  createRecutWorldsClient,
  type EntityKind,
  type WorldEvidence,
  type WorldEvidencePurpose,
  type WorldEntity,
} from "@/lib/recut-worlds-client";
import { contentEntries, fieldLabel, settingSection } from "./world-detail-settings";

type WorldAsset = {
  id: string;
  name: string;
  kind: string;
  mimeType: string;
  status: string;
};

const evidencePurposeValues: WorldEvidencePurpose[] = [
  "identity",
  "appearance",
  "wardrobe",
  "voice",
  "motion",
  "scene",
  "mood",
  "visual_style",
  "sound_style",
  "narrative",
  "rule_evidence",
];

export function SettingCard({
  entity,
  onCreateVideo,
  onEdit,
}: {
  entity: WorldEntity;
  onCreateVideo?: () => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const entries = contentEntries(entity);
  const evidence = entity.references ?? [];

  return (
    <Card className="flex min-h-56 flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold">{entity.title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {entity.summary || t("worlds.entity.summary.empty")}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${entries.length ? "bg-primary/10 text-primary" : "bg-warning/15 text-warning"}`}
        >
          {entries.length ? t("worlds.entity.completed") : t("worlds.entity.incomplete")}
        </span>
      </div>
      {entries.length ? (
        <dl className="mt-4 space-y-2">
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt className="text-[11px] font-medium text-muted-foreground">
                {fieldLabel(key, t)}
              </dt>
              <dd className="mt-0.5 line-clamp-2 text-xs leading-5">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          {t("worlds.entity.completion.hint")}
        </p>
      )}
      <div className="mt-4 border-t pt-3">
        <p className="text-xs font-medium">{t("worlds.entity.media.title")}</p>
        {evidence.length ? (
          <div className="mt-2 flex items-center gap-1.5">
            {evidence.slice(0, 4).map((item) => (
              <EvidenceToken evidence={item} key={item.id ?? item.assetId} />
            ))}
            {evidence.length > 4 && (
              <span className="text-[10px] text-muted-foreground">+{evidence.length - 4}</span>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">{t("worlds.entity.media.hint")}</p>
        )}
      </div>
      <div className="mt-auto flex items-center gap-2 pt-4">
        {onCreateVideo && (
          <Button className="h-8" onClick={onCreateVideo} type="button">
            <Clapperboard className="size-3" />{t("worlds.entity.video")}
          </Button>
        )}
        <Button className="h-8" onClick={onEdit} type="button" variant="outline">
          <Pencil className="size-3" />{t("worlds.entity.edit")}
        </Button>
      </div>
    </Card>
  );
}

function EvidenceToken({ evidence }: { evidence: WorldEvidence }) {
  const { t } = useI18n();
  const label = evidence.modality === "audio" ? t("worlds.entity.modality.audio") : evidence.modality === "video" ? t("worlds.entity.modality.video") : evidence.modality === "image" ? t("worlds.entity.modality.image") : t("worlds.entity.modality.reference");
  return <span className="rounded-sm bg-muted px-1.5 py-1 text-[10px] text-muted-foreground">{label}</span>;
}

export function EmptySetting({ kind, onCreate }: { kind: EntityKind; onCreate: () => void }) {
  const { t } = useI18n();
  const section = settingSection(kind, t);
  return (
    <Card className="w-full p-6">
      <div className="flex min-h-28 flex-col items-center justify-center text-center">
        <p className="text-sm font-medium">{interpolate(t("worlds.entity.empty.title"), { title: section?.title ?? "" })}</p>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{section?.description}</p>
        <Button className="mt-4" onClick={onCreate} type="button">
          <Plus className="size-3.5" />{section?.action}
        </Button>
      </div>
    </Card>
  );
}

// Media belongs to its setting. It is never edited as a parallel World-level form.
export function ObjectEvidencePanel(props: {
  apiBase: string;
  entity: WorldEntity;
  expectedRevisionID: string;
  onChanged: () => void;
  worldID: string;
}) {
  const { t } = useI18n();
  const [managerOpen, setManagerOpen] = useState(false);
  const count = props.entity.references?.length ?? 0;

  return (
    <section className="border-t pt-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">{t("worlds.entity.media.title")}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {count ? interpolate(t("worlds.entity.media.summary"), { count, title: props.entity.title }) : interpolate(t("worlds.entity.media.empty"), { title: props.entity.title })}
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setManagerOpen(true)} type="button" variant="outline">
          {t("worlds.entity.media.manage")}
        </Button>
      </div>
      {managerOpen && <ObjectEvidenceManager {...props} onClose={() => setManagerOpen(false)} />}
    </section>
  );
}

function ObjectEvidenceManager({
  apiBase,
  entity,
  expectedRevisionID,
  onChanged,
  worldID,
  onClose,
}: {
  apiBase: string;
  entity: WorldEntity;
  expectedRevisionID: string;
  onChanged: () => void;
  worldID: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<WorldAsset[]>([]);
  const [evidence, setEvidence] = useState<WorldEvidence[]>(entity.references ?? []);
  const [editingEvidence, setEditingEvidence] = useState<WorldEvidence | null>(null);
  const [assetID, setAssetID] = useState("");
  const [pickedAsset, setPickedAsset] = useState<{ id: string; kind: string; name: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [purpose, setPurpose] = useState<WorldEvidencePurpose>(purposeFor(entity.kind));
  const [status, setStatus] = useState<"primary" | "supporting" | "counterexample">("supporting");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch(`${apiBase}/v1/media/assets`, { cache: "no-store" })
      .then(async (response) => {
        if (response.ok) setAssets((await response.json()) as WorldAsset[]);
      })
      .catch(() => setError(plainT("workspace", useLocaleStore.getState().locale, "worlds.entity.manager.assets.load.failed")));
  }, [apiBase]);

  async function attach() {
    if (!assetID) return;
    setError("");
    try {
      if (editingEvidence?.id) {
        const next = await createRecutWorldsClient(apiBase).evidence.update({
          worldId: worldID,
          evidenceId: editingEvidence.id,
          purpose,
          status,
          label,
          expectedRevisionId: expectedRevisionID,
        });
        setEvidence((current) => current.map((item) => item.id === next.id ? next : item));
        setEditingEvidence(null);
        setAssetID("");
        setPickedAsset(null);
        onChanged();
        return;
      }
      const next = await createRecutWorldsClient(apiBase).evidence.attach({
        worldId: worldID,
        entityId: entity.id,
        assetId: assetID,
        purpose,
        status,
        label,
        expectedRevisionId: expectedRevisionID,
      });
      setEvidence((current) => [...current, next]);
      setAssetID("");
      setPickedAsset(null);
      setLabel("");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("worlds.entity.manager.attach.failed"));
    }
  }

  async function archive(item: WorldEvidence) {
    if (!item.id || !window.confirm(t("worlds.entity.manager.remove.confirm"))) return;
    setError("");
    try {
      await createRecutWorldsClient(apiBase).evidence.archive({
        worldId: worldID,
        evidenceId: item.id,
        expectedRevisionId: expectedRevisionID,
      });
      setEvidence((current) => current.filter((candidate) => candidate.id !== item.id));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("worlds.entity.manager.remove.failed"));
    }
  }

  return (
    <div aria-modal="true" className="fixed inset-0 z-[60] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={onClose} role="dialog" aria-labelledby="evidence-manager-title">
      <section className="flex max-h-[min(760px,calc(100vh-3rem))] w-full max-w-3xl flex-col overflow-hidden rounded-md border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <p className="text-xs font-medium text-primary">{entity.title}</p>
            <h2 className="mt-1 text-lg font-semibold" id="evidence-manager-title">{t("worlds.entity.manager.title")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("worlds.entity.manager.desc")}</p>
          </div>
          <button aria-label={t("worlds.entity.manager.close.aria")} className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onClose} type="button">
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
      {evidence.length ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {evidence.map((item) => (
            <div className="overflow-hidden rounded-sm border" key={item.id ?? item.assetId}>
              <EvidencePreview asset={assets.find((asset) => asset.id === item.assetId)} source={`${apiBase}/v1/media/assets/${encodeURIComponent(item.assetId)}/content`} />
              <div className="flex items-center justify-between gap-2 p-2">
                <span className="truncate text-[11px] text-muted-foreground">{item.label || t(`worlds.evidence.${item.purpose}`)}</span>
                <span className="flex items-center gap-1">
                  <button aria-label={t("worlds.entity.manager.edit.aria")} className="text-muted-foreground hover:text-foreground" onClick={() => {
                    setEditingEvidence(item);
                    setAssetID(item.assetId);
                    setPickedAsset({ id: item.assetId, kind: item.modality, name: assets.find((asset) => asset.id === item.assetId)?.name ?? t("worlds.entity.manager.currentAsset") });
                    setPurpose(item.purpose);
                    setStatus(item.status === "archived" ? "supporting" : item.status);
                    setLabel(item.label ?? "");
                  }} type="button">
                    <Pencil className="size-3.5" />
                  </button>
                  <button aria-label={t("worlds.entity.manager.remove.aria")} className="text-muted-foreground hover:text-destructive" onClick={() => void archive(item)} type="button">
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-sm border border-dashed p-3 text-xs text-muted-foreground">{t("worlds.entity.manager.empty")}</p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium">{t("worlds.entity.manager.choose.title")}</p>
          <Button className="mt-1 w-full justify-start" disabled={Boolean(editingEvidence)} onClick={() => setPickerOpen(true)} type="button" variant="outline">
            {pickedAsset ? `${pickedAsset.name} · ${assetKindLabel(pickedAsset.kind, t)}` : t("worlds.entity.manager.choose.placeholder")}
          </Button>
        </div>
        <SelectField id="setting-evidence-purpose" label={t("worlds.entity.manager.purpose")} onChange={(value) => setPurpose(value as WorldEvidencePurpose)} options={evidencePurposeValues.map((value) => ({ label: t(`worlds.evidence.${value}`), value }))} value={purpose} />
        <SelectField id="setting-evidence-status" label={t("worlds.entity.manager.status")} onChange={(value) => setStatus(value as typeof status)} options={[{ value: "primary", label: t("worlds.entity.status.primary") }, { value: "supporting", label: t("worlds.entity.status.supporting") }, { value: "counterexample", label: t("worlds.entity.status.counterexample") }]} value={status} />
        <label className="text-xs font-medium" htmlFor="setting-evidence-note">
          {t("worlds.entity.manager.note.label")}
          <Input className="mt-1 h-9 bg-background" id="setting-evidence-note" onChange={(event) => setLabel(event.target.value)} placeholder={t("worlds.entity.manager.note.placeholder")} value={label} />
        </label>
      </div>
      <Button className="mt-3" disabled={!assetID} onClick={() => void attach()} type="button" variant="outline">
        <ImagePlus className="size-3.5" />{editingEvidence ? t("worlds.entity.manager.save") : t("worlds.entity.manager.add")}
      </Button>
      {error && <p className="mt-2 text-xs text-warning">{error}</p>}
      <PlatformMediaPicker
        apiBase={apiBase}
        onCancel={() => setPickerOpen(false)}
        onPick={(selection) => {
          const asset = Array.isArray(selection) ? selection[0] : selection;
          if (!asset) return;
          setAssetID(asset.id);
          setPickedAsset(asset);
          setPickerOpen(false);
        }}
        request={pickerOpen ? { kinds: ["image", "video", "audio"] } : null}
      />
        </div>
      </section>
    </div>
  );
}

function assetKindLabel(kind: string, t: (key: string) => string) {
  if (kind === "image") return t("worlds.entity.modality.image");
  if (kind === "video") return t("worlds.entity.modality.video");
  return t("worlds.entity.modality.audio");
}

function EvidencePreview({ asset, source }: { asset?: WorldAsset; source: string }) {
  const { t } = useI18n();
  if (asset?.kind === "image") return <img alt={asset.name} className="h-36 w-full object-cover" src={source} />;
  if (asset?.kind === "video") return <video className="h-36 w-full bg-black object-cover" controls muted preload="metadata" src={source} />;
  if (asset?.kind === "audio") return <div className="flex h-36 flex-col justify-between bg-muted p-3"><Volume2 className="size-5 text-primary" /><audio className="w-full" controls preload="metadata" src={source} /></div>;
  return <div className="flex h-36 items-end bg-muted p-3 text-xs text-muted-foreground">{t("worlds.entity.preview.fallback")}</div>;
}

function purposeFor(kind: EntityKind): WorldEvidencePurpose {
  if (kind === "character") return "appearance";
  if (kind === "location") return "scene";
  if (kind === "story") return "narrative";
  if (kind === "style") return "visual_style";
  return "rule_evidence";
}

function SelectField({ id, label, onChange, options, value }: { id: string; label: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }>; value: string }) {
  return <CustomSelect id={id} label={label} onChange={onChange} options={options} value={value} />;
}
