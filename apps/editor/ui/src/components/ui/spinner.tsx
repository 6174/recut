import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/utils/ui";
import { t, useRecutLocale } from "@/i18n";

function Spinner({ className, ...props }: Omit<HugeiconsIconProps, "icon">) {
	const locale = useRecutLocale();
	return (
		<HugeiconsIcon
			icon={Loading03Icon}
			role="status"
			aria-label={t(locale, "ui.loading")}
			className={cn("size-4 animate-spin", className)}
			{...props}
		/>
	);
}

export { Spinner };
