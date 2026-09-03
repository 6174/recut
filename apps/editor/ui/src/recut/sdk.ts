/**
 * [INPUT]: 依赖 Host 注入的 MessageChannel，与宿主工作台握手
 * [OUTPUT]: 等待 Host 连接、调用 App operations（api surface）、全局 Assets 获取/上传/绑定/删除能力、顶层 Clipboard 写入、素材选择器、
 *           Agent compose 回填、Focus 上报、旧页面上下文兼容、新窗口应用详情导航与项目事件订阅
 * [POS]: recut.editor 的 UI 通信边界；业务 UI 只能补充宿主签发工作面的 Focus，不能自行改写项目目标。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
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
type Request = { id: string; type: RequestType; input: Record<string, unknown> };

export type MediaPickKind =
	| "image"
	| "video"
	| "audio"
	| "transcript"
	| "reference";

let port: MessagePort | null = null;
let resolveConnection: ((nextPort: MessagePort) => void) | null = null;
const connection = new Promise<MessagePort>((resolve) => {
	resolveConnection = resolve;
});
const pending = new Map<
	string,
	{ resolve: (value: any) => void; reject: (error: Error) => void }
>();
let requestSequence = 0;
let readyAttempts = 0;
const hostOrigin = document.referrer ? new URL(document.referrer).origin : "*";

function announceReady() {
	if (port || window.parent === window || readyAttempts >= 80) return;
	readyAttempts += 1;
	window.parent.postMessage({ type: "recut.ui.ready" }, hostOrigin);
}

const readyTimer = window.setInterval(announceReady, 250);

function requestID() {
	requestSequence += 1;
	return `request-${Date.now().toString(36)}-${requestSequence.toString(36)}-${Math.random()
		.toString(36)
		.slice(2)}`;
}

window.addEventListener("message", (event) => {
	if (event.data?.type === "recut.project.event") {
		window.dispatchEvent(
			new CustomEvent("recut-project-event", { detail: event.data.event }),
		);
		return;
	}
	if (event.data?.type !== "recut.ui.connect" || !event.ports[0]) return;
	port = event.ports[0];
	port.onmessage = (message) => {
		const request = pending.get(message.data?.id);
		if (!request) return;
		pending.delete(message.data.id);
		if (message.data.error) {
			request.reject(new Error(message.data.error));
			return;
		}
		request.resolve(message.data.result);
	};
	port.start();
	resolveConnection?.(port);
	resolveConnection = null;
	window.clearInterval(readyTimer);
	window.dispatchEvent(new Event("recut-sdk-ready"));
});

announceReady();

async function call(type: RequestType, input: Record<string, unknown>) {
	const activePort = port ?? (await connection);
	return new Promise<any>((resolve, reject) => {
		const id = requestID();
		pending.set(id, { resolve, reject });
		activePort.postMessage({ id, type, input } satisfies Request);
	});
}

function appDetailURL(appID: string) {
	const hostURL = new URL(document.referrer || window.location.href);
	hostURL.pathname = `/apps/${encodeURIComponent(appID)}`;
	hostURL.search = "";
	hostURL.hash = "";
	return hostURL.toString();
}

/** 素材内容 URL（本地 mode 同源；LAN mode 由宿主地址决定）。 */
export type RecutAsset = {
	id: string;
	kind: "image" | "video" | "audio" | "transcript" | "reference";
	name: string;
	mimeType: string;
	sizeBytes: number;
	contentHash: string;
	status: "completed" | "deleted" | "failed" | "queued" | "running";
	projectIds: string[];
};

export type RecutAssetManifest = {
	projectId: string;
	assets: RecutAsset[];
};

export const recut = {
	isConnected: () => port !== null,
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
		writeText: (text: string) => call("clipboard.write-text", { text }) as Promise<void>,
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
		// Focus supplements the host-owned Project/App target. Include the
		// complete user-visible selection state so the Agent can act on it
		// without reconstructing the same object through exploratory reads.
		report: (focus: {
			view?: string;
			selection?: Array<{ kind: "timeline_element" | "timeline_track" | "component" | "asset" | "world_entity" | "world_evidence"; id: string }>;
			selectionState?: Record<string, unknown>;
			cursor?: { kind: "time"; seconds: number } | { kind: "none" };
			state?: Record<string, unknown>;
			summary?: string;
		}) => call("focus.report", { focus }),
	},
	navigation: {
		openAppDetail: (appID: string) =>
			window.open(appDetailURL(appID), "_blank", "noopener,noreferrer"),
	},
	events: {
		subscribe: (listener: (event: unknown) => void) => {
			const receive = (event: Event) =>
				listener((event as CustomEvent<unknown>).detail);
			window.addEventListener("recut-project-event", receive);
			return () => window.removeEventListener("recut-project-event", receive);
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
					// WebSocket normally preserves order; retaining this bit also makes a
					// cancel/request race safe without replying to a cancelled Handle.
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
};
