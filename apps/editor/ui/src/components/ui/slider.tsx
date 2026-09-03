/**
 * [INPUT]: 依赖 Radix Slider primitive 与通用 UI 样式工具。
 * [OUTPUT]: 对外提供单值或多值范围滑杆 Slider。
 * [POS]: components/ui 的连续范围选择基础控件，由属性面板和时间线工具栏消费。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "@/utils/ui";

const Slider = React.forwardRef<
	React.ElementRef<typeof SliderPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
		className?: string;
	}
>(({ className, ...props }, ref) => (
	<SliderPrimitive.Root
		ref={ref}
		className={cn(
			"relative flex w-full touch-none items-center select-none",
			className,
		)}
		{...props}
	>
		<SliderPrimitive.Track className="bg-accent relative h-1.5 w-full grow overflow-hidden rounded-full">
			<SliderPrimitive.Range className="bg-primary absolute h-full" />
		</SliderPrimitive.Track>
		<SliderPrimitive.Thumb className="border-primary/50 bg-background focus-visible:ring-ring block size-4 rounded-full border shadow-sm focus-visible:ring-1 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50" />
	</SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
