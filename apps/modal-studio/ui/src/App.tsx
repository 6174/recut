/**
 * [INPUT]: 依赖 recut-sdk（background.call + events.subscribe 实时事件）、Left 两 Tab 组件、Right 预览组件与 i18n
 * [OUTPUT]: Modal 云函数主工作区：首屏走 modal.overview（本机 registry + 上次就绪度快照，零等待）即时渲染出预设包与表单，就绪度/连通性由 modal.status 独立后台探测回填、不阻塞任何 UI；「运行」时动态校验该预设包的就绪度，未就绪则提示先准备或重新部署；任务列表按事件增量刷新、选中任务详情与产物、预览图「以此为参考图运行」回填左侧表单、动作编排与语言同步；**当前 Tab 与 Right 面板聚焦的任务 id 经 useViewStore 持久化**（下次打开直接回到上次的 Tab 与预览目标，任务已失效则清掉）；外壳由 shadcn Tabs/Card/Button 承载
 * [POS]: ui 的状态编排层；只经 App operation 契约访问后台，不直接读写本机文件
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cloud, Loader2, RefreshCw } from "lucide-react";
import { isRecutConnected, recut, useRecutLocale } from "./recut-sdk";
import { t } from "./i18n";
import { useViewStore } from "./state/view";
import { RunTab } from "./components/RunTab";
import { RecordsTab } from "./components/RecordsTab";
import { PreviewPane } from "./components/PreviewPane";
import { Setup } from "./components/Setup";
import { ConnectionControl } from "./components/ConnectionControl";
import { AccountDialog } from "./components/AccountDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Catalog, EnvStatus, Generation, GenerationParams, InjectedReference, LogLine, ModalAppReadiness, Overview, Task, TaskDetail } from "./types";
import "./style.css";

const EMPTY_CATALOG: Catalog = { ready: false, connected: false, modalapps: [], profiles: [], defaultProfileId: "", downloadSource: "automatic", defaultGpuTier: "" };
const APP_ID = "recut.modal-studio";
// 就绪度快照的新鲜度：过期才在「点击运行」时重新探测（modal CLI 秒级），新鲜则直接采信、不打断提交。
const READINESS_TTL_MS = 60_000;

// 静态清单（overview）+ 就绪度（本次探测，缺省回放上次快照）→ 组件消费的目录。
// 分开是因为清单来自本机文件、应当立刻可渲染，而就绪度必须等 modal CLI 探测（秒级）；
// 只有真正探测过才写 deployed/volumeReady，未知保持缺省（界面据此显示「待检查」而非误报未部署）。
function mergeCatalog(overview: Overview | null, status: EnvStatus | null): Catalog {
  const states = status?.modalapps ?? overview?.snapshot?.modalapps;
  return {
    ...EMPTY_CATALOG,
    ready: status?.ready === true,
    connected: status?.connected === true,
    error: status?.error || "",
    account: status?.account || overview?.snapshot?.account || "",
    modalapps: (overview?.modalapps ?? []).map((modalapp) => ({ ...modalapp, ...(states ? states[modalapp.id] : undefined) })),
    profiles: overview?.profiles ?? [],
    defaultProfileId: overview?.defaultProfileId ?? "",
    downloadSource: overview?.downloadSource ?? EMPTY_CATALOG.downloadSource,
    defaultGpuTier: overview?.defaultGpuTier ?? "",
  };
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 animate-spin text-primary" />
      <p className="text-xs">{label}</p>
    </div>
  );
}

export default function App() {
  const locale = useRecutLocale();
  const [connected, setConnected] = useState(() => isRecutConnected());
  const [loaded, setLoaded] = useState(false);
  const tab = useViewStore((state) => state.tab);
  const setTab = useViewStore((state) => state.setTab);
  const selectedId = useViewStore((state) => state.selectedTaskId);
  const setSelectedId = useViewStore((state) => state.setSelectedTaskId);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [live, setLive] = useState<EnvStatus | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [params, setParams] = useState<GenerationParams | null>(null);
  const [injectedReference, setInjectedReference] = useState<InjectedReference | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());

  const loadedRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const trackedJobIdsRef = useRef<Set<string>>(new Set());
  const refreshTimer = useRef<number | null>(null);
  const logTimer = useRef<number | null>(null);
  const statusRef = useRef<EnvStatus | null>(null);
  const statusRequest = useRef<Promise<EnvStatus | null> | null>(null);
  const statusSeq = useRef(0);

  // 展示用状态：就绪度优先用本次探测，其次回放上次快照（进入即显示上次已知的正确状态）。
  const status = live ?? overview?.snapshot ?? null;
  const catalog = useMemo(() => mergeCatalog(overview, status), [overview, status]);

  const hasActiveTask = tasks.some((task) => task.state === "queued" || task.state === "running");
  const prepareTask = tasks.find((task) => task.action === "prepare" && (task.state === "queued" || task.state === "running"));

  const op = useCallback(
    <T,>(name: string, input: Record<string, unknown> = {}) => recut.background.call(name, input) as Promise<T>,
    [],
  );

  // 就绪度/连通性探测：唯一需要拉 modal CLI 的操作（秒级），因此与首屏彻底解耦、独立刷新；
  // 在途请求共用一份，避免「点击运行」与后台刷新各探一次。force 用于刚改过凭据（新增 token）后
  // 必须重新探测的场景——复用在途请求会拿到改动前的结果。
  const refreshStatus = useCallback(async (force = false) => {
    if (!force && statusRequest.current) return statusRequest.current;
    const seq = ++statusSeq.current;
    const request = op<EnvStatus>("modal.status").catch(() => statusRef.current);
    if (!force) statusRequest.current = request;
    try {
      const result = await request;
      // 只接受最新一次探测：先发的旧请求可能后返回，直接落库会把状态写回旧的。
      if (result && seq === statusSeq.current) setLive(result);
      return result;
    } finally {
      if (statusRequest.current === request) statusRequest.current = null;
    }
  }, [op]);

  // 首屏清单：只读本机（registry/profiles/设置）+ 上次就绪度快照，不拉 modal CLI。
  const refreshOverview = useCallback(async () => {
    try {
      setOverview(await op<Overview>("modal.overview"));
    } catch {
      /* keep last snapshot */
    }
  }, [op]);

  // 首屏负载：优先 modal.overview（纯本机读取，毫秒级）；若平台还没声明该 op（service 未重启 / 运行的是
  // 旧版本），回退到 modal.catalog —— 同样给出清单与就绪度，只是要等一次 modal CLI 探测。任何版本组合
  // 都不会停在加载态。
  const loadFirstPaint = useCallback(async () => {
    try {
      return { overview: await op<Overview>("modal.overview"), status: null as EnvStatus | null };
    } catch {
      const catalog = await op<Catalog>("modal.catalog");
      const states: Record<string, ModalAppReadiness> = {};
      for (const modalapp of catalog.modalapps) {
        states[modalapp.id] = { deployed: modalapp.deployed, volumeReady: modalapp.volumeReady, stale: modalapp.stale };
      }
      return {
        overview: {
          modalapps: catalog.modalapps, profiles: catalog.profiles, defaultProfileId: catalog.defaultProfileId,
          downloadSource: catalog.downloadSource, defaultGpuTier: catalog.defaultGpuTier, snapshot: null,
        },
        status: {
          ready: catalog.ready, connected: catalog.connected, account: catalog.account, error: catalog.error,
          modalapps: states, checkedAt: new Date().toISOString(),
        } as EnvStatus,
      };
    }
  }, [op]);

  // 「运行」前的动态校验：状态新鲜且已就绪就直接采信；否则重探一次——**包括「已确定未就绪」的情况**，
  // 因为一次探测抖动会被写进状态与快照，若不复核就会把假的「权重没下载」固化成拦截。
  const ensureReady = useCallback(
    async (modalappId: string) => {
      const current = statusRef.current;
      const state = current?.modalapps?.[modalappId];
      const fresh = Boolean(current?.checkedAt) && Date.now() - Date.parse(String(current?.checkedAt)) < READINESS_TTL_MS;
      const result = fresh && state?.deployed === true && state?.volumeReady === true ? current : await refreshStatus();
      const next = result?.modalapps?.[modalappId];
      return { deployed: next?.deployed, volumeReady: next?.volumeReady };
    },
    [refreshStatus],
  );

  const refreshTasks = useCallback(async () => {
    try {
      const result = await op<{ tasks: Task[] }>("modal.tasks.list", { limit: 50 });
      setTasks(result.tasks ?? []);
    } catch {
      setTasks([]);
    }
  }, [op]);

  const renderRight = useCallback(
    async (id: string) => {
      const current = await op<TaskDetail>("modal.task.get", { id });
      setDetail(current);
      if (current.action === "generate") {
        try {
          const result = await op<{ params: GenerationParams | null }>("modal.task.params", { id });
          setParams(result.params ?? null);
        } catch {
          setParams(null);
        }
      } else {
        setParams(null);
      }
      if (current.action === "generate" && current.state === "completed" && current.recordId) {
        setGeneration(await op<Generation>("modal.generation.complete", { id: current.recordId }));
        setLogs([]);
      } else {
        setGeneration(null);
        const result = await op<{ logs: LogLine[] }>("modal.task.logs", { id, limit: 300 });
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
    [renderRight, setSelectedId],
  );

  // 首屏恢复上次的聚焦目标：本地记住的任务若还在账本里就直接渲染右侧预览（下次打开即所见），
  // 已失效（被清理/换机）则清掉，避免右侧停在空白。只在任务账本回来之后判定一次。
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !connected || !loaded) return;
    const id = useViewStore.getState().selectedTaskId;
    if (!id) {
      restoredRef.current = true;
      return;
    }
    if (!tasks.length) return;
    restoredRef.current = true;
    if (tasks.some((task) => task.id === id)) void renderRight(id).catch(() => {});
    else setSelectedId(null);
  }, [connected, loaded, tasks, renderRight, setSelectedId]);

  useEffect(() => {
    if (connected) return;
    const onReady = () => setConnected(true);
    window.addEventListener("recut-sdk-ready", onReady);
    return () => window.removeEventListener("recut-sdk-ready", onReady);
  }, [connected]);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // 本 App 经 modal_tasks 提交的 shell job id 集合（事件过滤用）。
  useEffect(() => {
    trackedJobIdsRef.current = new Set(tasks.map((task) => task.jobId).filter((id): id is string => Boolean(id)));
  }, [tasks]);

  // 本地秒针：仅在存在在途任务时驱动计时显示，不发任何请求。
  useEffect(() => {
    if (!hasActiveTask) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveTask]);

  // 首屏：modal.overview 是本机读取（毫秒级），拿到即可渲染预设包与表单；就绪度/连通性（modal.status，
  // 要拉 modal CLI，秒级）随后独立探测回填，不阻塞任何 UI。overview 失败时有限重试。
  useEffect(() => {
    if (!connected || loaded) return;
    let cancelled = false;
    const load = async () => {
      try {
        const first = await loadFirstPaint();
        if (cancelled) return;
        setOverview(first.overview);
        // 回退路径（modal.catalog）本身就带回了就绪度，不必再探一次。
        if (first.status) setLive(first.status);
        setLoaded(true);
        void refreshTasks();
        if (!first.status) void refreshStatus();
      } catch {
        if (!cancelled) window.setTimeout(load, 2000);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [connected, loaded, loadFirstPaint, refreshTasks, refreshStatus]);

  // 事件驱动的增量刷新：后台 shell job 生命周期（started/completed）触发一次合并刷新。
  const refreshFromEvent = useCallback(async (includeStatus: boolean) => {
    if (!loadedRef.current || includeStatus) await refreshStatus();
    await refreshTasks();
    const id = selectedIdRef.current;
    if (id) {
      try {
        await renderRight(id);
      } catch {
        /* ignore transient */
      }
    }
  }, [refreshStatus, refreshTasks, renderRight]);

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

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const handleRun = useCallback(
    async (input: Record<string, unknown>) => {
      const result = await op<{ taskId: string }>("modal.generate", input);
      if (result.taskId) selectTask(result.taskId);
      await refreshTasks();
    },
    [op, selectTask, refreshTasks],
  );

  const handlePrepare = useCallback(
    async () => {
      const result = await op<{ taskId: string }>("modal.prepare", {});
      if (result.taskId) selectTask(result.taskId);
      await refreshTasks();
      await refreshStatus();
    },
    [op, selectTask, refreshTasks, refreshStatus],
  );

  const handleDeploy = useCallback(
    async (modalapp: string) => {
      const result = await op<{ taskId: string }>("modal.deploy", { modalapp });
      if (result.taskId) selectTask(result.taskId);
      await refreshTasks();
      await refreshStatus();
    },
    [op, selectTask, refreshTasks, refreshStatus],
  );

  const handleInstall = useCallback(
    async (modalapp: string, source: string) => {
      const result = await op<{ taskId: string }>("modal.install", { modalapp, source });
      if (result.taskId) selectTask(result.taskId);
      await refreshTasks();
      await refreshStatus();
    },
    [op, selectTask, refreshTasks, refreshStatus],
  );

  const handleAccountChanged = useCallback(async () => {
    await refreshOverview();
    await refreshStatus();
  }, [refreshOverview, refreshStatus]);

  const handleConnect = useCallback(
    async (name: string, tokenId: string, tokenSecret: string) => {
      setConnecting(true);
      try {
        await op("modal.profiles.add", { name, tokenId, tokenSecret, makeDefault: true });
        // 刚写入 token：必须强制重探，复用在途探测会拿到「还没有这个 token」时的结果而误判失败。
        const status = await refreshStatus(true);
        await refreshOverview();
        if (!status?.connected) throw new Error(status?.error || t(locale, "setup.failed").replace("{error}", "unknown"));
      } finally {
        setConnecting(false);
      }
    },
    [op, refreshStatus, refreshOverview, locale],
  );

  const handleCancel = useCallback(async () => {
    if (!selectedId) return;
    await op("modal.task.cancel", { id: selectedId });
    await refreshTasks();
    await renderRight(selectedId);
  }, [op, selectedId, refreshTasks, renderRight]);

  const handleSave = useCallback(
    async (generationId: string, kind: "image" | "video" | "audio") => {
      await op("modal.save", { id: generationId, kind });
      if (selectedId) await renderRight(selectedId);
    },
    [op, selectedId, renderRight],
  );

  const handleEdit = useCallback(
    async (generationId: string) => {
      setTab("run");
      try {
        const result = await op<{ assetId: string }>("modal.save", { id: generationId, kind: "image" });
        setInjectedReference({ id: result.assetId, name: `modal-${generationId}`, nonce: Date.now() });
        if (selectedId) await renderRight(selectedId);
      } catch (error) {
        setInjectedReference({ id: "", nonce: Date.now(), error: error instanceof Error ? error.message : String(error) });
      }
    },
    [op, selectedId, renderRight],
  );

  const handleRemix = useCallback((draft: GenerationParams) => {
    setTab("run");
    setInjectedReference({ id: draft.id, name: `modal-${draft.id}`, nonce: Date.now(), draft });
  }, []);

  // 启动门只由「本次探测」决定（live）：快照可能已过期，用过期快照去触发 modal.prepare 或渲染 token 表单
  // 会误判（例如环境其实已就绪却自动重跑一次准备）。探测未回来前照常渲染工作台，不做全屏阻塞。
  if (live && !live.ready) {
    const elapsedSeconds = prepareTask ? (clock - Date.parse(prepareTask.createdAt)) / 1000 : 0;
    return (
      <Setup
        locale={locale}
        mode="env"
        busy={Boolean(prepareTask)}
        elapsedSeconds={elapsedSeconds}
        failure={live.setupError || (Boolean(prepareTask) || live.pending ? "" : live.error || "")}
        failureLogs={live.setupLogs ?? []}
        logs={logs}
        onPrepare={() => void handlePrepare()}
        onConnect={handleConnect}
      />
    );
  }

  if (live && live.ready && live.connected !== true) {
    return (
      <Setup
        locale={locale}
        mode="token"
        busy={connecting}
        elapsedSeconds={0}
        failure={live.error || status?.error || ""}
        failureLogs={[]}
        logs={[]}
        onPrepare={() => void handlePrepare()}
        onConnect={handleConnect}
      />
    );
  }

  const booting = !loaded;
  const activeProfile = catalog.profiles.find((profile) => profile.id === catalog.defaultProfileId);

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col p-4 sm:p-6 xl:h-dvh xl:overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 px-1 py-1">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Cloud className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight">{t(locale, "app.name")}</h1>
            <p className="max-w-2xl truncate text-xs text-muted-foreground">{t(locale, "app.subtitle")}</p>
          </div>
        </div>
        <ConnectionControl locale={locale} connected={catalog.connected} loading={booting || !status} account={catalog.account} profileName={activeProfile?.name} onOpen={() => setAccountOpen(true)} />
      </header>

      <div className="mt-4 grid min-h-0 flex-1 gap-4 xl:grid-cols-[26rem_minmax(0,1fr)]">
        <Card className="flex min-h-[36rem] flex-col gap-0 overflow-hidden py-0 [--card-spacing:0px] xl:min-h-0">
          <Tabs value={tab} onValueChange={(value) => setTab(value as "run" | "records")} className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="flex shrink-0 items-center border-b border-border/70 px-4">
              <TabsList variant="line" className="h-10 gap-5">
                <TabsTrigger value="run" className="flex-none px-0.5">{t(locale, "tab.run")}</TabsTrigger>
                <TabsTrigger value="records" className="flex-none px-0.5">{t(locale, "tab.records")}</TabsTrigger>
              </TabsList>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {booting ? (
                <LoadingBlock label={t(locale, "app.loading-packs")} />
              ) : (
                <>
                  <TabsContent value="run">
                    <RunTab
                      modalapps={catalog.modalapps}
                      locale={locale}
                      defaultGpuTier={catalog.defaultGpuTier}
                      injectedReference={injectedReference}
                      onRun={handleRun}
                      onEnsureReady={ensureReady}
                      onDeploy={handleDeploy}
                      onInstall={handleInstall}
                    />
                  </TabsContent>
                  <TabsContent value="records">
                    <RecordsTab tasks={tasks} locale={locale} selectedId={selectedId} onSelect={selectTask} />
                  </TabsContent>
                </>
              )}
            </div>
          </Tabs>
        </Card>

        <Card className="flex min-h-[36rem] flex-col gap-0 overflow-hidden py-0 [--card-spacing:0px] xl:min-h-0">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-4">
            <span className="text-xs font-semibold text-foreground">{t(locale, "preview.title")}</span>
            <span className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => { void refreshOverview(); void refreshStatus(); void refreshTasks(); }}>
              <RefreshCw className="size-3.5" />{t(locale, "app.resync")}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <PreviewPane task={detail} generation={generation} params={params} logs={logs} locale={locale} onCancel={handleCancel} onSave={handleSave} onEdit={handleEdit} onRemix={handleRemix} />
          </div>
        </Card>
      </div>

      {accountOpen ? (
        <AccountDialog locale={locale} connected={catalog.connected} account={catalog.account} onClose={() => setAccountOpen(false)} onChanged={handleAccountChanged} />
      ) : null}
    </main>
  );
}
