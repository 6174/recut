/**
 * 资源路径助手：iframe 内 App 静态资源相对于 `ui/dist/`（base './'）伺服，
 * 不能使用绝对 `/xxx`（会解析到 service 根而 404）。
 */
export function assetPath(path: string): string {
	const base = import.meta.env.BASE_URL;
	if (base && base !== "/") {
		return `${base}${path.replace(/^\//, "")}`;
	}
	return path;
}
