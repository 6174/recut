/**
 * [INPUT]: 依赖 recut-sdk（background.call + events.subscribe 实时事件）、Left 两 Tab 组件、Right 预览组件与 i18n
 * [OUTPUT]: 生成工坊主工作区：模型目录/任务列表按事件增量刷新（首屏与用户动作走 REST）、选中任务详情与产物、预览图「以此为参考图编辑」回填左侧表单、动作编排与语言同步
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
import { EngineControl } from "./components/EngineControl";
import { Button, Card } from "./ui";
import type { Catalog, EngineStatus, EnvStatus, Generation, GenerationParams, InjectedReference, LogLine, Task, TaskDetail } from "./types";
import "./style.css";

const EMPTY_CATALOG: Catalog = { ready: false, runtimes: [], models: [], downloadSource: "automatic" };
const APP_ID = "recut.gen-studio";

export default function App() {
  const locale = useRecutLocale();
  const [connected, setConnected] = useState(() => isRecutConnected());
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [tab, setTab] = useState<"generate" | "records">("generate");
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineStopping, setEngineStopping] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [params, setParams] = useState<GenerationParams | null>(null);
  const [injectedReference, setInjectedReference] = useState<InjectedReference | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  const catalogLoadedRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const logTimer = useRef<number | null>(null);

  const hasActiveTask = tasks.some((task) => task.state === "queued" || task.state === "running");
  const engineStarting = tasks.some((task) => task.action === "engine" && (task.state === "queued" || task.state === "running"));

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

  const refreshEngine = useCallback(async () => {
    try {
      setEngine(await op<EngineStatus>("gen.engine.status"));
    } catch {
      /* keep last snapshot */
    }
  }, [op]);

  const refreshTasks = useCallback(async () => {
    try {
      const result = await op<{ tasks: Task[] }>("gen.tasks.list", { limit: 50 });
      setTasks(result.tasks ?? []);
    } catch {
      setTasks([]);
    }
  }, [op]);

  const renderRight = useCallback(
    async (id: string) => {
      const current = await op<TaskDetail>("gen.task.get", { id });
      setDetail(current);
      if (current.action === "generate") {
        try {
          const result = await op<{ params: GenerationParams | null }>("gen.task.params", { id });
          setParams(result.params ?? null);
        } catch {
          setParams(null);
        }
      } else {
        setParams(null);
      }
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
    catalogLoadedRef.current = catalogLoaded;
  }, [catalogLoaded]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // 本地秒针：仅在存在在途任务时驱动计时显示，不发任何请求。
  useEffect(() => {
    if (!hasActiveTask) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveTask]);

  // 首屏数据走 REST；catalog 未就绪前有限重试，就绪后停止。
  useEffect(() => {
    if (!connected || catalogLoaded) return;
    let cancelled = false;
    const load = async () => {
      await refreshCatalog();
      await refreshTasks();
      await refreshEnv();
      await refreshEngine();
      if (!cancelled && !catalogLoadedRef.current) window.setTimeout(load, 2000);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [connected, catalogLoaded, refreshCatalog, refreshTasks, refreshEnv, refreshEngine]);

  // 事件驱动的增量刷新：后台 shell job 生命周期（started/completed）触发一次合并刷新。
  const refreshFromEvent = useCallback(async () => {
    if (!catalogLoadedRef.current) await refreshCatalog();
    await refreshTasks();
    await refreshEnv();
    await refreshEngine();
    const id = selectedIdRef.current;
    if (id) {
      try {
        await renderRight(id);
      } catch {
        /* ignore transient */
      }
    }
  }, [refreshCatalog, refreshTasks, refreshEnv, refreshEngine, renderRight]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refreshFromEvent();
    }, 250);
  }, [refreshFromEvent]);

  // 运行中日志：由 shell.job.log 事件驱动，节流到最多 1s 一次。
  const scheduleLogRefresh = useCallback(() => {
    if (logTimer.current !== null) return;
    logTimer.current = window.setTimeout(() => {
      logTimer.current = null;
      const id = selectedIdRef.current;
      if (id) {
        try {
          void renderRight(id);
        } catch {
          /* ignore transient */
        }
      }
    }, 1000);
  }, [renderRight]);

  useEffect(() => {
    if (!connected) return;
    return recut.events.subscribe((event) => {
      const message = event as { type?: unknown; appId?: unknown } | null;
      if (!message || message.appId !== APP_ID) return;
      const type = typeof message.type === "string" ? message.type : "";
      if (type === "shell.job.started" || type === "shell.job.completed") {
        scheduleRefresh();
      } else if (type === "shell.job.log") {
        scheduleLogRefresh();
      }
    });
  }, [connected, scheduleRefresh, scheduleLogRefresh]);

  // 引擎就绪无法由 shell job 事件表达（端口探活），仅在启动中且未就绪时轮询。
  useEffect(() => {
    if (!connected || !engineStarting || engine?.running === true) return;
    let cancelled = false;
    const tick = async () => {
      await refreshEngine();
      if (!cancelled) window.setTimeout(tick, 5000);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [connected, engineStarting, engine?.running, refreshEngine]);

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

  const handleEngineStart = useCallback(async () => {
    await op("gen.engine.start");
    await refreshTasks();
  }, [op, refreshTasks]);

  const handleEngineStop = useCallback(async () => {
    setEngineStopping(true);
    try {
      await op("gen.engine.stop");
      await refreshEngine();
    } finally {
      setEngineStopping(false);
    }
  }, [op, refreshEngine]);

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

  const handleEdit = useCallback(
    async (generationId: string) => {
      setTab("generate");
      try {
        const result = await op<{ assetId: string }>("gen.save", { id: generationId, kind: "image" });
        setInjectedReference({ id: result.assetId, name: `gen-${generationId}`, nonce: Date.now() });
        if (selectedId) await renderRight(selectedId);
      } catch (error) {
        setInjectedReference({ id: "", nonce: Date.now(), error: error instanceof Error ? error.message : String(error) });
      }
    },
    [op, selectedId, renderRight],
  );

  const handleRemix = useCallback(
    (draft: GenerationParams) => {
      setTab("generate");
      setInjectedReference({ id: draft.id, name: `gen-${draft.id}`, nonce: Date.now(), draft });
    },
    [],
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
    const elapsedSeconds = prepareTask ? (clock - Date.parse(prepareTask.createdAt)) / 1000 : 0;
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
        <header className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-border/80 pb-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-primary">{t(locale, "app.kicker")}</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">{t(locale, "app.name")}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t(locale, "app.subtitle")}</p>
          </div>
          <EngineControl
            locale={locale}
            status={engine}
            starting={engineStarting}
            busy={engineStarting || engineStopping}
            onStart={() => void handleEngineStart()}
            onStop={() => void handleEngineStop()}
          />
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
                  injectedReference={injectedReference}
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
              <PreviewPane task={detail} generation={generation} params={params} logs={logs} locale={locale} onCancel={handleCancel} onSave={handleSave} onEdit={handleEdit} onRemix={handleRemix} />
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
