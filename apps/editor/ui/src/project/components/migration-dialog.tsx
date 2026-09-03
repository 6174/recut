"use client";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useEditor } from "@/editor/use-editor";
import { t, useRecutLocale } from "@/i18n";
import { Loader2 } from "lucide-react";

export function MigrationDialog() {
	const locale = useRecutLocale();
	const editor = useEditor();
	const migrationState = editor.project.getMigrationState();

	if (!migrationState.isMigrating) return null;

	const title = migrationState.projectName
		? t(locale, "project.updating")
		: t(locale, "project.updatingMany");
	const description = migrationState.projectName
		? t(locale, "project.upgrading", {
				name: migrationState.projectName,
				from: migrationState.fromVersion,
				to: migrationState.toVersion,
			})
		: t(locale, "project.upgradingMany", {
				from: migrationState.fromVersion,
				to: migrationState.toVersion,
			});

	return (
		<Dialog open={true}>
			<DialogContent
				className="sm:max-w-md"
				onPointerDownOutside={(event) => event.preventDefault()}
				onEscapeKeyDown={(event) => event.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				<div className="flex items-center justify-center py-4">
					<Loader2 className="text-muted-foreground size-8 animate-spin" />
				</div>
			</DialogContent>
		</Dialog>
	);
}
