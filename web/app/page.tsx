/*
 * [INPUT]: 依赖 React 状态能力、Zustand 共享的 Daemon 与按数据域区分失败原因的工作台目录状态、静态 App Catalog、统一 App 身份图标、Agent Session HTTP API 及全局 Agent 面板上下文、工作台 i18n 字典与 Accept-Language 统一请求包装
 * [OUTPUT]: 对外提供 app.recut.video / app.localhost:3000 的 Projects、Assets、Community 工作台入口（创作台 Studio 暂时隐藏，根路径 `/` 与 `/projects` 同渲染项目桌面）及保持根壳的一级 Tab 切换（顶层 Header 统一经 WorkspaceHeader 承载：工作台根壳保留品牌 mark + 一级 Tab，世界画布/详情页则为单一返回入口 + 单行标题区；世界画布激活时左侧让位给 WorldCanvasTopBar 面包屑、画布工具组 WorldCanvasToolbar 居中于整个 Header，右侧保留全局状态）、内容区统一为单一外部滚动容器（`data-workspace-scroll` + max-w-6xl，项目页与素材页共用标题/筛选骨架）、固定使用通用会话上下文的 Agent 面板（由根布局全局挂载，本页只声明作用域）、首次离线时的安装 service 引导与嵌入式工作台真实诊断空态（service 生命周期界面收敛在 `components/service-guide`，本页只按 phase 选择渲染）；项目桌面与 Studio 最近区把本地 World 与项目按 updatedAt 混排（平台/PGC 世界只在社区展示），新建项目入口可创建 World；全部文案经 useI18n 迁移到 workspace 字典
 * [POS]: web/app 的应用工作台框架；app Host 默认进入项目（创作台 Studio 暂时隐藏、代码保留），社区（Community）统一承载 PGC Worlds 与 Apps 目录两个可扩展分区，工作台目录由 lib/workspace-store 跨路由缓存，创建、安装、升级后显式刷新，绝不 5 秒轮询；Agent 面板不在此挂载，只经 agent-panel-context 声明会话作用域
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import {
  AppWindow,
  ArrowRight,
  Box,
  Captions,
  Clapperboard,
  Copy,
  FileImage,
  Globe2,
  ImageIcon,
  Link2,
  Music2,
  Plus,
  Scissors,
  Sparkles,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FormEvent,
  MouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import { AssetPreviewDialog } from "@/components/asset-preview-dialog";
import { AppIdentityIcon, appIcon } from "@/components/app-identity-icon";
import { RecutMark } from "@/components/brand-logo";
import { CardMoreMenu } from "@/components/card-more-menu";
import { Badge } from "@/components/ui/badge";
import { Community, type CommunityView } from "@/components/community/community";
import type { InstallationLoadState } from "@/components/community/apps-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CreateWorldDialog } from "@/components/create-world-dialog";
import { Input } from "@/components/ui/input";
import { HeaderActions } from "@/components/header-actions";
import { FilterTabs, WorkspacePageHeader } from "@/components/workspace-page";
import { WorkspaceNavHover } from "@/components/workspace-back-menu";
import { WorkspaceHeader } from "@/components/workspace-header";
import {
  useAgentPanelContext,
  useReportWorkSurface,
} from "@/lib/agent-panel-context";
import { ServiceChecking, ServiceGuide } from "@/components/service-guide";
import { SettingsPanel } from "@/components/settings-panel";
import {
  marketplaceDescription,
  marketplaceName,
  type MarketplaceApp,
} from "@/lib/appstore";
import { isLocalWorkspace, fetchRecutJSON } from "@/lib/service-endpoint";
import { useServiceStore } from "@/lib/service-store";
import {
  useWorkspaceStore,
  type WorkspaceInstallation as Installation,
  type WorkspaceProject as Project,
} from "@/lib/workspace-store";
import { worldOrigin, type WorldSummary } from "@/lib/recut-worlds-client";
import { useWorldsStore } from "@/lib/worlds-store";
import { t, useI18n, type Locale } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import {
  STUDIO_INSPIRATION_COUNT,
  STUDIO_TEMPLATE_COUNT,
} from "@/lib/i18n/workspace-studio-dict";
import { VideoFrame } from "@/components/video-frame";
import { WebGLStudioHero } from "@/components/webgl-studio-hero";
import { StudioScenarioDialog } from "@/components/studio-scenario-dialog";
import {
  STUDIO_SCENARIO_FIELDS,
  type StudioFieldDef,
} from "@/lib/studio-scenarios";
import type { Asset } from "./media/media-types";
import { MediaLibraryPanel } from "./media/media-library-panel";
import {
  WorldCanvasShareButton,
  WorldCanvasToolbar,
  WorldCanvasTopBar,
  useWorldCanvasTopBarStore,
} from "./worlds/[worldID]/canvas/canvas-top-bar";

type AppDetailRenderer = (context: {
  onConnectService: () => void;
  serviceOnline: boolean;
}) => React.ReactNode;
type WorkspaceTab = "studio" | "projects" | "assets" | "community";
type WorkspaceProps = {
  appDetail?: AppDetailRenderer;
  /** 社区一级 Tab 下的分区：home / apps / worlds。 */
  communitySection?: CommunityView;
  contentTab?: WorkspaceTab;
  initialTab?: WorkspaceTab;
};

export function Workspace(props: WorkspaceProps = {}) {
  return <WorkspaceFrame {...props} />;
}

function WorkspaceFrame({
  appDetail,
  communitySection = "home",
  contentTab,
  initialTab = "projects",
}: WorkspaceProps = {}) {
  const { t } = useI18n();
  const installations = useWorkspaceStore((state) => state.installations);
  const catalogApps = useWorkspaceStore((state) => state.apps);
  const projects = useWorkspaceStore((state) => state.projects);
  const worlds = useWorldsStore((state) => state.page);
  const loadWorlds = useWorldsStore((state) => state.loadPage);
  const installationsState = useWorkspaceStore(
    (state) => state.installationsState,
  );
  const installationsError = useWorkspaceStore(
    (state) => state.installationsError,
  );
  const loadWorkspace = useWorkspaceStore((state) => state.load);
  const marketplace = useWorkspaceStore((state) => state.marketplace);
  const loadMarketplace = useWorkspaceStore((state) => state.loadMarketplace);
  const [initialAssetID, setInitialAssetID] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("asset") ?? ""),
  );
  const [createApp, setCreateApp] = useState<Installation | null>(null);
  const [createWorld, setCreateWorld] = useState(false);
  const service = useServiceStore((state) => state.service);
  const apiBase = useServiceStore((state) => state.endpoint);
  const [tab, setTab] = useState<WorkspaceTab>(
    contentTab ?? (appDetail ? "community" : initialTab),
  );
  const [mediaProjectID, setMediaProjectID] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    "service" | "multimodal" | undefined
  >();

  const online = service.phase === "online";
  // 平台原生 App（如剪辑器）没有安装包，不在 /v1/apps/installed 里，但必须作为可创建
  // 的项目类型出现；这里把 catalog（/v1/apps）里未出现在安装列表的原生 App 合成进来。
  const availableInstallations = useMemo<Installation[]>(() => {
    const installed = new Set(installations.map((app) => app.manifest.id));
    const native = catalogApps
      .filter((app) => !installed.has(app.manifest.id))
      .map((app) => ({
        package: app.manifest.id,
        manifest: app.manifest,
        dirty: false,
        updateAvailable: false,
        manageable: false,
      }));
    return [...installations, ...native];
  }, [installations, catalogApps]);
  const showLanding = !isLocalWorkspace && service.phase === "offline";
  const showAgentPanel = isLocalWorkspace || service.phase !== "offline";
  const agentProjectID = tab === "assets" ? mediaProjectID : null;
  useLayoutEffect(() => {
    useAgentPanelContext.getState().setProjectID(agentProjectID);
  }, [agentProjectID]);
  const workSurface = useMemo(
    () =>
      tab === "assets"
        ? {
            version: 1 as const,
            surface: "media_library" as const,
            title: t("page.assets.title"),
            path: "/media",
            target: {
              kind: "media_library" as const,
              scope: mediaProjectID
                ? ("project" as const)
                : ("workspace" as const),
              projectId: mediaProjectID ?? undefined,
            },
            policy: { defaultIntent: "media_manage" as const },
          }
        : tab === "community"
          ? {
              version: 1 as const,
              surface: "workspace" as const,
              title: t("page.community.title"),
              path: "/community",
              policy: { defaultIntent: "browse" as const },
            }
          : tab === "projects"
            ? {
                version: 1 as const,
                surface: "workspace" as const,
                title: t("page.projects.title"),
                path: "/projects",
                policy: { defaultIntent: "browse" as const },
              }
            : null,
    [tab, t],
  );
  useReportWorkSurface(workSurface);
  useEffect(() => {
    if (!online) return;
    void loadWorkspace(apiBase);
  }, [apiBase, loadWorkspace, online]);

  // 项目桌面与 Worlds 桌面共用同一份世界目录：这里预取一次，Projects/Studio 与
  // /worlds 页面命中同一缓存键（limit=50），因此不会产生重复请求。
  useEffect(() => {
    if (!online) return;
    void loadWorlds(apiBase, { limit: 50 });
  }, [apiBase, loadWorlds, online]);

  // 应用市场（云端数据）与 service 目录解耦：挂载即拉取，语言切换只影响展示层选择。
  useEffect(() => {
    void loadMarketplace();
  }, [loadMarketplace]);

  const pathname = usePathname();
  useEffect(() => {
    const next = tabFromPath(pathname ?? "/");
    if (next && next !== tab) setTab(next);
  }, [pathname, tab]);

  async function reloadWorkspace() {
    await loadWorkspace(apiBase, true);
  }

  function openCreateProject(app: Installation) {
    setCreateApp(app);
  }

  function openCreateWorld() {
    setCreateWorld(true);
  }

  async function createProjectWithApp(app: Installation, projectName: string) {
    const project = await fetchRecutJSON<Project>(apiBase, "/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: projectName, appId: app.manifest.id }),
    });
    await loadWorkspace(apiBase, true);
    window.location.assign(`/projects/${project.id}`);
  }

  async function renameProject(project: Project, projectName: string) {
    await fetchRecutJSON(
      apiBase,
      `/v1/projects/${encodeURIComponent(project.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName }),
      },
    );
    await loadWorkspace(apiBase, true);
  }

  async function deleteProject(project: Project) {
    await fetchRecutJSON(
      apiBase,
      `/v1/projects/${encodeURIComponent(project.id)}`,
      { method: "DELETE" },
    );
    await loadWorkspace(apiBase, true);
  }

  function openMediaProviderSettings() {
    setSettingsSection("multimodal");
    setSettingsOpen(true);
  }

  function openServiceSettings() {
    setSettingsSection("service");
    setSettingsOpen(true);
  }

  function changeSettingsOpen(open: boolean) {
    setSettingsOpen(open);
    if (!open) setSettingsSection(undefined);
  }

  useEffect(() => {
    if (tab !== "assets") setInitialAssetID("");
  }, [tab]);

  const router = useRouter();
  function navigateTab(
    next: WorkspaceTab,
    href: string,
    event: MouseEvent<HTMLAnchorElement>,
  ) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    // All workspace tabs go through Next router to keep URL and rendered route in sync
    // (fixes: detail route -> tab click kept stale appDetail, and home -> worlds via Link vs pushState mismatch)
    router.push(href);
  }

  const detail = appDetail?.({
    onConnectService: openServiceSettings,
    serviceOnline: online,
  });
  // 世界画布激活时：顶层 Header 左侧让位给 world 导航（面包屑），画布工具组居中于整个 Header，右侧全局状态不变。
  const canvasTopBarActive = useWorldCanvasTopBarStore((state) => state.active);
  const appInstallationLoadState: InstallationLoadState = online
    ? installationsState
    : service.phase === "checking"
      ? "loading"
      : "offline";
  const content =
    detail ??
    (service.phase === "checking" ? (
      <ServiceChecking />
    ) : !online ? (
      <ServiceGuide
        embedded={isLocalWorkspace}
        error={service.error}
        onConnectRemote={openServiceSettings}
      />
    ) : tab === "community" ? (
      <Community
        apiBase={apiBase}
        installationError={installationsError}
        installationLoadState={appInstallationLoadState}
        installations={installations}
        marketplace={marketplace}
        onStartProject={openCreateProject}
        onUpdated={reloadWorkspace}
        section={communitySection}
        serviceOnline={online}
      />
    ) : tab === "studio" ? (
      <Studio
        apiBase={apiBase}
        apps={availableInstallations.filter(
          (app) => app.manifest.type === "project",
        )}
        installations={availableInstallations}
        onCompose={(text) =>
          useAgentPanelContext
            .getState()
            .setDraft({ id: `${Date.now()}`, text })
        }
        onCreateWorld={openCreateWorld}
        onDeleteProject={deleteProject}
        onManageApps={(event) =>
          navigateTab("community", "/community/apps", event)
        }
        onRenameProject={renameProject}
        onStartProject={openCreateProject}
        projects={projects}
        worlds={worlds}
      />
    ) : tab === "projects" ? (
      <ProjectsPage
        apiBase={apiBase}
        apps={availableInstallations.filter(
          (app) => app.manifest.type === "project",
        )}
        onCreateWorld={openCreateWorld}
        onDeleteProject={deleteProject}
        onRenameProject={renameProject}
        onStartProject={openCreateProject}
        projects={projects}
        worlds={worlds}
      />
    ) : (
      <MediaLibraryPanel
        initialAssetID={initialAssetID}
        onOpenProviderSettings={openMediaProviderSettings}
        onProjectIDChange={setMediaProjectID}
      />
    ));
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <WorkspaceHeader
        actions={
          !showLanding && (
            <>
              {canvasTopBarActive && (
                <>
                  <WorldCanvasShareButton />
                  <span aria-hidden="true" className="h-5 w-px bg-border" />
                </>
              )}
              <HeaderActions
                onSettingsOpenChange={changeSettingsOpen}
                settingsOpen={settingsOpen}
                settingsSection={settingsSection}
              />
            </>
          )
        }
        back={
          canvasTopBarActive
            ? { label: "返回工作台", onClick: () => router.push("/") }
            : null
        }
        center={canvasTopBarActive ? <WorldCanvasToolbar /> : null}
      >
        {canvasTopBarActive ? (
          <WorldCanvasTopBar />
        ) : (
          <>
            <WorkspaceNavHover>
              <Link
                aria-label={t("nav.home")}
                className="grid size-7 shrink-0 place-items-center rounded-md text-foreground transition hover:bg-muted"
                href="/"
              >
                <RecutMark className="h-5 w-auto" title="Recut" />
              </Link>
            </WorkspaceNavHover>
            <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
            <nav
              aria-label={t("nav.aria.workspace")}
              className="flex min-w-0 items-center gap-0.5 sm:gap-1"
            >
              <Tab
                active={tab === "projects"}
                href="/projects"
                onNavigate={navigateTab}
                tab="projects"
              >
                {t("nav.projects")}
              </Tab>
              <Tab
                active={tab === "assets"}
                href="/media"
                onNavigate={navigateTab}
                tab="assets"
              >
                {t("nav.assets")}
              </Tab>
              <Tab
                active={tab === "community"}
                href="/community"
                onNavigate={navigateTab}
                tab="community"
              >
                {t("nav.market")}
              </Tab>
            </nav>
          </>
        )}
      </WorkspaceHeader>
      <div
        id="workspace-content-region"
        className={`relative min-h-0 flex-1 overflow-hidden ${showAgentPanel ? "md:pl-[var(--side-panel-width)]" : ""}`}
      >
        <section
          className="h-full min-h-0 overflow-y-auto bg-background p-4 sm:p-6 md:p-8"
          data-workspace-scroll
        >
          <div className="mx-auto max-w-6xl">{content}</div>
        </section>
      </div>
      {showLanding && (
        <SettingsPanel
          hideTrigger
          onOpenChange={changeSettingsOpen}
          open={settingsOpen}
          section={settingsSection}
        />
      )}
      {createApp && (
        <CreateProjectFromAppDialog
          app={createApp}
          onClose={() => setCreateApp(null)}
          onCreate={async (projectName) =>
            createProjectWithApp(createApp, projectName)
          }
        />
      )}
      {createWorld && (
        <CreateWorldDialog
          apiBase={apiBase}
          onClose={() => setCreateWorld(false)}
          onCreated={() => {}}
        />
      )}
    </main>
  );
}

export default Workspace;

function tabFromPath(pathname: string): WorkspaceTab | null {
  // 创作台（Studio）暂时隐藏：根路径 / 与 /projects 都进入项目。
  if (pathname === "/") return "projects";
  if (pathname.startsWith("/community")) return "community";
  if (pathname === "/projects" || pathname === "/projects/") return "projects";
  if (pathname === "/media" || pathname === "/media/") return "assets";
  // 兼容深链：/apps、/worlds 现由社区承载（详情页 /apps/<id>、/worlds/<id> 不受影响）。
  if (pathname === "/apps" || pathname === "/apps/") return "community";
  if (pathname === "/worlds" || pathname === "/worlds/") return "community";
  return null;
}

function Tab({
  active,
  children,
  href,
  onNavigate,
  tab,
}: {
  active: boolean;
  children: React.ReactNode;
  href: string;
  onNavigate: (
    tab: WorkspaceTab,
    href: string,
    event: MouseEvent<HTMLAnchorElement>,
  ) => void;
  tab: WorkspaceTab;
}) {
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-lg bg-secondary px-2 py-1.5 text-[11px] font-semibold text-foreground sm:px-2.5 sm:text-xs"
          : "rounded-lg px-2 py-1.5 text-[11px] font-medium text-foreground hover:bg-secondary/70 sm:px-2.5 sm:text-xs"
      }
      href={href}
      onClick={(event) => onNavigate(tab, href, event)}
    >
      {children}
    </a>
  );
}

type SpaceItem =
  | { kind: "project"; project: Project }
  | { kind: "world"; world: WorldSummary };

// "all" = 全部；"world" = 世界；其余取值为 appId（项目型 App）。
type ProjectFilter = "all" | "world" | string;

function countSpaces(
  projects: Project[],
  worlds: WorldSummary[],
  filter: ProjectFilter,
): number {
  const projectCount = projects.filter(
    (project) => filter === "all" || project.appId === filter,
  ).length;
  const worldCount = worlds.filter(
    (world) =>
      worldOrigin(world) !== "platform" &&
      (filter === "all" || filter === "world"),
  ).length;
  return projectCount + worldCount;
}

function spaceUpdatedAt(item: SpaceItem): number {
  const raw =
    item.kind === "project" ? item.project.updatedAt : item.world.updatedAt;
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

// 项目与世界混排成同一个桌面：两者都按 updatedAt 倒序，卡片形态对齐，用户不必先判断
// "这是项目还是世界"。平台世界（origin=platform）是只读内容目录、不属于用户资产，
// 继续留在 /worlds 的独立货架，不混入这里。
function ProjectSpaces({
  apiBase,
  apps,
  filter = "all",
  limit,
  onCreateWorld,
  onDeleteProject,
  onRenameProject,
  onStartProject,
  projects,
  worlds,
}: {
  apiBase: string;
  apps: Installation[];
  filter?: ProjectFilter;
  limit?: number;
  onCreateWorld: () => void;
  onDeleteProject: (project: Project) => Promise<void>;
  onRenameProject: (project: Project, name: string) => Promise<void>;
  onStartProject: (app: Installation) => void;
  projects: Project[];
  worlds: WorldSummary[];
}) {
  const items = useMemo<SpaceItem[]>(() => {
    const mixed: SpaceItem[] = [
      ...projects
        .filter((project) => filter === "all" || project.appId === filter)
        .map((project): SpaceItem => ({ kind: "project", project })),
      ...worlds
        .filter((world) => worldOrigin(world) !== "platform")
        .filter(() => filter === "all" || filter === "world")
        .map((world): SpaceItem => ({ kind: "world", world })),
    ];
    mixed.sort((a, b) => spaceUpdatedAt(b) - spaceUpdatedAt(a));
    return typeof limit === "number" ? mixed.slice(0, limit) : mixed;
  }, [filter, projects, worlds, limit]);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <NewProjectCard
        apps={apps}
        onCreateWorld={onCreateWorld}
        onStartProject={onStartProject}
      />
      {items.map((item) =>
        item.kind === "project" ? (
          <ProjectCard
            apiBase={apiBase}
            app={apps.find((app) => app.manifest.id === item.project.appId)}
            key={`project-${item.project.id}`}
            onDeleteProject={onDeleteProject}
            onRenameProject={onRenameProject}
            project={item.project}
          />
        ) : (
          <WorldProjectCard
            apiBase={apiBase}
            key={`world-${item.world.id}`}
            world={item.world}
          />
        ),
      )}
    </div>
  );
}

function WorldProjectCard({
  apiBase,
  world,
}: {
  apiBase: string;
  world: WorldSummary;
}) {
  const { t } = useI18n();
  const isRemote = worldOrigin(world) !== "local";
  const previews = [
    ...(world.previewAssetIds ?? []).map(
      (assetID) =>
        `${apiBase}/v1/media/assets/${encodeURIComponent(assetID)}/content`,
    ),
    ...(world.previewUrls ?? []),
  ];
  const coverSrc = world.coverAssetId
    ? `${apiBase}/v1/media/assets/${encodeURIComponent(world.coverAssetId)}/content`
    : (isRemote ? (world.originMeta?.coverUrl ?? "") : "") || previews[0] || "";
  const kindLabel = t(`worlds.kind.${world.type}`);
  return (
    <div className="group relative">
      <Link className="block" href={`/worlds/${encodeURIComponent(world.id)}`}>
        <Card className="overflow-hidden transition group-hover:-translate-y-0.5 group-hover:border-foreground/20 group-hover:shadow-[var(--shadow-overlay)]">
          {coverSrc ? (
            <img
              alt={interpolate(t("worlds.card.cover.alt"), {
                name: world.name,
              })}
              className="aspect-[16/7] w-full border-b object-cover"
              src={coverSrc}
            />
          ) : (
            <div className="flex aspect-[16/7] items-center justify-between border-b bg-muted p-3">
              <span className="grid size-7 place-items-center rounded-sm bg-card text-muted-foreground shadow-sm">
                <Globe2 className="size-3.5" />
              </span>
              <span className="rounded-xs border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {kindLabel}
              </span>
            </div>
          )}
          <CardContent className="p-3">
            <p className="truncate text-sm font-semibold">{world.name}</p>
            <p className="mt-1 truncate text-[10px] text-muted-foreground">
              {kindLabel}
            </p>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

function NewProjectCard({
  apps,
  onCreateWorld,
  onStartProject,
}: {
  apps: Installation[];
  onCreateWorld: () => void;
  onStartProject: (app: Installation) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="group flex min-h-40 min-w-0 flex-col rounded-lg border-2 border-dashed border-border bg-transparent p-4 text-left shadow-none transition hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Plus className="size-5" />
        </span>
        <span className="mt-auto">
          <span className="block text-base font-semibold">
            {t("projects.new")}
          </span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {t("projects.new.desc")}
          </span>
        </span>
      </button>
      {open && (
        <ProjectAppPickerDialog
          apps={apps}
          onClose={() => setOpen(false)}
          onPick={(app) => {
            setOpen(false);
            onStartProject(app);
          }}
          onPickWorld={() => {
            setOpen(false);
            onCreateWorld();
          }}
        />
      )}
    </>
  );
}

function ProjectAppPickerDialog({
  apps,
  onClose,
  onPick,
  onPickWorld,
}: {
  apps: Installation[];
  onClose: () => void;
  onPick: (app: Installation) => void;
  onPickWorld: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="dialog"
      aria-labelledby="project-app-picker-title"
    >
      <section
        className="w-full max-w-lg rounded-sm border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-muted-foreground">
              NEW PROJECT
            </p>
            <h2
              className="mt-1 text-base font-semibold"
              id="project-app-picker-title"
            >
              {t("projects.picker.title")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("projects.picker.desc")}
            </p>
          </div>
          <button
            aria-label={t("projects.picker.close")}
            className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="grid gap-2 p-3">
          <button
            className="group flex min-w-0 items-center gap-3 rounded-sm p-3 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            onClick={onPickWorld}
            type="button"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl border bg-muted text-muted-foreground transition group-hover:bg-secondary">
              <Globe2 aria-hidden="true" className="size-5" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {t("projects.picker.world")}
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {t("projects.picker.worldDesc")}
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </button>
          {sortByOrder(apps, PROJECT_APP_ORDER).map((app) => (
            <button
              className="group flex min-w-0 items-center gap-3 rounded-sm p-3 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              key={app.package}
              onClick={() => onPick(app)}
              type="button"
            >
              <AppIdentityIcon
                appID={app.manifest.id}
                className="transition group-hover:bg-secondary"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {app.manifest.name}
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {app.manifest.description}
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function homeInspirations(locale: Locale) {
  return Array.from({ length: STUDIO_INSPIRATION_COUNT }, (_, index) =>
    t("workspace", locale, `studio.inspiration.${index}`),
  );
}

function inspirationForToday(locale: Locale) {
  const inspirations = homeInspirations(locale);
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  return inspirations[Math.abs(dayIndex) % inspirations.length];
}

type StudioPromptTemplate = {
  icon: LucideIcon;
  title: string;
  description: string;
  prompt: string;
  fields: StudioFieldDef[];
};

const STUDIO_TEMPLATE_ICONS: LucideIcon[] = [
  Clapperboard,
  Video,
  ImageIcon,
  Sparkles,
  Sparkles,
  Captions,
  Video,
  Clapperboard,
  Sparkles,
  Clapperboard,
  Video,
  Scissors,
  Copy,
  Globe2,
  Sparkles,
  Clapperboard,
];
const STUDIO_FIRST_VISIT_ICON: LucideIcon = Sparkles;

function studioPromptTemplates(locale: Locale): StudioPromptTemplate[] {
  return Array.from({ length: STUDIO_TEMPLATE_COUNT }, (_, index) => ({
    icon: STUDIO_TEMPLATE_ICONS[index],
    title: t("workspace", locale, `studio.template.${index}.title`),
    description: t("workspace", locale, `studio.template.${index}.description`),
    prompt: t("workspace", locale, `studio.template.${index}.prompt`),
    fields: STUDIO_SCENARIO_FIELDS[index] ?? [],
  }));
}

function studioFirstVisitTemplate(locale: Locale): StudioPromptTemplate {
  return {
    icon: STUDIO_FIRST_VISIT_ICON,
    title: t("workspace", locale, "studio.firstVisit.title"),
    description: t("workspace", locale, "studio.firstVisit.description"),
    prompt: t("workspace", locale, "studio.firstVisit.prompt"),
    fields: [],
  };
}

function promptTemplatesForToday(locale: Locale) {
  const templates = [
    ...studioPromptTemplates(locale),
    studioFirstVisitTemplate(locale),
  ];
  let seed = Math.floor(Date.now() / 86_400_000) >>> 0;
  for (let index = templates.length - 1; index > 0; index -= 1) {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    const swapIndex = seed % (index + 1);
    [templates[index], templates[swapIndex]] = [
      templates[swapIndex],
      templates[index],
    ];
  }
  return templates.slice(0, 2);
}

const STUDIO_HOME_ORDER = [
  "recut.editor",
  "recut.audio-studio",
  "recut.remotion-studio",
];
const PROJECT_APP_ORDER = [
  "recut.editor",
  "recut.remotion-studio",
  "recut.audio-studio",
];

function sortByOrder(list: Installation[], order: string[]) {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...list].sort(
    (a, b) =>
      (rank.get(a.manifest.id) ?? 999) - (rank.get(b.manifest.id) ?? 999),
  );
}

function Studio({
  apiBase,
  apps,
  installations,
  onCompose,
  onCreateWorld,
  onDeleteProject,
  onManageApps,
  onRenameProject,
  onStartProject,
  projects,
  worlds,
}: {
  apiBase: string;
  apps: Installation[];
  installations: Installation[];
  onCompose: (text: string) => void;
  onCreateWorld: () => void;
  onDeleteProject: (project: Project) => Promise<void>;
  onManageApps: (event: MouseEvent<HTMLAnchorElement>) => void;
  onRenameProject: (project: Project, name: string) => Promise<void>;
  onStartProject: (app: Installation) => void;
  projects: Project[];
  worlds: WorldSummary[];
}) {
  const { t, locale } = useI18n();
  const sortedInstallations = sortByOrder(installations, STUDIO_HOME_ORDER);
  const editorApp = sortedInstallations.find(
    (app) => app.manifest.id === "recut.editor",
  );
  const restInstallations = sortedInstallations.filter(
    (app) => app.manifest.id !== "recut.editor",
  );
  const [promptTemplates, setPromptTemplates] = useState(() =>
    studioPromptTemplates(locale).slice(0, 2),
  );
  useEffect(
    () => setPromptTemplates(promptTemplatesForToday(locale)),
    [locale],
  );
  const [scenario, setScenario] = useState<StudioPromptTemplate | null>(null);
  return (
    <>
      <div className="pb-10">
        <section className="relative min-h-[17rem] overflow-hidden pt-7 sm:min-h-[19rem]">
          <WebGLStudioHero />
          <div className="relative z-10 max-w-xl">
            <h1 className="mt-3 text-3xl font-semibold leading-tight">
              {t("studio.title")}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              {inspirationForToday(locale)}
            </p>
            <div className="mt-7 flex max-w-2xl flex-col">
              {promptTemplates.map(
                ({ description, fields, icon: Icon, prompt, title }) => (
                  <button
                    aria-label={interpolate(t("studio.template.aria"), {
                      title,
                    })}
                    className="group flex min-w-0 items-center gap-3 border-b border-border/80 py-3 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                    key={title}
                    onClick={() =>
                      setScenario({
                        description,
                        fields,
                        icon: Icon,
                        prompt,
                        title,
                      })
                    }
                    type="button"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground">
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-sm font-semibold">{title}</span>
                      <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
                        {description}
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </button>
                ),
              )}
            </div>
          </div>
        </section>
        <section className="mt-1">
          <SectionHeading
            action={
              <Link
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                href="/projects"
              >
                {t("studio.section.projects.all")}
                <ArrowRight className="size-3.5" />
              </Link>
            }
            description={t("studio.section.projects.desc")}
            title={t("studio.section.projects")}
          />
          <ProjectSpaces
            apiBase={apiBase}
            apps={apps}
            limit={11}
            onCreateWorld={onCreateWorld}
            onDeleteProject={onDeleteProject}
            onRenameProject={onRenameProject}
            onStartProject={onStartProject}
            projects={projects}
            worlds={worlds}
          />
        </section>
        <section className="mt-9">
          <SectionHeading
            action={
              <Link
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                href="/media"
              >
                {t("studio.section.assets.open")}
                <ArrowRight className="size-3.5" />
              </Link>
            }
            description={t("studio.section.assets.desc")}
            title={t("studio.section.assets")}
          />
          <RecentAssets apiBase={apiBase} />
        </section>
      </div>
      {scenario && (
        <StudioScenarioDialog
          apiBase={apiBase}
          onClose={() => setScenario(null)}
          onSubmit={(text) => {
            onCompose(text);
            setScenario(null);
          }}
          scenario={scenario}
        />
      )}
    </>
  );
}

function ProjectCard({
  apiBase,
  app,
  onDeleteProject,
  onRenameProject,
  project,
}: {
  apiBase?: string;
  app?: Installation;
  onDeleteProject: (project: Project) => Promise<void>;
  onRenameProject: (project: Project, name: string) => Promise<void>;
  project: Project;
}) {
  const { t } = useI18n();
  const appName = app?.manifest.name ?? project.appId;
  return (
    <div className="group relative">
      <Link className="block" href={`/projects/${project.id}`}>
        <Card className="overflow-hidden transition group-hover:-translate-y-0.5 group-hover:border-foreground/20 group-hover:shadow-[var(--shadow-overlay)]">
          <ProjectCoverPreview apiBase={apiBase} app={app} project={project} />
          <CardContent className="p-3">
            <p className="truncate text-sm font-semibold">{project.name}</p>
            <p className="mt-1 truncate text-[10px] text-muted-foreground">
              {appName}
            </p>
          </CardContent>
        </Card>
      </Link>
      <div className="absolute right-2 top-2">
        <CardMoreMenu
          itemName={project.name}
          itemType={t("nav.projects")}
          onDelete={() => onDeleteProject(project)}
          onRename={(projectName) => onRenameProject(project, projectName)}
        />
      </div>
    </div>
  );
}

function ProjectCoverPreview({
  apiBase,
  app,
  project,
}: {
  apiBase?: string;
  app?: Installation;
  project: Project;
}) {
  const { t } = useI18n();
  const cover = project.cover;
  if (cover && apiBase) {
    if (cover.source === "file") {
      const src = `${apiBase}/v1/projects/${encodeURIComponent(project.id)}/cover`;
      return (
        <img
          alt={interpolate(t("projects.cover.alt"), { name: project.name })}
          className="aspect-[16/7] w-full border-b object-cover"
          src={src}
        />
      );
    }
    const src = cover.assetId
      ? `${apiBase}/v1/media/assets/${encodeURIComponent(cover.assetId)}/content`
      : null;
    if (src && cover.kind === "video")
      return (
        <VideoFrame
          alt={interpolate(t("projects.cover.alt"), { name: project.name })}
          className="aspect-[16/7] border-b"
          src={src}
        />
      );
    if (src)
      return (
        <img
          alt={interpolate(t("projects.cover.alt"), { name: project.name })}
          className="aspect-[16/7] w-full border-b object-cover"
          src={src}
        />
      );
    const Icon = app ? appIcon(app.manifest.id) : AppWindow;
    return (
      <div className="flex aspect-[16/7] items-center justify-between border-b bg-muted p-3">
        <span className="grid size-7 place-items-center rounded-sm bg-card text-muted-foreground shadow-sm">
          <Icon className="size-3.5" />
        </span>
        <span className="rounded-xs border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {app?.manifest.name ?? project.appId}
        </span>
      </div>
    );
  }
  const Icon = app ? appIcon(app.manifest.id) : AppWindow;
  return (
    <div className="flex aspect-[16/7] items-center justify-between border-b bg-muted p-3">
      <span className="grid size-7 place-items-center rounded-sm bg-card text-muted-foreground shadow-sm">
        <Icon className="size-3.5" />
      </span>
      <span className="rounded-xs border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {app?.manifest.name ?? project.appId}
      </span>
    </div>
  );
}

function ProjectsPage({
  apiBase,
  apps,
  onCreateWorld,
  onDeleteProject,
  onRenameProject,
  onStartProject,
  projects,
  worlds,
}: {
  apiBase: string;
  apps: Installation[];
  onCreateWorld: () => void;
  onDeleteProject: (project: Project) => Promise<void>;
  onRenameProject: (project: Project, name: string) => Promise<void>;
  onStartProject: (app: Installation) => void;
  projects: Project[];
  worlds: WorldSummary[];
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<ProjectFilter>("all");
  // 过滤 tab 与「新建项目」入口的类型一一对应：全部 / 世界 / 每个已安装的项目型 App。
  const tabs: { icon?: LucideIcon; id: ProjectFilter; label: string }[] = [
    { id: "all", label: t("projects.filter.all") },
    { icon: Globe2, id: "world", label: t("projects.filter.world") },
    ...sortByOrder(apps, PROJECT_APP_ORDER).map((app) => ({
      icon: appIcon(app.manifest.id),
      id: app.manifest.id,
      label: app.manifest.name,
    })),
  ];
  return (
    <>
      <WorkspacePageHeader
        action={
          <Badge className="border bg-muted text-muted-foreground">
            {interpolate(t("projects.count"), {
              count: countSpaces(projects, worlds, filter),
            })}
          </Badge>
        }
        description={t("projects.desc")}
        title={t("projects.title")}
      />
      <FilterTabs items={tabs} onChange={setFilter} value={filter} />
      <ProjectSpaces
        apiBase={apiBase}
        apps={apps}
        filter={filter}
        onCreateWorld={onCreateWorld}
        onDeleteProject={onDeleteProject}
        onRenameProject={onRenameProject}
        onStartProject={onStartProject}
        projects={projects}
        worlds={worlds}
      />
    </>
  );
}

function RecentAssets({ apiBase }: { apiBase: string }) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [preview, setPreview] = useState<Asset | null>(null);
  useEffect(() => {
    let active = true;
    void fetchRecutJSON<Asset[]>(apiBase, "/v1/media/assets")
      .then((items) => {
        if (active) {
          setAssets(items.slice(0, 5));
          setState("ready");
        }
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [apiBase]);
  async function renameAsset(asset: Asset, name: string) {
    const updated = await fetchRecutJSON<Asset>(
      apiBase,
      `/v1/media/assets/${encodeURIComponent(asset.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    setAssets((items) =>
      items.map((item) => (item.id === asset.id ? updated : item)),
    );
  }
  async function deleteAsset(asset: Asset) {
    await fetchRecutJSON(
      apiBase,
      `/v1/media/assets/${encodeURIComponent(asset.id)}`,
      { method: "DELETE" },
    );
    setAssets((items) => items.filter((item) => item.id !== asset.id));
    if (preview?.id === asset.id) setPreview(null);
  }
  if (state === "loading")
    return (
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            className="aspect-square animate-pulse rounded-sm bg-muted"
            key={index}
          />
        ))}
      </div>
    );
  if (state === "error" || !assets.length)
    return (
      <HomeEmptyState
        description={t("assets.recent.desc")}
        icon={Box}
        title={t("assets.recent.title")}
      />
    );
  return (
    <>
      {preview && (
        <AssetPreviewDialog
          apiBase={apiBase}
          asset={preview}
          assets={assets}
          onClose={() => setPreview(null)}
        />
      )}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {assets.map((asset) => (
          <div className="group relative min-w-0" key={asset.id}>
            <button
              aria-label={interpolate(t("assets.preview.aria"), {
                name: asset.name,
              })}
              className="block w-full text-left"
              onClick={() => setPreview(asset)}
              type="button"
            >
              <Card className="overflow-hidden transition group-hover:-translate-y-0.5 group-hover:border-foreground/20">
                <AssetPreview apiBase={apiBase} asset={asset} />
                <CardContent className="p-2.5">
                  <p className="truncate text-xs font-medium">{asset.name}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {asset.kind === "image"
                      ? t("assets.kind.image")
                      : asset.kind === "video"
                        ? t("assets.kind.video")
                        : asset.kind === "transcript"
                          ? t("assets.kind.transcript")
                          : asset.kind === "document"
                            ? t("assets.kind.reference")
                            : t("assets.kind.audio")}
                  </p>
                </CardContent>
              </Card>
            </button>
            <div className="absolute right-2 top-2">
              <CardMoreMenu
                itemName={asset.name}
                itemType={t("page.assets.title")}
                onDelete={() => deleteAsset(asset)}
                onRename={(name) => renameAsset(asset, name)}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function AssetPreview({ apiBase, asset }: { apiBase: string; asset: Asset }) {
  const source = `${apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}/content`;
  const icon =
    asset.kind === "audio" ? (
      <Music2 className="size-5" />
    ) : asset.kind === "video" ? (
      <Video className="size-5" />
    ) : asset.kind === "transcript" ? (
      <Captions className="size-5" />
    ) : asset.kind === "document" ? (
      <Link2 className="size-5" />
    ) : (
      <FileImage className="size-5" />
    );
  if (asset.status !== "completed")
    return (
      <div className="grid aspect-square place-items-center bg-muted text-muted-foreground">
        {icon}
      </div>
    );
  if (asset.kind === "video")
    return (
      <VideoFrame alt={asset.name} className="aspect-square" src={source} />
    );
  if (asset.kind === "image")
    return (
      <img
        alt={asset.name}
        className="aspect-square w-full object-cover"
        src={source}
      />
    );
  return (
    <div className="grid aspect-square place-items-center bg-muted text-muted-foreground">
      {icon}
    </div>
  );
}

function SectionHeading({
  action,
  description,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function HomeEmptyState({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon?: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex min-h-24 items-center justify-between gap-5 border-y border-border/80 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-muted">
            <Icon className="size-4 text-muted-foreground" />
          </span>
        )}
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

function CreateProjectFromAppDialog({
  app,
  onClose,
  onCreate,
}: {
  app: Installation;
  onClose: () => void;
  onCreate: (projectName: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectName.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      await onCreate(projectName.trim());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("projects.create.failed"),
      );
      setCreating(false);
    }
  }
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="dialog"
      aria-labelledby="create-project-app-title"
    >
      <section
        className="w-full max-w-md rounded-sm border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-muted-foreground">
              NEW PROJECT
            </p>
            <h2
              className="mt-1 text-base font-semibold"
              id="create-project-app-title"
            >
              {interpolate(t("projects.create.title"), {
                name: app.manifest.name,
              })}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("projects.create.desc")}
            </p>
          </div>
          <button
            aria-label={t("projects.create.close")}
            className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="p-5">
            <label
              className="mb-1 block text-[11px] font-medium"
              htmlFor="create-project-app-name"
            >
              {t("projects.create.name")}
            </label>
            <Input
              autoFocus
              className="h-9 bg-background text-xs"
              id="create-project-app-name"
              onChange={(event) => setProjectName(event.target.value)}
              placeholder={t("projects.create.name.placeholder")}
              value={projectName}
            />
            {error && <p className="mt-2 text-xs text-warning">{error}</p>}
          </div>
          <footer className="flex items-center justify-end gap-2 border-t px-5 py-3">
            <Button onClick={onClose} type="button" variant="ghost">
              {t("projects.create.cancel")}
            </Button>
            <Button disabled={!projectName.trim() || creating} type="submit">
              {creating
                ? t("projects.create.submitting")
                : t("projects.create.submit")}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
