/**
 * [INPUT]: 依赖 OPFS（按 contentHash 存取字节）与 IndexedDB（内容索引 + 全局引用计数）。
 * [OUTPUT]: 提供 MediaContentCache：与服务 contentHash 同键的全局内容缓存——store 落字节、
 *           retain/release 维护跨项目引用计数、resolveFile 重建可渲染 File、has 判定本地是否已有字节。
 * [POS]: storage 的全局内容层；Service Asset 是真相，本地字节是可按 hash 重建的共享缓存。
 *       同一份内容被多个项目引用只存一份；引用计数归零才删字节。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { IndexedDBAdapter } from "./indexeddb-adapter";
import { OPFSAdapter } from "./opfs-adapter";

const CONTENT_DIRECTORY = "recut-media-cache";
const INDEX_DB = "video-editor-media-cache";
const INDEX_STORE = "content";

export interface ContentIndexEntry {
	id: string;
	refCount: number;
	size: number;
	mimeType?: string;
	updatedAt: string;
}

export interface ContentStoreInput {
	hash: string;
	size?: number;
	mimeType?: string;
	file?: Blob | null;
	stream?: ReadableStream<Uint8Array> | null;
}

class MediaContentCache {
	private content = new OPFSAdapter(CONTENT_DIRECTORY);
	private index = new IndexedDBAdapter<ContentIndexEntry>({
		dbName: INDEX_DB,
		storeName: INDEX_STORE,
	});
	// 引用计数是读-改-写；同 tab 内串行化，避免并发 store/retain/release 互相覆盖。
	private queue: Promise<unknown> = Promise.resolve();

	private runExclusive<T>(task: () => Promise<T>): Promise<T> {
		const next = this.queue.then(task, task);
		this.queue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	/** 本地是否已有该内容的字节；不能只看索引（OPFS 可能被浏览器回收）。 */
	async has(hash: string): Promise<boolean> {
		if (!hash) return false;
		return this.content.has(hash);
	}

	async getEntry(hash: string): Promise<ContentIndexEntry | null> {
		if (!hash) return null;
		return this.index.get(hash);
	}

	/**
	 * 落字节并建立（或补齐）内容索引，引用计数不变（保持 0）。
	 * 已有字节时不重复写入，实现跨项目/跨素材的内容去重。
	 */
	async store({
		hash,
		size,
		mimeType,
		file,
		stream,
	}: ContentStoreInput): Promise<void> {
		if (!hash) throw new Error("content hash is required");
		return this.runExclusive(async () => {
			const existingFile = await this.content.get(hash);
			if (!existingFile) {
				if (stream) {
					await this.content.setStream({ key: hash, source: stream });
				} else if (file) {
					await this.content.setStream({ key: hash, source: file });
				} else {
					throw new Error(`content bytes are required to store ${hash}`);
				}
			}
			const entry = await this.index.get(hash);
			const resolvedSize = size ?? entry?.size ?? existingFile?.size ?? 0;
			if (!entry) {
				await this.index.set({
					key: hash,
					value: {
						id: hash,
						refCount: 0,
						size: resolvedSize,
						...(mimeType ? { mimeType } : {}),
						updatedAt: new Date().toISOString(),
					},
				});
				return;
			}
			if (!entry.size || (mimeType && !entry.mimeType)) {
				await this.index.set({
					key: hash,
					value: {
						...entry,
						...(entry.size ? {} : { size: resolvedSize }),
						...(mimeType && !entry.mimeType ? { mimeType } : {}),
						updatedAt: new Date().toISOString(),
					},
				});
			}
		});
	}

	/** 新增一个引用；字节必须已存在（先 store）。 */
	async retain({
		hash,
		size,
		mimeType,
	}: {
		hash: string;
		size?: number;
		mimeType?: string;
	}): Promise<void> {
		if (!hash) throw new Error("content hash is required");
		return this.runExclusive(async () => {
			const entry = await this.index.get(hash);
			if (!entry) {
				if (!(await this.content.has(hash))) {
					throw new Error(`content is missing; cannot retain ${hash}`);
				}
				await this.index.set({
					key: hash,
					value: {
						id: hash,
						refCount: 1,
						size: size ?? 0,
						...(mimeType ? { mimeType } : {}),
						updatedAt: new Date().toISOString(),
					},
				});
				return;
			}
			await this.index.set({
				key: hash,
				value: {
					...entry,
					refCount: entry.refCount + 1,
					...(size ? { size } : {}),
					...(mimeType ? { mimeType } : {}),
					updatedAt: new Date().toISOString(),
				},
			});
		});
	}

	/** 释放一个引用；计数归零才删字节与索引。 */
	async release(hash: string): Promise<void> {
		if (!hash) return;
		return this.runExclusive(async () => {
			const entry = await this.index.get(hash);
			if (!entry) return;
			const refCount = entry.refCount - 1;
			if (refCount > 0) {
				await this.index.set({
					key: hash,
					value: {
						...entry,
						refCount,
						updatedAt: new Date().toISOString(),
					},
				});
				return;
			}
			await this.index.remove(hash);
			await this.content.remove(hash);
		});
	}

	/** 从全局内容缓存重建可渲染 File；字节缺失返回 null。 */
	async resolveFile(
		hash: string,
		{ name, mimeType }: { name: string; mimeType?: string },
	): Promise<File | null> {
		if (!hash) return null;
		const file = await this.content.get(hash);
		if (!file) return null;
		return new File([file], name, { type: mimeType || file.type || "" });
	}
}

export const mediaContentCache = new MediaContentCache();
