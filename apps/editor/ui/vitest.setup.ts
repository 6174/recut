/**
 * [INPUT]: Vitest Node 环境。
 * [OUTPUT]: 提供 i18n 模块初始化所需的最小 window/navigator 全局。
 * [POS]: Editor 单元测试启动契约；不模拟 DOM，不改变生产运行时。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
Object.defineProperty(globalThis, "window", {
	configurable: true,
	value: { location: { search: "" } },
});

Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: { language: "en" },
});

Object.defineProperty(globalThis, "document", {
	configurable: true,
	value: { documentElement: { lang: "" } },
});
