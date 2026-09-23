/**
 * [INPUT]: 依赖 recut-sdk（background.call）、Left 两 Tab 组件、Right 预览组件与 i18n
 * [OUTPUT]: 生成工坊主工作区：模型目录/任务列表轮询、选中任务详情与产物、动作编排与语言同步
 * [POS]: ui 的状态编排层；只经 App operation 契约访问后台，不直接读写本机文件
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { isRecutConnected, recut, useRecutLocale } from "./recut-sdk";
import { t } from "./i18n";
import { GenerateTab } from "./components/GenerateTab";
import { RecordsTab } from "./components/RecordsTab";
import { PreviewPane } from "./components/PreviewPane";
import { Setup } from "./components/Setup";
import { Button, Card } from "./ui";
import type { Catalog, EnvStatus, Generation, LogLine, Task, TaskDetail } from "./types";
import "./style.css";

const EMPTY_CATALOG: Catalog = { ready: false, runtimes: [], models: [], downloadSource: "automatic" };

export default function App() {
  const locale = useRecutLocale();
  const [connected, setConnected] = useState(() => isRecutConnected());
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [tab, setTab] = useState<"generate" | "records">("generate");
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const busyRef = useRef(false);

  const op = useCallback(
    <T,>(name: string, input: Record<string, unknown> = {}) => recut.background.call(name, input) as Promise<T>,
    [],
  );

  const refreshCatalog = useCallback(async () => {
    try {
      setCatalog(await op<Catalog>("gen.catalog"));
      setCatalogLoaded(true);
    } catch {
      /* keep last snapshot */
    }
  }, [op]);

  const refreshEnv = useCallback(async () => {
    try {
      setEnv(await op<EnvStatus>("gen.status"));
    } catch {
      /* keep last snapshot */
    }
  }, [op]);

  const refreshTasks = useCallback(async () => {
    try {
      const result = await op<{ tasks: Task[] }>("gen.tasks.list", { limit: 50 });
      setTasks(result.tasks ?? []);
      busyRef.current = (result.tasks ?? []).some((task) => task.state === "queued" || task.state === "running");
    } catch {
      setTasks([]);
    }
  }, [op]);

  const renderRight = useCallback(
    async (id: string) => {
      const current = await op<TaskDetail>("gen.task.get", { id });
      setDetail(current);
      if (current.action === "generate" && current.state === "completed" && current.recordId) {
        setGeneration(await op<Generation>("gen.generation.complete", { id: current.recordId }));
        setLogs([]);
      } else {
        setGeneration(null);
        const result = await op<{ logs: LogLine[] }>("gen.task.logs", { id, limit: 300 });
        setLogs(result.logs ?? []);
      }
    },
    [op],
  );

  const selectTask = useCallback(
    (id: string) => {
      setSelectedId(id);
      void renderRight(id);
    },
    [renderRight],
  );

  useEffect(() => {
    if (connected) return;
    const onReady = () => setConnected(true);
    window.addEventListener("recut-sdk-ready", onReady);
    return () => window.removeEventListener("recut-sdk-ready", onReady);
  }, [connected]);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const tick = async () => {
      const wasBusy = busyRef.current;
      if (!catalogLoaded) await refreshCatalog();
      if (env?.ready !== true) await refreshEnv();
      await refreshTasks();
      if (wasBusy && !busyRef.current) {
        await refreshCatalog();
        await refreshEnv();
      }
      if (selectedId) {
        try {
          await renderRight(selectedId);
        } catch {
          /* ignore transient */
        }
      }
      if (!cancelled) window.setTimeout(tick, busyRef.current ? 1000 : 3000);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [connected, catalogLoaded, env?.ready, selectedId, refreshCatalog, refreshEnv, refreshTasks, renderRight]);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const handleGenerate = useCallback(
    async (input: Record<string, unknown>) => {
      const result = await op<{ taskId: string }>("gen.generate", input);
      if (result.taskId) selectTask(result.taskId);
      await refreshTasks();
    },
    [op, selectTask, refreshTasks],
  );

  const handleSaveDefault = useCallback(async (model: string) => {
    try {
      await fetch(`${location.origin}/v1/media/routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "image.generate.default", capability: "image.generate", modelId: `local-gen/${model}`, credentialId: "", enabled: true }),
      });
      return t(locale, "generate.default-set").replace("{model}", `local-gen/${model}`);
    } catch (error) {
      return t(locale, "generate.default-failed").replace("{error}", error instanceof Error ? error.message : String(error));
    }
  }, [locale]);

  const handlePrepare = useCallback(
    async (target: string) => {
      const result = await op<{ taskId: string }>("gen.prepare", { target });
      if (result.taskId) selectTask(result.taskId);
      await refreshTasks();
      await refreshEnv();
    },
    [op, selectTask, refreshTasks, refreshEnv],
  );

  const handleInstall = useCallback(
    async (model: string, source: string) => {
      const result = await op<{ taskId: string }>("gen.install", { model, source });
      if (result.taskId) selectTask(result.taskId);
      await refreshTasks();
    },
    [op, selectTask, refreshTasks],
  );

  const handleSetSource = useCallback(
    async (source: string) => {
      await op("gen.settings.set", { downloadSource: source });
      await refreshCatalog();
    },
    [op, refreshCatalog],
  );

  const handleCancel = useCallback(async () => {
    if (!selectedId) return;
    await op("gen.task.cancel", { id: selectedId });
    await refreshTasks();
    await renderRight(selectedId);
  }, [op, selectedId, refreshTasks, renderRight]);

  const handleSave = useCallback(
    async (generationId: string) => {
      await op("gen.save", { id: generationId, kind: "image" });
      if (selectedId) await renderRight(selectedId);
    },
    [op, selectedId, renderRight],
  );

  if (!catalogLoaded) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin text-primary" />
          <p className="text-xs">{t(locale, "app.loading")}</p>
        </div>
      </main>
    );
  }

  const envReady = env?.ready ?? catalog.ready;
  if (!envReady) {
    const prepareTask = tasks.find((task) => task.action === "prepare" && (task.state === "queued" || task.state === "running"));
    const elapsedSeconds = prepareTask ? (Date.now() - Date.parse(prepareTask.createdAt)) / 1000 : 0;
    return (
      <Setup
        locale={locale}
        autoPrepare
        busy={Boolean(prepareTask)}
        elapsedSeconds={elapsedSeconds}
        failure={env?.setupError || (Boolean(prepareTask) || env?.pending ? "" : env?.error || "")}
        failureLogs={env?.setupLogs ?? []}
        logs={logs}
        message={t(locale, "setup.hint")}
        onPrepare={() => void handlePrepare("all")}
      />
    );
  }

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-5 border-b border-border/80 pb-4">
          <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-primary">{t(locale, "app.kicker")}</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">{t(locale, "app.name")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t(locale, "app.subtitle")}</p>
        </header>

        <div className="grid gap-5 xl:grid-cols-[26rem_minmax(0,1fr)]">
          <Card className="flex min-h-[36rem] flex-col overflow-hidden">
            <div className="grid grid-cols-2 border-b border-border/80">
              {(["generate", "records"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTab(item)}
                  className={`h-11 text-xs font-medium transition ${tab === item ? "text-foreground shadow-[inset_0_-2px_0_var(--primary)]" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t(locale, `tab.${item}`)}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {tab === "generate" ? (
                <GenerateTab
                  models={catalog.models}
                  runtimes={catalog.runtimes}
                  locale={locale}
                  downloadSource={catalog.downloadSource}
                  onGenerate={handleGenerate}
                  onSaveDefault={handleSaveDefault}
                  onPrepare={handlePrepare}
                  onInstall={handleInstall}
                  onSetSource={handleSetSource}
                />
              ) : (
                <RecordsTab tasks={tasks} locale={locale} selectedId={selectedId} onSelect={selectTask} />
              )}
            </div>
          </Card>

          <Card className="flex min-h-[36rem] flex-col overflow-hidden">
            <div className="flex h-11 items-center gap-2 border-b border-border/80 px-4">
              <span className="text-xs font-semibold text-foreground">{t(locale, "preview.title")}</span>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => { void refreshCatalog(); void refreshTasks(); }}>
                <RefreshCw className="size-3.5" />{t(locale, "app.resync")}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <PreviewPane task={detail} generation={generation} logs={logs} locale={locale} onCancel={handleCancel} onSave={handleSave} />
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
