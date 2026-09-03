"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useStoragePersistence } from "@/services/storage/use-storage-persistence";
import { t, useRecutLocale } from "@/i18n";

export function StoragePersistenceDialog() {
	const locale = useRecutLocale();
	const { showDialog, onConfirm, onDismiss } = useStoragePersistence();

	return (
		<Dialog open={showDialog} onOpenChange={(open) => !open && onDismiss()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t(locale, "storage.dontLose")}</DialogTitle>
				</DialogHeader>
				<DialogBody>
					<p className="text-base text-muted-foreground">
						{t(locale, "storage.desc")}
					</p>
					<p className="text-base text-muted-foreground">
						{t(locale, "storage.protect")}
					</p>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={onDismiss}>
						{t(locale, "storage.notNow")}
					</Button>
					<Button onClick={onConfirm}>{t(locale, "storage.allow")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
