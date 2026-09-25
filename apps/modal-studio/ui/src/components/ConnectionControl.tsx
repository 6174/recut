/**
 * [INPUT]: 依赖 Modal 连接状态（modal.status）与共享视觉原子、i18n
 * [OUTPUT]: 顶栏右侧的 Modal 账号连接状态；点击打开「账号与密钥」面板
 * [POS]: App 头部的账号入口；只负责展示与触发，状态由 App 刷新
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Cloud, Settings2 } from "lucide-react";
import { t, type Locale } from "../i18n";

interface Props {
  locale: Locale;
  connected: boolean;
  account?: string;
  profileName?: string;
  onOpen: () => void;
}

export function ConnectionControl({ locale, connected, account, profileName, onOpen }: Props) {
  const dot = connected ? "bg-success" : "bg-muted-foreground";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={t(locale, "connection.manage")}
      className="flex shrink-0 items-center gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-2 text-left transition hover:bg-muted/40"
    >
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      <Cloud className="size-4 text-muted-foreground" />
      <div className="min-w-0 leading-tight">
        <div className="text-xs font-semibold text-foreground">{t(locale, "connection.name")}</div>
        <div className="text-[10px] text-muted-foreground">
          {connected ? t(locale, "connection.connected") : t(locale, "connection.disconnected")}
          {account || profileName ? ` · ${account || profileName}` : ""}
        </div>
      </div>
      <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}
