/*
 * [INPUT]: 依赖 EditorAppFull（app-demo/editor）与 Locale；维护 homepage hero 的等比缩放舞台包装
 * [OUTPUT]: 对外保留 MarketingEditorDemo 作为 homepage hero 的入口；内部直接复用 AppDemo 体系的 editor 整体 UI 演示，避免与 app-demo 重复实现
 * [POS]: web/components 官网 Hero 的产品演示层；不连接 service、不读取用户项目，只呈现可交互的产品心智模型
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import type { Locale } from "@/lib/i18n";
import { EditorAppFull } from "@/components/app-demo/app-demo-editor";

export function MarketingEditorDemo({ locale }: { locale: Locale }) {
  return (
    <div className="mx-auto mt-14 max-w-6xl sm:mt-20">
      <div className="marketing-editor-demo-stage">
        <EditorAppFull locale={locale} animated />
      </div>
    </div>
  );
}
