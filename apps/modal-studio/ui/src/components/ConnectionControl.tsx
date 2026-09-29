/**
 * [INPUT]: 依赖 Modal 连接状态（modal.status）、shadcn Button、lucide 图标与 i18n
 * [OUTPUT]: 顶栏右侧的 Modal 账号连接状态；点击打开「账号与密钥」面板
 * [POS]: App 头部的账号入口；只负责展示与触发，状态由 App 刷新
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Cloud, Settings2 } from "lucide-react";
import { t, type Locale } from "../i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  locale: Locale;
  connected: boolean;
  loading?: boolean;
  account?: string;
  profileName?: string;
  onOpen: () => void;
}

export function ConnectionControl({ locale, connected, loading, account, profileName, onOpen }: Props) {
  const dot = loading ? "bg-primary animate-pulse" : connected ? "bg-success" : "bg-muted-foreground";
  const status = loading ? t(locale, "connection.connecting") : connected ? t(locale, "connection.connected") : t(locale, "connection.disconnected");
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onOpen}
      title={t(locale, "connection.manage")}
      className="h-auto w-auto shrink-0 gap-2.5 px-3 py-2"
    >
      <span className={cn("size-2 shrink-0 rounded-full", dot)} />
      <Cloud className="size-4 text-muted-foreground" />
      <span className="grid min-w-0 text-left leading-tight">
        <span className="text-xs font-semibold text-foreground">{t(locale, "connection.name")}</span>
        <span className="text-[10px] font-normal text-muted-foreground">
          {status}
          {!loading && (account || profileName) ? ` · ${account || profileName}` : ""}
        </span>
      </span>
      <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />
    </Button>
  );
}
