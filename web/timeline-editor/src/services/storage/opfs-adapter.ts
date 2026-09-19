import type { StorageAdapter } from "./types";

export class OPFSAdapter implements StorageAdapter<File> {
	private directoryName: string;

	constructor(directoryName = "media") {
		this.directoryName = directoryName;
	}

	private async getDirectory(): Promise<FileSystemDirectoryHandle> {
		const opfsRoot = await navigator.storage.getDirectory();
		return await opfsRoot.getDirectoryHandle(this.directoryName, {
			create: true,
		});
	}

	async get(key: string): Promise<File | null> {
		try {
			const directory = await this.getDirectory();
			const fileHandle = await directory.getFileHandle(key);
			return await fileHandle.getFile();
		} catch (error) {
			if ((error as Error).name === "NotFoundError") {
				return null;
			}
			throw error;
		}
	}

	async set({
		key,
		value: file,
	}: {
		key: string;
		value: File;
	}): Promise<void> {
		const directory = await this.getDirectory();
		const fileHandle = await directory.getFileHandle(key, { create: true });
		const writable = await fileHandle.createWritable();

		await writable.write(file);
		await writable.close();
	}

	/**
	 * 流式写入：直接把 fetch 的 ReadableStream 落盘，避免整文件先进内存。
	 * 传入 Blob 时退化为一次 write。写入失败会尽量清理半成品。
	 */
	async setStream({
		key,
		source,
	}: {
		key: string;
		source: ReadableStream<Uint8Array> | Blob;
	}): Promise<void> {
		const directory = await this.getDirectory();
		const fileHandle = await directory.getFileHandle(key, { create: true });
		try {
			if (source instanceof Blob) {
				const writable = await fileHandle.createWritable();
				await writable.write(source);
				await writable.close();
				return;
			}
			const writable = await fileHandle.createWritable();
			await source.pipeTo(writable as unknown as WritableStream<Uint8Array>);
		} catch (error) {
			await directory.removeEntry(key).catch(() => undefined);
			throw error;
		}
	}

	async has(key: string): Promise<boolean> {
		return (await this.get(key)) !== null;
	}

	async remove(key: string): Promise<void> {
		try {
			const directory = await this.getDirectory();
			await directory.removeEntry(key);
		} catch (error) {
			if ((error as Error).name !== "NotFoundError") {
				throw error;
			}
		}
	}

	async list(): Promise<string[]> {
		const directory = await this.getDirectory();
		const keys: string[] = [];

		for await (const name of directory.keys()) {
			keys.push(name);
		}

		return keys;
	}

	async clear(): Promise<void> {
		const directory = await this.getDirectory();

		for await (const name of directory.keys()) {
			await directory.removeEntry(name);
		}
	}

	// Helper method to check OPFS support
	static isSupported(): boolean {
		return "storage" in navigator && "getDirectory" in navigator.storage;
	}
}
