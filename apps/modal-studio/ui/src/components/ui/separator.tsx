/**
 * [INPUT]: 依赖 radix-ui Separator 与 @/lib/utils
 * [OUTPUT]: 对外提供内容分隔原子 Separator（横向/纵向）
 * [POS]: components/ui 的分隔原子；保持面板内部层级
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
