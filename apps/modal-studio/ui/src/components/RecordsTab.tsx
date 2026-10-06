/**
 * [INPUT]: 依赖统一任务账本（modal.tasks.list）、shadcn Badge/Card/Button 与选中/删除回调
 * [OUTPUT]: 部署/下载/运行统一任务列表（只读历史 + 逐条删除；配置动作归「功能」Tab）
 * [POS]: Left「记录」Tab；任务历史的唯一展示面
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Trash2 } from "lucide-react";
import { t, type Locale } from "../i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCompactTime } from "../lib/format";
import type { Task } from "../types";

interface Props {
  tasks: Task[];
  locale: Locale;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

const TONE: Record<string, string> = {
  completed: "border-success/40 text-success",
  failed: "border-destructive/40 text-destructive",
  cancelled: "border-destructive/40 text-destructive",
  queued: "border-warning/40 text-warning",
  running: "border-warning/40 text-warning",
};

export function RecordsTab({ tasks, locale, selectedId, onSelect, onRemove }: Props) {
  if (tasks.length === 0) {
    return <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground">{t(locale, "records.empty")}</div>;
  }
  const remove = (task: Task) => {
    if (!window.confirm(t(locale, "records.remove-confirm"))) return;
    onRemove(task.id);
  };
  return (
    <div className="grid gap-2">
      {tasks.map((task) => {
        const active = task.state === "queued" || task.state === "running";
        return (
          <Card
            key={task.id}
            size="sm"
            className={`cursor-pointer p-3 [--card-spacing:0px] transition ${selectedId === task.id ? "border-primary/60" : "hover:bg-muted/40"}`}
            onClick={() => onSelect(task.id)}
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{task.name || task.action}</span>
              <Badge variant="outline" className={TONE[task.state] ?? "text-muted-foreground"}>{t(locale, `state.${task.state}`)}</Badge>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                disabled={active}
                title={t(locale, "records.remove")}
                aria-label={t(locale, "records.remove")}
                onClick={(event) => { event.stopPropagation(); remove(task); }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span>{task.source === "ai" ? "AI" : "MANUAL"} · {t(locale, "records.started")} {formatCompactTime(task.startedAt || task.createdAt)}</span>
              <span className="font-mono">{task.id}</span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
