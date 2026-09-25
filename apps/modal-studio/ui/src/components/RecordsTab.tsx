/**
 * [INPUT]: 依赖统一任务账本（modal.tasks.list）与选中回调
 * [OUTPUT]: 部署/下载/运行统一任务列表（只读历史，配置动作归「功能」Tab）
 * [POS]: Left「记录」Tab；任务历史的唯一展示面
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { t, type Locale } from "../i18n";
import { Badge, Card } from "../ui";
import { formatCompactTime } from "../lib/format";
import type { Task } from "../types";

interface Props {
  tasks: Task[];
  locale: Locale;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const TONE: Record<string, "success" | "destructive" | "warning" | "muted"> = {
  completed: "success",
  failed: "destructive",
  cancelled: "destructive",
  queued: "warning",
  running: "warning",
};

export function RecordsTab({ tasks, locale, selectedId, onSelect }: Props) {
  if (tasks.length === 0) {
    return <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground">{t(locale, "records.empty")}</div>;
  }
  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <Card
          key={task.id}
          className={`cursor-pointer p-3 transition ${selectedId === task.id ? "border-primary/60" : "hover:bg-muted/40"}`}
          onClick={() => onSelect(task.id)}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{task.name || task.action}</span>
            <Badge tone={TONE[task.state] ?? "muted"}>{t(locale, `state.${task.state}`)}</Badge>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span>{task.source === "ai" ? "AI" : "MANUAL"} · {t(locale, "records.started")} {formatCompactTime(task.startedAt || task.createdAt)}</span>
            <span className="font-mono">{task.id}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}
