/*
 * [INPUT]: 依赖 workspace-store 的已安装 App 快照、统一 App 身份图标、Radix Popover 与工作台 i18n 字典
 * [OUTPUT]: 对外提供 Header 右侧的启动器入口：统一的两栏「图标在左、文案在右」列表，首位「素材库」、随后已安装 App、末位「添加应用」，点击均在新标签页按类型打开
 * [POS]: web/components 的全局快捷入口原子；供 HeaderActions 挂在设置图标左侧复用，素材库/应用中心分别复用既有 /media、/community/apps 路由
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { LayoutGrid, Library, Plus, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { appIcon } from "@/components/app-identity-icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n";
import { useWorkspaceStore, type WorkspaceInstallation } from "@/lib/workspace-store";

function appOpenHref(app: WorkspaceInstallation) {
  const id = encodeURIComponent(app.manifest.id);
  return app.manifest.type === "standalone" ? `/workspace-app/app?id=${id}` : `/apps/${id}`;
}

function MenuTile({ href, icon: Icon, label, onSelect }: { href: string; icon: LucideIcon; label: string; onSelect: () => void }) {
  return (
    <a className="flex min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-muted" href={href} onClick={onSelect} rel="noopener noreferrer" target="_blank" title={label}>
      <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-4" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-xs text-foreground">{label}</span>
    </a>
  );
}

export function InstalledAppsMenu() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const installations = useWorkspaceStore((state) => state.installations);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={t("apps.menu.title")}
          className="grid size-8 place-items-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t("apps.menu.title")}
          type="button"
        >
          <LayoutGrid className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3 font-sans">
        <p className="text-xs font-semibold text-foreground">{t("apps.menu.title")}</p>
        {installations.length ? null : (
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{t("apps.menu.empty")}</p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-1">
          <MenuTile
            href="/media"
            icon={Library}
            label={t("nav.assets")}
            onSelect={() => setOpen(false)}
          />
          {installations.map((app) => (
            <MenuTile
              href={appOpenHref(app)}
              icon={appIcon(app.manifest.id)}
              key={app.package}
              label={app.manifest.name}
              onSelect={() => setOpen(false)}
            />
          ))}
          <MenuTile
            href="/community/apps"
            icon={Plus}
            label={t("apps.menu.add")}
            onSelect={() => setOpen(false)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
