import { toast } from "sonner";
import { t, getRecutLocale } from "@/i18n";

export interface MediaUploadToastResult {
	uploadedCount: number;
	assetNames?: string[];
}

function getAssetLabel({ count }: { count: number }): string {
	return count === 1 ? t(getRecutLocale(), "media.asset") : t(getRecutLocale(), "media.assets");
}

function waitForNextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => resolve());
		});
	});
}

export async function showMediaUploadToast<T extends MediaUploadToastResult>({
	filesCount,
	promise,
}: {
	filesCount: number;
	promise: Promise<T> | (() => Promise<T>);
}) {
	const run = typeof promise === "function" ? promise : () => promise;
	const toastPromise = toast.promise(async () => {
		await waitForNextPaint();
		return run();
	}, {
		loading: t(getRecutLocale(), "media.uploading", { label: getAssetLabel({ count: filesCount }) }),
		success: ({ uploadedCount, assetNames }) => {
			if (uploadedCount === 1) {
				const assetName = assetNames?.[0];
				return assetName
					? t(getRecutLocale(), "media.uploaded", { name: assetName })
					: t(getRecutLocale(), "media.uploadedOne");
			}

			if (uploadedCount > 1) {
				return t(getRecutLocale(), "media.uploadedMany", { count: uploadedCount });
			}

			return t(getRecutLocale(), "media.uploadedNone");
		},
		error: t(getRecutLocale(), "media.uploadFailed", { label: getAssetLabel({ count: filesCount }) }),
	});

	return toastPromise.unwrap();
}
