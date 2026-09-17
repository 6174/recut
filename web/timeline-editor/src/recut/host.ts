/*
 * [INPUT]: 无外部依赖；由 web 宿主在挂载 timeline-editor 前注入实现。
 * [OUTPUT]: RecutHostAdapter 契约与 configureRecutHost/getRecutHost/serviceBase——
 *           timeline-editor 经此访问 service（op 调用、素材、realtime 事件、Agent 面板、平台素材选择器），
 *           取代 iframe 的 MessageChannel 传输。
 * [POS]: M0 迁移的传送带接口；模块只依赖本契约，不发现 service origin、不直连 web 业务。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export type RecutHostRequest = {
	type: string;
	input: Record<string, unknown>;
};

export type RecutHostAdapter = {
	/** service 基址（如 http://127.0.0.1:17373 或同源 ""）。 */
	apiBase: string;
	projectId: string;
	appId: string;
	/** 调用 App 的 api surface operation（state.query / background.call 共用）。 */
	invoke: (op: string, input: Record<string, unknown>) => Promise<unknown>;
	/** 处理 assets.* / clipboard.write-text / apps.request-install 等宿主能力请求。 */
	request: (type: string, input: Record<string, unknown>) => Promise<unknown>;
	/** 拉起宿主平台素材选择器，返回与 iframe 宿主一致的选择结果。 */
	requestMediaPick: (input: Record<string, unknown>) => Promise<unknown>;
	composeAgent: (prompt: string) => void;
	reportFocus: (focus: unknown) => void;
	openAppDetail: (appId: string) => void;
	subscribeEvents: (listener: (event: unknown) => void) => () => void;
};

let adapter: RecutHostAdapter | null = null;

export function configureRecutHost(next: RecutHostAdapter): void {
	adapter = next;
	if (typeof window !== "undefined") {
		(window as Window & { __recutFontsAPIBase?: string }).__recutFontsAPIBase =
			next.apiBase;
		window.dispatchEvent(new Event("recut-sdk-ready"));
	}
}

export function getRecutHost(): RecutHostAdapter | null {
	return adapter;
}

export function serviceBase(): string {
	return adapter?.apiBase ?? "";
}
