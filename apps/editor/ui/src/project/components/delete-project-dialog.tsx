import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { t, useRecutLocale } from "@/i18n";

export function DeleteProjectDialog({
	isOpen,
	onOpenChange,
	onConfirm,
	projectNames,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	projectNames: string[];
}) {
	const locale = useRecutLocale();
	const count = projectNames.length;
	const isSingle = count === 1;
	const singleName = isSingle ? projectNames[0] : null;

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					event.stopPropagation();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{singleName ? (
							<>
								{t(locale, "project.deletePrefix")}
								<span className="inline-block max-w-[300px] truncate align-bottom">
									{singleName}
								</span>
								{t(locale, "project.deleteSuffix")}
							</>
						) : (
							t(locale, "project.deleteCount", { count })
						)}
					</DialogTitle>
				</DialogHeader>
				<DialogBody>
					<Alert variant="destructive">
						<AlertTitle>{t(locale, "project.warning")}</AlertTitle>
						<AlertDescription>
							{t(locale, "project.willDelete")}{" "}
							{singleName ? `"${singleName}"` : `${count} projects`}{" "}
							{t(locale, "project.andFiles")}
						</AlertDescription>
					</Alert>
					<div className="flex flex-col gap-3">
						<Label className="text-xs font-semibold text-muted-foreground">
							{t(locale, "project.typeToConfirm")}
						</Label>
						<Input
							type="text"
							placeholder="DELETE"
							size="lg"
							variant="destructive"
						/>
					</div>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t(locale, "common.cancel")}
					</Button>
					<Button variant="destructive" onClick={onConfirm}>
						{t(locale, "project.deleteTitle")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
