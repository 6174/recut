/*
 * [INPUT]: 依赖 React 时钟与 Asset/Job 的创建时间、异步状态和 generation metadata
 * [OUTPUT]: 对外提供 GenerationDuration 实时/终态耗时展示与可复用的时长格式化能力
 * [POS]: components 的生成计时原子；素材库、Agent 消息和素材详情共享，不发起媒体状态请求
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useMemo, useState } from "react";

type TimingMetadata = {
  generationStartedAt?: unknown;
  generationDurationMs?: unknown;
};

export type GenerationTiming = {
  createdAt?: string;
  metadata?: TimingMetadata;
  status?: string;
};

function milliseconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function formatGenerationDuration(value: number) {
  const seconds = Math.max(0, Math.floor(value / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const twoDigits = (part: number) => String(part).padStart(2, "0");
  return hours > 0
    ? `${hours}:${twoDigits(minutes)}:${twoDigits(remainingSeconds)}`
    : `${twoDigits(minutes)}:${twoDigits(remainingSeconds)}`;
}

function isGenerating(status?: string) {
  return status === "queued" || status === "running";
}

export function generationDuration(item: GenerationTiming, now = Date.now()) {
  if (isGenerating(item.status)) {
    const startedAt = timestamp(item.metadata?.generationStartedAt) ?? timestamp(item.createdAt);
    return startedAt === undefined ? undefined : Math.max(0, now - startedAt);
  }
  return milliseconds(item.metadata?.generationDurationMs);
}

export function GenerationDuration({ className, item }: { className?: string; item: GenerationTiming }) {
  const [now, setNow] = useState(() => Date.now());
  const active = isGenerating(item.status);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const duration = useMemo(() => generationDuration(item, now), [item, now]);
  if (duration === undefined) return null;
  return <span className={className}>{active ? "已用时 " : "生成耗时 "}{formatGenerationDuration(duration)}</span>;
}
