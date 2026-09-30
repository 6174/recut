/**
 * [INPUT]: 依赖 recut-sdk（background.call + events.subscribe 实时事件）、Left 两 Tab 组件、Right 预览组件与 i18n
 * [OUTPUT]: ComfyUI 工作台主工作区：外壳立即渲染，目录/就绪度以可感知的非阻塞探测补齐（BootNotice 显示在等什么、等多久、第几次与失败原因）；工作流目录/任务列表按事件增量刷新（首屏与用户动作走 REST）、选中任务详情与产物、预览图「以此为参考图编辑」回填左侧表单、**成功任务同样回读完整日志**（产物与参数/日志并存）、引擎管理面板（EngineDialog）、动作编排与语言同步；宿主深链 ?taskId= 时首屏切到记录页并选中该任务（素材库「生成任务」新标签页跳入）；仅当探测确认环境未就绪才进入带日志的 Setup 门；外壳由 shadcn Tabs/Card 承载
 * [POS]: ui 的状态编排层；只经 App operation 契约访问后台，不直接读写本机文件
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Workflow } from "lucide-react";
import { getRecutTaskId, isRecutConnected, recut, useRecutLocale } from "./recut-sdk";
import { t } from "./i18n";
import { BootNotice } from "./components/BootNotice";
import { WorkflowTab } from "./components/WorkflowTab";
import { RecordsTab } from "./components/RecordsTab";
import { PreviewPane } from "./components/PreviewPane";
import { Setup } from "./components/Setup";
import { EngineControl } from "./components/EngineControl";
import { EngineDialog } from "./components/EngineDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Catalog, EngineStatus, EnvStatus, Generation, GenerationParams, InjectedReference, LogLine, Task, TaskDetail } from "./types";
import "./style.css";

const EMPTY_CATALOG: Catalog = { ready: false, runtimes: [], apps: [], downloadSource: "automatic" };
const APP_ID = "recut.comfyui-studio";

export default function App() {
  const locale = useRecutLocale();
  const [connected, setConnected] = useState(() => isRecutConnected());
  const [catalogPhase, setCatalogPhase] = useState<"loading" | "error" | "ready">("loading");
  const [catalogError, setCatalogError] = useState("");
  const [catalogAttempts, setCatalogAttempts] = useState(0);
  const [tab, setTab] = useState<"generate" | "records">("generate");
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineOpen, setEngineOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [params, setParams] = useState<GenerationParams | null>(null);
  const [injectedReference, setInjectedReference] = useState<InjectedReference | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  const catalogLoadedRef = useRef(false);
  const bootStartedAt = useRef(Date.now());
  const selectedIdRef = useRef<string | null>(null);
  const trackedJobIdsRef = useRef<Set<string>>(new Set());
  const refreshTimer = useRef<number | null>(null);
  const logTimer = useRef<number | null>(null);

  const hasActiveTask = tasks.some((task) => task.state === "queued" || task.state === "running");
  const engineStarting = tasks.some((task) => task.action === "engine" && (task.state === "queued" || task.state === "running"));

  const op = useCallback(
    <T,>(name: string, input: Record<string, unknown> = {}) => recut.background.call(name, input) as Promise<T>,
    [],
  );

  // 首屏探测：成功/失败都必须落到可见状态，绝不静默吞掉失败原因。
  // demote=false 用于工作台内的「重新同步」：失败只提示，不把已经可用的工作台降级成错误页。
  const refreshCatalog = useCallback(async (demote = true) => {
    setCatalogAttempts((count) => count + 1);
    try {
      setCatalog(await op<Catalog>("comfy.catalog"));
      setCatalogError("");
      setCatalogPhase("ready");
      return true;
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error));
      if (demote) setCatalogPhase("error");
      return false;
    }
  }, [op]);

  const refreshEnv = useCallback(async () => {
    try {
      setEnv(await op<EnvStatus>("comfy.status"));
    } catch {
      /* keep last snapshot */
    }
  }, [op]);

  const refreshEngine = useCallback(async () => {
    try {
      setEngine(await op<EngineStatus>("comfy.engine.status"));
    } catch {
      /* keep last snapshot */
    }
  }, [op]);

  const refreshTasks = useCallback(async () => {
    try {
      const result = await op<{ tasks: Task[] }>("comfy.tasks.list", { limit: 50 });
      setTasks(result.tasks ?? []);
    } catch {
      setTasks([]);
    }
  }, [op]);

  const renderRight = useCallback(
    async (id: string) => {
      const current = await op<TaskDetail>("comfy.task.get", { id });
      setDetail(current);
      if (current.action === "generate") {
        try {
          const result = await op<{ params: GenerationParams | null }>("comfy.task.params", { id });
          setParams(result.params ?? null);
        } catch {
          setParams(null);
        }
      } else {
        setParams(null);
      }
      if (current.action === "generate" && current.state === "completed" && current.recordId) {
        setGeneration(await op<Generation>("comfy.generation.complete", { id: current.recordId }));
      } else {
        setGeneration(null);
      }
      // 成功与否都回读日志：产物预览与完整参数/日志并存，不因成功就丢掉这次运行的执行记录。
      const result = await op<{ logs: LogLine[] }>("comfy.task.logs", { id, limit: 300 });
      setLogs(result.logs ?? []);
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

  // 深链：宿主在 iframe URL 上带 ?taskId= 时（素材库「生成任务」新标签页跳入），首屏切到记录页并选中该任务。
  // 只在任务账本回来之后判定一次；任务不在账本里（已被清理）则不强选，保留空态。
  const deepLinkAppliedRef = useRef(false);
  useEffect(() => {
    if (deepLinkAppliedRef.current || !connected || !tasks.length) return;
    const taskID = getRecutTaskId();
    deepLinkAppliedRef.current = true;
    if (!taskID || !tasks.some((task) => task.id === taskID)) return;
    setTab("records");
    selectTask(taskID);
  }, [connected, tasks, selectTask]);

  useEffect(() => {
    if (connected) return;
    const onReady = () => setConnected(true);
    window.addEventListener("recut-sdk-ready", onReady);
    return () => window.removeEventListener("recut-sdk-ready", onReady);
  }, [connected]);

  useEffect(() => {
    catalogLoadedRef.current = catalogPhase === "ready";
  }, [catalogPhase]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // 本 App 经 comfy_tasks 提交的 shell job id 集合（事件过滤用）。
  useEffect(() => {
    trackedJobIdsRef.current = new Set(tasks.map((task) => task.jobId).filter((id): id is string => Boolean(id)));
  }, [tasks]);

  // 本地秒针：在途任务或首屏探测期间驱动计时显示，不发任何请求。
  useEffect(() => {
    if (!hasActiveTask && catalogPhase === "ready") return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveTask, catalogPhase]);

  // 首屏目录与就绪度走可感知的非阻塞探测：失败会显示原因，未就绪前每 3s 重试一次并展示次数。
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    let timer = 0;
    const load = async () => {
      if (catalogLoadedRef.current) return;
      const ok = await refreshCatalog();
      await refreshTasks();
      await refreshEnv();
      await refreshEngine();
      if (!cancelled && !ok) timer = window.setTimeout(() => void load(), 3000);
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connected, refreshCatalog, refreshTasks, refreshEnv, refreshEngine]);

  // 事件驱动的增量刷新：后台 shell job 生命周期（started/completed）触发一次合并刷新。
  const refreshFromEvent = useCallback(async (includeStatus: boolean) => {
    if (!catalogLoadedRef.current) await refreshCatalog();
    await refreshTasks();
    if (includeStatus) {
      await refreshEnv();
      await refreshEngine();
    }
    const id = selectedIdRef.current;
    if (id) {
      try {
        await renderRight(id);
      } catch {
        /* ignore transient */
      }
    }
  }, [refreshCatalog, refreshTasks, refreshEnv, refreshEngine, renderRight]);

  const statusRefreshRef = useRef(false);
  const scheduleRefresh = useCallback((includeStatus: boolean) => {
    if (includeStatus) statusRefreshRef.current = true;
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      const include = statusRefreshRef.current;
      statusRefreshRef.current = false;
      void refreshFromEvent(include);
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
      const message = event as { type?: unknown; appId?: unknown; job?: { id?: unknown }; log?: { jobId?: unknown } } | null;
      if (!message || message.appId !== APP_ID) return;
      const jobId = typeof message.job?.id === "string" ? message.job.id : typeof message.log?.jobId === "string" ? message.log.jobId : "";
      const tracked = Boolean(jobId) && trackedJobIdsRef.current.has(jobId);
      const type = typeof message.type === "string" ? message.type : "";
      if (type === "shell.job.started" || type === "shell.job.completed") {
        scheduleRefresh(tracked);
      } else if (type === "shell.job.log") {
        if (tracked) scheduleLogRefresh();
      }
    });
  }, [connected, scheduleRefresh, scheduleLogRefresh]);

  // 引擎就绪无法由 shell job 事件表达（端口探活）：启动中、或引擎面板打开时轮询。
  useEffect(() => {
    if (!connected) return;
    const watchingStart = engineStarting && engine?.running !== true;
    if (!engineOpen && !watchingStart) return;
    let cancelled = false;
    const tick = async () => {
      await refreshEngine();
      if (!cancelled) window.setTimeout(tick, 5000);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [connected, engineOpen, engineStarting, engine?.running, refreshEngine]);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const handleGenerate = useCallback(
    async (input: Record<string, unknown>) => {
      const result = await op<{ taskId: string }>("comfy.generate", input);
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
      const result = await op<{ taskId: string }>("comfy.prepare", { target });
      if (result.taskId) selectTask(result.taskId);
      await refreshTasks();
      await refreshEnv();
    },
    [op, selectTask, refreshTasks, refreshEnv],
  );

  const handleInstall = useCallback(
    async (app: string, source: string) => {
      const result = await op<{ taskId: string }>("comfy.install", { app, source });
      if (result.taskId) selectTask(result.taskId);
      await refreshTasks();
    },
    [op, selectTask, refreshTasks],
  );

  const handleSetSource = useCallback(
    async (source: string) => {
      await op("comfy.settings.set", { downloadSource: source });
      await refreshCatalog();
    },
    [op, refreshCatalog],
  );

  // 引擎的启动/关闭由引擎面板自己调用 operation；这里只负责在动作后同步状态与任务。
  const handleEngineChanged = useCallback(async () => {
    await refreshEngine();
    await refreshTasks();
  }, [refreshEngine, refreshTasks]);

  const handleCancel = useCallback(async () => {
    if (!selectedId) return;
    await op("comfy.task.cancel", { id: selectedId });
    await refreshTasks();
    await renderRight(selectedId);
  }, [op, selectedId, refreshTasks, renderRight]);

  const handleSave = useCallback(
    async (generationId: string, kind: "image" | "video" | "audio") => {
      await op("comfy.save", { id: generationId, kind });
      if (selectedId) await renderRight(selectedId);
    },
    [op, selectedId, renderRight],
  );

  const handleEdit = useCallback(
    async (generationId: string) => {
      setTab("generate");
      try {
        const result = await op<{ assetId: string }>("comfy.save", { id: generationId, kind: "image" });
        setInjectedReference({ id: result.assetId, name: `comfy-${generationId}`, nonce: Date.now() });
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
      setInjectedReference({ id: draft.id, name: `comfy-${draft.id}`, nonce: Date.now(), draft });
    },
    [],
  );

  // 手动重试：立刻回到 loading 让用户看到反馈，再走同一条探测；失败原因由 refreshCatalog 落到可见状态。
  const retryProbe = useCallback(async () => {
    setCatalogPhase("loading");
    await refreshCatalog();
    await refreshTasks();
    await refreshEnv();
    await refreshEngine();
  }, [refreshCatalog, refreshTasks, refreshEnv, refreshEngine]);

  // 工作台内的「重新同步」：只刷新数据，失败保留当前工作台并就地提示。
  const resync = useCallback(async () => {
    await refreshCatalog(false);
    await refreshTasks();
  }, [refreshCatalog, refreshTasks]);

  const envReady = env?.ready ?? catalog.ready;
  if (catalogPhase === "ready" && !envReady) {
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
    <main className="mx-auto flex w-full max-w-[1600px] flex-col p-4 sm:p-6 xl:h-dvh xl:overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 px-1 py-1">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Workflow className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight">{t(locale, "app.name")}</h1>
            <p className="max-w-2xl truncate text-xs text-muted-foreground">{t(locale, "app.subtitle")}</p>
          </div>
        </div>
        <EngineControl locale={locale} status={engine} starting={engineStarting} pending={catalogPhase !== "ready"} onOpen={() => setEngineOpen(true)} />
      </header>

      <div className="mt-4 grid min-h-0 flex-1 gap-4 xl:grid-cols-[26rem_minmax(0,1fr)]">
        <Card className="flex min-h-[36rem] flex-col gap-0 overflow-hidden py-0 [--card-spacing:0px] xl:min-h-0">
          {catalogPhase === "ready" ? (
            <Tabs value={tab} onValueChange={(value) => setTab(value as "generate" | "records")} className="flex min-h-0 flex-1 flex-col gap-0">
              <div className="flex h-11 shrink-0 items-center border-b border-border/70 px-4">
                <TabsList variant="line" className="h-full gap-5">
                  <TabsTrigger value="generate" className="flex-none px-0.5">{t(locale, "tab.generate")}</TabsTrigger>
                  <TabsTrigger value="records" className="flex-none px-0.5">{t(locale, "tab.records")}</TabsTrigger>
                </TabsList>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <TabsContent value="generate">
                  <WorkflowTab
                    apps={catalog.apps}
                    runtimes={catalog.runtimes}
                    locale={locale}
                    downloadSource={catalog.downloadSource}
                    injectedReference={injectedReference}
                    onGenerate={handleGenerate}
                    onSaveDefault={handleSaveDefault}
                    onPrepare={handlePrepare}
                    onInstall={handleInstall}
                    onSetSource={handleSetSource}
                    onSavedDefaults={() => { void refreshCatalog(false); }}
                  />
                </TabsContent>
                <TabsContent value="records">
                  <RecordsTab tasks={tasks} locale={locale} selectedId={selectedId} onSelect={selectTask} />
                </TabsContent>
              </div>
            </Tabs>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <BootNotice
                locale={locale}
                connected={connected}
                phase={catalogPhase}
                elapsedSeconds={(clock - bootStartedAt.current) / 1000}
                attempts={catalogAttempts}
                error={catalogError}
                onRetry={() => void retryProbe()}
              />
            </div>
          )}
        </Card>

        <Card className="flex min-h-[36rem] flex-col gap-0 overflow-hidden py-0 [--card-spacing:0px] xl:min-h-0">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-4">
            <span className="text-xs font-semibold text-foreground">{t(locale, "preview.title")}</span>
            <span className="flex-1" />
            <Button variant="ghost" size="sm" disabled={catalogPhase !== "ready"} onClick={() => void resync()}>
              <RefreshCw className="size-3.5" />{t(locale, "app.resync")}
            </Button>
            {catalogPhase === "ready" && catalogError
              ? <span className="max-w-[14rem] truncate text-[10px] text-destructive" title={catalogError}>{catalogError}</span>
              : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <PreviewPane task={detail} generation={generation} params={params} logs={logs} locale={locale} onCancel={handleCancel} onSave={handleSave} onEdit={handleEdit} onRemix={handleRemix} />
          </div>
        </Card>
      </div>

      <EngineDialog
        open={engineOpen}
        locale={locale}
        status={engine}
        starting={engineStarting}
        onClose={() => setEngineOpen(false)}
        onChanged={() => void handleEngineChanged()}
      />
    </main>
  );
}
