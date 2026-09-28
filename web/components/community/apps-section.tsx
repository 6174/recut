/*
 * [INPUT]: 依赖 workspace-store 的安装类型、云端市场数据（lib/appstore）、统一 App 身份图标与版本控件、创建/安装来源对话框与工作台 i18n 字典
 * [OUTPUT]: 对外提供社区 Apps 分区：已安装能力与可添加目录两个 section、加载/离线/失败/空态，以及可复用的 MarketplaceAppCard
 * [POS]: web/components/community 的 Apps 分区；由社区容器与社区首页消费，不直接读取 service，状态由父层注入
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AppWindow, ArrowRight, FolderOpen, FolderPlus, LoaderCircle } from "lucide-react";
import Link from "next/link";

import { AppIdentityIcon } from "@/components/app-identity-icon";
import {
  AppUpdateAllControl,
  AppVersionControl,
} from "@/components/app-version-control";
import { CreateAppDialog } from "@/components/create-app-dialog";
import { InstallGitAppDialog } from "@/components/install-git-app-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  marketplaceDescription,
  marketplaceName,
  type MarketplaceApp,
} from "@/lib/appstore";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import type { WorkspaceInstallation as Installation } from "@/lib/workspace-store";

export type InstallationLoadState = "loading" | "ready" | "failed" | "offline";

export function MarketplaceAppCard({
  app,
  installed,
}: {
  app: MarketplaceApp;
  installed: boolean;
}) {
  const { t, locale } = useI18n();
  return (
    <Link
      className="group"
      href={`/apps/${encodeURIComponent(app.appId)}`}
    >
      <Card className="flex min-h-32 min-w-0 flex-col rounded-lg border bg-card p-4 shadow-sm transition-all group-hover:-translate-y-0.5 group-hover:border-foreground/20 group-hover:shadow-[var(--shadow-overlay)]">
        <CardContent className="flex flex-1 flex-col p-0">
          <div className="flex min-w-0 items-start gap-3">
            <AppIdentityIcon
              appID={app.appId}
              className="transition duration-200 group-hover:bg-secondary"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {marketplaceName(app, locale)}
              </p>
              <p className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">
                {marketplaceDescription(app, locale)}
              </p>
            </div>
            <Badge>
              {installed ? t("apps.market.installed") : t("apps.market.market")}
            </Badge>
          </div>
          <span className="mt-auto flex items-center justify-end pt-3 text-muted-foreground group-hover:text-foreground">
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

export function AppsSection({
  apiBase,
  installations,
  installationError,
  installationLoadState,
  marketplace,
  onStartProject,
  onUpdated,
  serviceOnline,
}: {
  apiBase: string;
  installations: Installation[];
  installationError: string;
  installationLoadState: InstallationLoadState;
  marketplace: MarketplaceApp[];
  onStartProject: (app: Installation) => void;
  onUpdated: () => Promise<void>;
  serviceOnline: boolean;
}) {
  const { t } = useI18n();
  const installationCount =
    installationLoadState === "loading"
      ? t("apps.count.loading")
      : installationLoadState === "offline"
        ? t("apps.count.offline")
        : interpolate(t("apps.installed.count"), {
            count: installations.length,
          });
  return (
    <>
      <div className="mb-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("community.section.apps.title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("community.section.apps.desc")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AppUpdateAllControl apps={installations} onUpdated={onUpdated} />
          <CreateAppDialog />
          <InstallGitAppDialog
            apiBase={apiBase}
            disabled={!serviceOnline}
            onInstalled={onUpdated}
          />
        </div>
      </div>
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">{t("apps.installed")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("apps.installed.desc")}
            </p>
          </div>
          <Badge>{installationCount}</Badge>
        </div>
        {installationLoadState === "loading" ? (
          <InstalledAppsLoading />
        ) : installationLoadState === "offline" ? (
          <InstalledAppsOffline />
        ) : installationLoadState === "failed" ? (
          <InstalledAppsError
            message={installationError}
            onRetry={() => void onUpdated()}
          />
        ) : installations.length === 0 ? (
          <Card>
            <CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 text-center">
              <FolderOpen className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">
                {t("apps.installed.empty.title")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("apps.installed.empty.desc")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {installations.map((app) => (
              <InstalledAppCard
                app={app}
                key={app.package}
                onStartProject={onStartProject}
                onUpdated={onUpdated}
              />
            ))}
          </div>
        )}
      </section>
      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">{t("apps.addable")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("apps.addable.desc")}
            </p>
          </div>
          <Badge>
            {interpolate(t("apps.addable.count"), {
              count: marketplace.length,
            })}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {marketplace.map((app) => (
            <MarketplaceAppCard
              app={app}
              installed={installations.some(
                (item) => item.manifest.id === app.appId,
              )}
              key={app.appId}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function InstalledAppsLoading() {
  const { t } = useI18n();
  return (
    <Card>
      <CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 text-center">
        <LoaderCircle
          aria-hidden="true"
          className="size-6 animate-spin text-muted-foreground"
        />
        <p className="text-sm font-medium">
          {t("apps.installed.loading.title")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("apps.installed.loading.desc")}
        </p>
      </CardContent>
    </Card>
  );
}

function InstalledAppsError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 text-center">
        <FolderOpen className="size-6 text-warning" />
        <div>
          <p className="text-sm font-medium">
            {t("apps.installed.error.title")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
        </div>
        <Button onClick={onRetry} type="button" variant="outline">
          {t("apps.installed.error.retry")}
        </Button>
      </CardContent>
    </Card>
  );
}

function InstalledAppsOffline() {
  const { t } = useI18n();
  return (
    <Card>
      <CardContent className="flex min-h-36 flex-col items-center justify-center gap-3 text-center">
        <FolderOpen className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">
          {t("apps.installed.offline.title")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("apps.installed.offline.desc")}
        </p>
      </CardContent>
    </Card>
  );
}

function InstalledAppCard({
  app,
  onStartProject,
  onUpdated,
}: {
  app: Installation;
  onStartProject: (app: Installation) => void;
  onUpdated: () => void;
}) {
  const { t } = useI18n();
  const detailHref = `/apps/${encodeURIComponent(app.manifest.id)}`;
  const status =
    app.dirty && app.updateAvailable
      ? t("apps.status.remoteDirty")
      : app.dirty
        ? t("apps.status.dirty")
        : app.updateAvailable
          ? t("apps.status.remote")
          : (app.status ?? t("apps.status.current"));
  return (
    <Card className="group flex min-h-32 min-w-0 flex-col rounded-lg border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[var(--shadow-overlay)]">
      <CardContent className="flex flex-1 flex-col p-0">
        <Link
          aria-label={interpolate(t("apps.detail.aria"), {
            name: app.manifest.name,
          })}
          className="flex min-w-0 items-start gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href={detailHref}
        >
          <AppIdentityIcon
            appID={app.manifest.id}
            className="transition duration-200 group-hover:bg-secondary"
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {app.manifest.name}
            </span>
            <span className="mt-1 block line-clamp-2 text-xs leading-4 text-muted-foreground">
              {app.manifest.description}
            </span>
          </span>
        </Link>
        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <Link
            className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
            href={detailHref}
          >
            {t("apps.details")}
          </Link>
          <InstalledAppAction app={app} onStartProject={onStartProject} />
        </div>
        <div className="mt-2 flex justify-end" title={status}>
          <AppVersionControl app={app} onUpdated={onUpdated} />
        </div>
      </CardContent>
    </Card>
  );
}

function InstalledAppAction({
  app,
  onStartProject,
}: {
  app: Installation;
  onStartProject: (app: Installation) => void;
}) {
  const { t } = useI18n();
  if (app.manifest.type === "standalone")
    return (
      <Link
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xs border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        href={`/workspace-app/app?id=${encodeURIComponent(app.manifest.id)}`}
      >
        <AppWindow className="size-3.5" />
        {t("apps.open")}
      </Link>
    );
  return (
    <Button
      className="h-8 px-2.5"
      onClick={() => onStartProject(app)}
      type="button"
      variant="outline"
    >
      <FolderPlus className="size-3.5" />
      {t("apps.new")}
    </Button>
  );
}
