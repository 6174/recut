"use client";

/**
 * [INPUT]: 依赖 Recut Host 项目事件、EditorCore 项目装载与组件同步能力。
 * [OUTPUT]: 对外提供 useRecutProjectSync；rAF 合并 agent document.changed，优先
 *           applyRemoteOperations（带 document 的快照，含版本 gap），无文档时拉
 *           timeline.delta，仍失败才 loadProject；reload 期间保留最新事件并在成功快照
 *           后一次确认，失败不自旋。
 * [POS]: recut Host 事件到编辑器状态的适配层；不渲染提示文本，Provider 消费编辑锁状态绘制边框。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useState } from "react";
import { recut } from "@/recut/sdk";
import { syncTimelineComponents } from "@/recut/components";
import { EditorCore } from "@/core";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { isDemoMode } from "@/demo/demo-store";

type ProjectEvent = {
	type?: string;
	version?: number;
	fromVersion?: number;
	toVersion?: number;
	source?: "agent" | "ui";
	owner?: string;
	library?: { tab?: "media" };
	document?: unknown;
	operations?: unknown[];
	transactionId?: string;
};

export function useRecutProjectSync({ projectId }: { projectId: string }) {
	const [isAiEditing, setIsAiEditing] = useState(false);
	useEffect(() => {
		const editor = EditorCore.getInstance();
		const active = editor.project.getActiveOrNull();
		let knownVersion = active?.version ?? 0;
		let reloading = false;
		let raf = 0;
		let pending: ProjectEvent | null = null;

		const scheduleFlush = () => {
			if (!raf) raf = window.requestAnimationFrame(flush);
		};

		const reload = (version: number) => {
			if (reloading) return;
			reloading = true;
			let succeeded = false;
			void editor.project
				.loadProject({ id: projectId })
				.then(() => {
					succeeded = true;
					// loadProject 的成功返回就是 Host 的完整快照；测试桥不一定把
					// version 回写到 active，因此以请求目标为最低确认版本。
					knownVersion = Math.max(
						knownVersion,
						version,
						editor.project.getActiveOrNull()?.version ?? 0,
						pending ? pendingVersion(pending) : 0,
					);
					// 完整 loadProject 已经读取了当前快照；将 reload 期间合并的事件
					// 一次性确认，避免 loadProject 自己触发的回显事件形成 reload storm。
					pending = null;
				})
				.catch((err) => console.error("[recut-sync] reload failed:", err))
				.finally(() => {
					reloading = false;
					// reload 期间抵达的事件不能丢；成功后继续消费，失败则等下一次事件触发重试。
					if (!succeeded && pending && pendingVersion(pending) > knownVersion) {
						// 失败时保留事件，但不自旋；下一次外部事件会再次触发 flush。
						return;
					}
				});
		};

		const pendingVersion = (ev: ProjectEvent) => Number(ev.toVersion ?? ev.version ?? 0);

		const applyEvent = async (ev: ProjectEvent) => {
			const version = pendingVersion(ev);
			if (version <= knownVersion) return;
			const hasDocument = !!ev.document && typeof ev.document === "object";
			if (hasDocument) {
				const applied = await editor.project.applyRemoteOperations({
					operations: Array.isArray(ev.operations) ? ev.operations : [],
					document: ev.document,
					version,
					fromVersion: ev.fromVersion,
					toVersion: version,
				});
				if (applied.ok) {
					knownVersion = editor.project.getAppliedVersion() || version;
					return;
				}
			}
			// demo/e2e 没有 Host 通道，delta 会挂起；无文档时直接 reload。
			if (isDemoMode()) {
				pending = ev;
				reload(version);
				return;
			}
			try {
				const delta = await recut.background.call("timeline.delta", {
					fromVersion: knownVersion,
				});
				if (delta && delta.document) {
					const applied = await editor.project.applyRemoteOperations({
						operations: Array.isArray(delta.operations) ? delta.operations : [],
						document: delta.document,
						version: Number(delta.toVersion ?? version),
						fromVersion: delta.fromVersion,
						toVersion: delta.toVersion,
					});
					if (applied.ok) {
						knownVersion =
							editor.project.getAppliedVersion() ||
							Number(delta.toVersion ?? version);
						return;
					}
				}
			} catch (err) {
				console.warn("[recut-sync] timeline.delta failed:", err);
			}
			pending = ev;
			reload(version);
		};

		const flush = () => {
			raf = 0;
			const ev = pending;
			if (!ev || reloading) return;
			pending = null;
			void applyEvent(ev).catch((err) => {
				console.warn("[recut-sync] apply failed, reloading:", err);
				if (!pending || pendingVersion(ev) >= pendingVersion(pending)) pending = ev;
				reload(Number(ev.toVersion ?? ev.version ?? knownVersion));
			});
		};

		const unsub = recut.events.subscribe((raw: unknown) => {
			if (!raw || typeof raw !== "object") return;
			const ev = raw as ProjectEvent;
			if (ev.type === "project.document.changed") {
				const version = Number(ev.toVersion ?? ev.version ?? 0);
				if (ev.source === "ui") {
					knownVersion = Math.max(knownVersion, version);
					return;
				}
				if (version <= knownVersion) return;
				// 合并窗口内只保留最新事件，但不覆盖更高版本。
				if (!pending || version >= pendingVersion(pending)) pending = ev;
				scheduleFlush();
			} else if (ev.type === "project:locked") {
				editor.save.pause();
				setIsAiEditing(true);
			} else if (ev.type === "project.components.changed") {
				void syncTimelineComponents(editor.project.getActiveOrNull());
				if (ev.library?.tab === "media") {
					useAssetsPanelStore.getState().setActiveTab("media");
				}
			} else if (ev.type === "project.assets.changed") {
				// AI 登记/落轨新增素材（如旁白音频）后，重新拉取该项目媒体素材，
				// 让素材面板实时看到新增项；并切到素材视图。
				void editor.media
					.loadProjectMedia({ projectId })
					.then(() => {
						if (ev.library?.tab === "media") {
							useAssetsPanelStore.getState().setActiveTab("media");
						}
					})
					.catch((err) =>
						console.warn("[recut-sync] reload media failed:", err),
					);
			} else if (ev.type === "project:unlocked") {
				editor.save.resume();
				setIsAiEditing(false);
			}
		});

		return () => {
			if (raf) window.cancelAnimationFrame(raf);
			setIsAiEditing(false);
			unsub();
		};
	}, [projectId]);
	return isAiEditing;
}
