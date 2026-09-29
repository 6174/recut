/**
 * [INPUT]: 依赖 radix-ui Label 与 @/lib/utils
 * [OUTPUT]: 对外提供表单标签原子 Label
 * [POS]: components/ui 的表单标签原子；连接输入控件与可访问名称
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-xs/relaxed leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
