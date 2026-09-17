import { Button } from "@timeline/components/ui/button";
import { t, useRecutLocale } from "@timeline/i18n";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@timeline/components/ui/dialog";
import { Input } from "@timeline/components/ui/input";
import { useState } from "react";
import { Label } from "@timeline/components/ui/label";

export function RenameProjectDialog({
	isOpen,
	onOpenChange,
	onConfirm,
	projectName,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (newName: string) => void;
	projectName: string;
}) {
	const locale = useRecutLocale();
	const [name, setName] = useState(projectName);

	const handleOpenChange = (open: boolean) => {
		if (open) {
			setName(projectName);
		}
		onOpenChange(open);
	};

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t(locale, "project.renameTitle")}</DialogTitle>
				</DialogHeader>

				<DialogBody className="gap-3">
					<Label>{t(locale, "project.newName")}</Label>
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								onConfirm(name);
							}
						}}
						placeholder={t(locale, "project.enterName")}
					/>
				</DialogBody>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							onOpenChange(false);
						}}
					>
						{t(locale, "common.cancel")}
					</Button>
					<Button onClick={() => onConfirm(name)}>{t(locale, "common.rename")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
