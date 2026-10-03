/*
 * [INPUT]: 依赖 recut-worlds-client 的创建/导入方法与类型目录、worlds-store 的失效方法、工作台 i18n 字典与 UI 原子
 * [OUTPUT]: 对外提供新建 World 对话框：从零创建（名称/类型/起点场景/定位）或导入 zip 源，成功后失效缓存并进入世界详情
 * [POS]: web/components 的 Worlds 创建入口；由工作台壳（Studio 新建与项目选择器）复用，不承担列表展示
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Upload, X } from "lucide-react";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/select-field";
import {
  createRecutWorldsClient,
  worldScenarioDefaults,
  worldScenarios,
  worldTypes,
  type WorldKind,
  type WorldScenario,
} from "@/lib/recut-worlds-client";
import { useI18n } from "@/lib/i18n/index";
import { useWorldsStore } from "@/lib/worlds-store";

export function CreateWorldDialog({
  apiBase,
  onClose,
  onCreated,
}: {
  apiBase: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const invalidate = useWorldsStore((state) => state.invalidate);
  const [mode, setMode] = useState<"scratch" | "import">("scratch");
  const [name, setName] = useState("");
  const [type, setType] = useState<WorldKind>("character_ip");
  const [scenario, setScenario] = useState<WorldScenario>(
    worldScenarioDefaults["character_ip"],
  );
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  function selectType(next: WorldKind) {
    setType(next);
    setScenario(worldScenarioDefaults[next]);
  }
  function selectMode(next: "scratch" | "import") {
    setMode(next);
    setError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      const world = await createRecutWorldsClient(apiBase).create({
        name: name.trim(),
        type,
        description: description.trim(),
      });
      invalidate();
      onCreated();
      onClose();
      window.location.assign(
        `/worlds/${encodeURIComponent(world.id)}?scenario=${encodeURIComponent(scenario)}`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("worlds.list.create.failed"),
      );
      setCreating(false);
    }
  }
  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || importing) return;
    setImporting(true);
    setError("");
    try {
      const world = await createRecutWorldsClient(apiBase).importWorld({ file });
      invalidate();
      onCreated();
      onClose();
      window.location.assign(`/worlds/${encodeURIComponent(world.id)}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("worlds.create.import.failed"),
      );
      setImporting(false);
    }
  }
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="dialog"
      aria-labelledby="create-world-title"
    >
      <section
        className="w-full max-w-md rounded-sm border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-muted-foreground">
              NEW WORLD
            </p>
            <h2
              className="mt-1 text-base font-semibold"
              id="create-world-title"
            >
              {t("worlds.create.title")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {mode === "import"
                ? t("worlds.create.import.desc")
                : t("worlds.create.desc")}
            </p>
          </div>
          <button
            aria-label={t("worlds.create.close.aria")}
            className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        <form onSubmit={mode === "import" ? submitImport : submit}>
          <div className="grid gap-4 p-5">
            <div className="grid grid-cols-2 gap-1 rounded-sm border bg-muted/40 p-1">
              {(["scratch", "import"] as const).map((item) => (
                <button
                  className={
                    mode === item
                      ? "rounded-xs bg-card px-3 py-1.5 text-xs font-medium shadow-sm"
                      : "rounded-xs px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  }
                  key={item}
                  onClick={() => selectMode(item)}
                  type="button"
                >
                  {t(`worlds.create.mode.${item}`)}
                </button>
              ))}
            </div>
            {mode === "import" ? (
              <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-sm border border-dashed bg-background px-4 py-6 text-center hover:border-foreground/25 hover:bg-muted/40">
                <Upload className="size-5 text-muted-foreground" />
                <span className="max-w-full truncate text-xs font-medium">
                  {file ? file.name : t("worlds.create.import.pick")}
                </span>
                <span className="text-[11px] leading-4 text-muted-foreground">
                  {t("worlds.create.import.hint")}
                </span>
                <input
                  accept=".zip,application/zip"
                  className="sr-only"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setError("");
                    // 允许再次选择同一个文件（重试导入）时仍触发 change
                    event.target.value = "";
                  }}
                  type="file"
                />
              </label>
            ) : (
              <>
                <div>
                  <label
                    className="mb-1 block text-[11px] font-medium"
                    htmlFor="create-world-name"
                  >
                    {t("worlds.create.name")}
                  </label>
                  <Input
                    autoFocus
                    className="h-9 bg-background text-xs"
                    id="create-world-name"
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t("worlds.create.name.placeholder")}
                    value={name}
                  />
                </div>
                <CustomSelect
                  id="create-world-type"
                  label={t("worlds.create.type")}
                  onChange={(value) => selectType(value as WorldKind)}
                  options={worldTypes().map((kind) => ({
                    label: t(`worlds.kind.${kind}`),
                    value: kind,
                  }))}
                  value={type}
                />
                <CustomSelect
                  id="create-world-scenario"
                  label={t("worlds.create.scenario")}
                  onChange={(value) => setScenario(value as WorldScenario)}
                  options={worldScenarios().map((id) => ({
                    label: t(`worlds.scenario.${id}.label`),
                    value: id,
                  }))}
                  value={scenario}
                />
                <p className="-mt-2 text-[11px] leading-4 text-muted-foreground">
                  {t(`worlds.scenario.${scenario}.desc`)}
                </p>
                <div>
                  <label
                    className="mb-1 block text-[11px] font-medium"
                    htmlFor="create-world-description"
                  >
                    {t("worlds.create.role")}
                  </label>
                  <textarea
                    className="min-h-20 w-full rounded-sm border bg-background px-2.5 py-2 text-xs focus-visible:ring-2 focus-visible:ring-ring/30"
                    id="create-world-description"
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={t("worlds.create.role.placeholder")}
                    value={description}
                  />
                </div>
              </>
            )}
            {error && <p className="text-xs text-warning">{error}</p>}
          </div>
          <footer className="flex items-center justify-end gap-2 border-t px-5 py-3">
            <Button onClick={onClose} type="button" variant="ghost">
              {t("worlds.create.cancel")}
            </Button>
            <Button
              disabled={
                mode === "import"
                  ? !file || importing
                  : !name.trim() || creating
              }
              type="submit"
            >
              {mode === "import"
                ? importing
                  ? t("worlds.create.import.submitting")
                  : t("worlds.create.import.submit")
                : creating
                  ? t("worlds.create.submitting")
                  : t("worlds.create.submit")}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
