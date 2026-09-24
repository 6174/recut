/**
 * [INPUT]: 依赖 Date 与本地时区
 * [OUTPUT]: 对外提供任务计时格式化：HH:MM:SS 时刻、YYYY-MM-DD HH:MM:SS 时间戳、人性化总时长
 * [POS]: ui/src 的展示格式边界；组件不各自拼时间字符串
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
const pad = (value: number) => String(value).padStart(2, "0");

function toDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatClock(iso?: string | null): string {
  const date = toDate(iso);
  if (!date) return "—";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatCompactTime(iso?: string | null): string {
  const date = toDate(iso);
  if (!date) return "—";
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return formatClock(iso);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDateTime(iso?: string | null): string {
  const date = toDate(iso);
  if (!date) return "—";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock(iso)}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return `${minutes}m ${pad(rest)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${pad(minutes % 60)}m ${pad(rest)}s`;
}
