/*
 * [INPUT]: 依赖 React 状态、浏览器剪贴板与公开的 app-standard.md 架构/API 规范、工作台 i18n 字典
 * [OUTPUT]: 对外提供新建 App 弹窗、可复制的 AI 创建 Prompt 与完整规范入口
 * [POS]: web/components 的 App 创作引导原子；只交付确定的创建任务，不直接修改用户应用目录
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Copy, ExternalLink, Plus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/index";

// TODO(i18n): creationPrompt 正文为交付给 AI 的创作指令（内容面），本期保留中文，后续按 locale 拆两组。
function creationPrompt() {
  const standardURL = `${window.location.origin}/app-standard.md`;
  return `请为 Recut 创建一个新的项目型 App。先完整阅读应用标准（尤其是产品架构和核心 Recut API）：${standardURL}

目标：在 ~/.recut/apps/<package-name>/ 直接创建完整、可运行的 App 包；<package-name> 使用 kebab-case，并根据 App 的用途选择一个清晰的名字。

要求：
1. 先提出一个简短的 App 名称、id、用途和 operation 计划；确认没有冲突后再写文件。
2. 严格遵守应用标准中的产品位置、manifest、background.js、UI SDK、ctx 权限和 operation 契约；不要直接 fetch service、访问 SQLite 或猜测不存在的 recut API。
3. 不要修改 Recut 平台源码、其他 App、项目数据或 service 配置。
4. 创建后验证 manifest.json、所有入口文件和 UI 路径；重启 Recut service，再确认新 App 出现在 Apps 目录与新建项目的 App 选择器中。
5. 最后报告创建的目录、manifest 身份、公开 operations、验证结果，以及还需要我决定的事项。

我想创建的 App 是：<请在这里描述功能、用户、输入和期望输出>。`;
}

export function CreateAppDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const prompt = open ? creationPrompt() : "";

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch { setCopied(false); }
  }

  return <><Button onClick={() => setOpen(true)} type="button"><Plus className="size-4" />{t("createapp.button")}</Button>{open && <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={() => setOpen(false)} role="dialog" aria-labelledby="create-app-title"><section className="w-full max-w-2xl rounded-sm border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-start justify-between gap-4 border-b px-5 py-4"><div><p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">CREATE APP</p><h2 className="mt-1 text-base font-semibold" id="create-app-title">{t("createapp.title")}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("createapp.desc")}</p></div><button aria-label={t("createapp.close")} className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={() => setOpen(false)} type="button"><X className="size-4" /></button></header><div className="p-5"><label className="mb-2 block text-xs font-medium" htmlFor="create-app-prompt">{t("createapp.prompt.label")}</label><textarea className="h-72 w-full resize-none rounded-sm border bg-muted/30 p-3 font-mono text-xs leading-5 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30" id="create-app-prompt" readOnly value={prompt} /><a className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:underline" href="/app-standard.md" rel="noreferrer" target="_blank">{t("createapp.standard")}<ExternalLink className="size-3.5" /></a></div><footer className="flex items-center justify-end gap-2 border-t px-5 py-3"><Button onClick={() => setOpen(false)} type="button" variant="ghost">{t("createapp.cancel")}</Button><Button onClick={() => void copyPrompt()} type="button"><Copy className="size-4" />{copied ? t("createapp.copied") : t("createapp.copy")}</Button></footer></section></div>}</>;
}
