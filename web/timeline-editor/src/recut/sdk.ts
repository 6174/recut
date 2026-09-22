/**
 * [INPUT]: 依赖 web 宿主注入的 RecutHostAdapter（recut/host.ts）——service op 调用、宿主能力请求、realtime 事件订阅。
 * [OUTPUT]: 提供与 iframe 版本完全一致的 recut SDK 面：state.query、background.call、assets.*、clipboard、媒体选择器、
 *           Agent compose 回填、Focus 上报、项目事件订阅与 App→UI RPC handler。
 * [POS]: recut.editor 的 UI 通信边界（native 版，无 postMessage）；业务 UI 只能补充宿主签发工作面的 Focus，不能自行改写项目目标。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { getRecutHost, type RecutHostAdapter } from "@timeline/recut/host";

type RequestType =
	| "state.query"
	| "background.call"
	| "agent.compose"
	| "focus.report"
	| "page.context"
	| "media.pick"
	| "assets.get"
	| "assets.list"
	| "assets.upload"
	| "assets.attach"
	| "assets.delete"
	| "assets.content-url"
	| "assets.part-url"
	| "clipboard.write-text"
	| "apps.request-install";

export type MediaPickKind =
	| "image"
	| "video"
	| "audio"
	| "transcript"
	| "reference";

function host(): RecutHostAdapter {
	const active = getRecutHost();
	if (!active) {
		throw new Error(
			"timeline-editor host is not configured; call configureRecutHost before mounting",
		);
	}
	return active;
}

function requestID() {
	return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export type RecutAsset = {
	id: string;
	kind: "image" | "video" | "audio" | "transcript" | "reference";
	name: string;
	mimeType: string;
	sizeBytes: number;
	contentHash: string;
	status: "proposed" | "completed" | "deleted" | "failed" | "queued" | "running";
};

export type RecutAssetManifest = {
	projectId: string;
	assets: RecutAsset[];
};

async function call(
	type: RequestType,
	input: Record<string, unknown>,
): Promise<unknown> {
	const active = host();
	switch (type) {
		case "state.query":
			return active.invoke(String(input.name ?? ""), {});
		case "background.call": {
			const operation = input.operation ?? input.name;
			const { operation: _operation, ...rest } = input;
			return active.invoke(String(operation ?? ""), rest);
		}
		case "media.pick":
			return active.requestMediaPick(input);
		case "agent.compose":
			active.composeAgent(String(input.prompt ?? ""));
			return { delivery: "agent-composer" };
		case "focus.report":
			active.reportFocus(input.focus ?? input.context);
			return { delivery: "work-focus" };
		case "page.context":
			active.reportFocus(input.context);
			return { delivery: "work-focus" };
		case "assets.get":
		case "assets.list":
		case "assets.upload":
		case "assets.attach":
		case "assets.delete":
		case "assets.content-url":
		case "assets.part-url":
		case "clipboard.write-text":
		case "apps.request-install":
			return active.request(type, input);
		default:
			throw new Error(`unsupported request type: ${type}`);
	}
}

export const recut = {
	isConnected: () => getRecutHost() !== null,
	state: {
		query: (name: string) => call("state.query", { name }),
	},
	background: {
		call: (name: string, input: Record<string, unknown>) =>
			call("background.call", { name, ...input }),
	},
	agent: {
		compose: (input: { prompt: string }) => call("agent.compose", input),
	},
	media: {
		pick: (input: {
			kinds: MediaPickKind[];
			multiple?: boolean;
			selectedIDs?: string[];
		}) => call("media.pick", input),
	},
	assets: {
		get: (input: { assetId: string }) =>
			call("assets.get", input) as Promise<RecutAsset>,
		list: (input: { projectId?: string }) =>
			call("assets.list", input) as Promise<RecutAssetManifest>,
		upload: (input: { projectId?: string; file: File }) =>
			call("assets.upload", input) as Promise<{ asset: RecutAsset }>,
		attach: (input: { projectId?: string; assetId: string }) =>
			call("assets.attach", input) as Promise<void>,
		delete: (input: { assetId: string; projectId?: string }) =>
			call("assets.delete", input) as Promise<void>,
		contentURL: (input: { assetId: string }) =>
			call("assets.content-url", input) as Promise<string>,
		partURL: (input: {
			assetId: string;
			part: "srt" | "json" | "content" | "image";
		}) => call("assets.part-url", input) as Promise<string>,
	},
	clipboard: {
		writeText: (text: string) =>
			call("clipboard.write-text", { text }) as Promise<void>,
	},
	page: {
		// Legacy page.context remains available for third-party App compatibility.
		context: (context: {
			title: string;
			path?: string;
			url?: string;
			selection?: string;
			content?: string;
		}) => call("page.context", { context }),
	},
	apps: {
		// 拉起宿主全局统一的 App 安装引导弹窗（App 未安装时提醒用户安装）。
		requestInstall: (input: {
			appId: string;
			name?: string;
			repository?: string;
		}) => call("apps.request-install", input) as Promise<{ opened: boolean }>,
	},
	focus: {
		report: (focus: {
			view?: string;
			selection?: Array<{
				kind:
					| "timeline_element"
					| "timeline_track"
					| "component"
					| "asset"
					| "world_entity"
					| "world_evidence";
				id: string;
			}>;
			selectionState?: Record<string, unknown>;
			cursor?: { kind: "time"; seconds: number } | { kind: "none" };
			state?: Record<string, unknown>;
			summary?: string;
		}) => call("focus.report", { focus }),
	},
	navigation: {
		openAppDetail: (appID: string) => host().openAppDetail(appID),
	},
	events: {
		subscribe: (listener: (event: unknown) => void) => {
			const active = getRecutHost();
			if (!active) return () => {};
			return active.subscribeEvents(listener);
		},
	},
	/**
	 * 注册 App→UI RPC 的 UI 侧 handler（与 recut.operation.register 镜像）。
	 * 收到 `app.rpc.request { id, method, payload }` 时按 method 派发，结果自动经
	 * `rpc.reply` 回包（成功带 result，抛错带统一错误信封）。契约见
	 * docs/platform-comms-contract.md §4–§7。
	 */
	on: (
		method: string,
		handler: (
			payload: Record<string, unknown>,
			signal: AbortSignal,
		) => unknown | Promise<unknown>,
	): (() => void) => {
		const controllers = new Map<string, AbortController>();
		const cancelledBeforeDispatch = new Set<string>();
		const unsub = recut.events.subscribe((raw: unknown) => {
			if (!raw || typeof raw !== "object") return;
			const ev = raw as {
				type?: string;
				id?: string;
				method?: string;
				payload?: Record<string, unknown>;
			};
			if (ev.type === "app.rpc.cancel" && ev.id) {
				const controller = controllers.get(ev.id);
				if (controller) {
					controller.abort();
				} else {
					cancelledBeforeDispatch.add(ev.id);
				}
				return;
			}
			if (ev.type !== "app.rpc.request" || ev.method !== method || !ev.id) return;
			if (cancelledBeforeDispatch.delete(ev.id)) return;
			const controller = new AbortController();
			controllers.set(ev.id, controller);
			void Promise.resolve()
				.then(() => handler(ev.payload ?? {}, controller.signal))
				.then(
					(result) => {
						if (controller.signal.aborted) return undefined;
						return call("background.call", {
							name: "rpc.reply",
							id: ev.id,
							result,
						});
					},
					(error: unknown) => {
						if (controller.signal.aborted) return undefined;
						const message =
							error instanceof Error ? error.message : String(error);
						return call("background.call", {
							name: "rpc.reply",
							id: ev.id,
							error: { code: "ui-handler-error", message, hint: undefined },
						});
					},
				)
				.finally(() => controllers.delete(ev.id!));
		});
		return () => {
			for (const controller of controllers.values()) controller.abort();
			controllers.clear();
			cancelledBeforeDispatch.clear();
			unsub();
		};
	},
	/** 供宿主/调试追踪生成请求 id。 */
	requestID,
};
