/*
 * [INPUT]: 依赖 community-sections 注册表、AppsSection、PlatformWorldsSection（含 usePlatformWorlds）、world-card、云端市场数据与工作台 i18n 字典
 * [OUTPUT]: 对外提供社区容器 Community：按 section 渲染首页概览 / 应用分区 / 世界分区，并统一渲染可扩展的分区子导航
 * [POS]: web/components/community 的编排层；社区是公共内容面（PGC Worlds + Apps 目录），用户资产仍归工作台，不在此出现
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { WorldCard } from "@/components/world-card";
import {
  COMMUNITY_SECTIONS,
  communitySection,
  type CommunitySectionId,
} from "@/lib/community-sections";
import type { MarketplaceApp } from "@/lib/appstore";
import { useI18n } from "@/lib/i18n/index";
import type { WorkspaceInstallation as Installation } from "@/lib/workspace-store";

import {
  AppsSection,
  MarketplaceAppCard,
  type InstallationLoadState,
} from "./apps-section";
import { PlatformWorldsSection, usePlatformWorlds } from "./worlds-section";

export type CommunityView = "home" | CommunitySectionId;

export function Community({
  section,
  apiBase,
  installations,
  installationError,
  installationLoadState,
  marketplace,
  onStartProject,
  onUpdated,
  serviceOnline,
}: {
  section: CommunityView;
  apiBase: string;
  installations: Installation[];
  installationError: string;
  installationLoadState: InstallationLoadState;
  marketplace: MarketplaceApp[];
  onStartProject: (app: Installation) => void;
  onUpdated: () => Promise<void>;
  serviceOnline: boolean;
}) {
  return (
    <>
      <CommunityNav section={section} />
      {section === "apps" ? (
        <AppsSection
          apiBase={apiBase}
          installationError={installationError}
          installationLoadState={installationLoadState}
          installations={installations}
          marketplace={marketplace}
          onStartProject={onStartProject}
          onUpdated={onUpdated}
          serviceOnline={serviceOnline}
        />
      ) : section === "worlds" ? (
        <PlatformWorldsSection />
      ) : (
        <CommunityHome
          installations={installations}
          marketplace={marketplace}
        />
      )}
    </>
  );
}

function CommunityNav({ section }: { section: CommunityView }) {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t("community.nav.aria")}
      className="mb-7 flex flex-wrap items-center gap-1.5 border-border/70 pb-3"
    >
      <CommunityNavLink active={section === "home"} href="/community">
        {t("community.nav.all")}
      </CommunityNavLink>
      {COMMUNITY_SECTIONS.map((item) => {
        const Icon = item.icon;
        return (
          <CommunityNavLink
            active={section === item.id}
            href={item.href}
            key={item.id}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {t(item.titleKey)}
          </CommunityNavLink>
        );
      })}
    </nav>
  );
}

function CommunityNavLink({
  active,
  children,
  href,
}: {
  active: boolean;
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground"
          : "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      }
      href={href}
    >
      {children}
    </Link>
  );
}

function CommunityHome({
  installations,
  marketplace,
}: {
  installations: Installation[];
  marketplace: MarketplaceApp[];
}) {
  const { t } = useI18n();
  const { apiBase, worlds, state } = usePlatformWorlds();
  return (
    <div className="pb-10">
      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-accent/70 via-card to-card px-6 py-9 sm:px-9 sm:py-11">
        <p className="flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-muted-foreground/60" />
          COMMUNITY
        </p>
        <h1 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          {t("community.title")}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          {t("community.desc")}
        </p>
      </section>

      <section className="mt-9">
        <CommunitySectionHeading sectionId="worlds" />
        {state === "loading" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                className="h-56 animate-pulse rounded-lg border bg-card"
                key={index}
              />
            ))}
          </div>
        ) : worlds.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {worlds.slice(0, 4).map((world) => (
              <WorldCard apiBase={apiBase} key={world.id} world={world} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("community.worlds.empty.desc")}
          </p>
        )}
      </section>

      <section className="mt-10">
        <CommunitySectionHeading sectionId="apps" />
        {marketplace.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {marketplace.slice(0, 4).map((app) => (
              <MarketplaceAppCard
                app={app}
                installed={installations.some(
                  (item) => item.manifest.id === app.appId,
                )}
                key={app.appId}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("apps.addable.desc")}</p>
        )}
      </section>
    </div>
  );
}

function CommunitySectionHeading({
  sectionId,
}: {
  sectionId: CommunitySectionId;
}) {
  const { t } = useI18n();
  const { href, titleKey, descKey } = communitySection(sectionId);
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold">{t(titleKey)}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t(descKey)}</p>
      </div>
      <Link
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        href={href}
      >
        {t("community.section.viewAll")}
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}
