/**
 * 资源路径助手：迁入 web 统一前端后，静态资源由 Next 从 public/ 根伺服，
 * 不再有 iframe 的 `ui/dist/` 相对基址（Vite BASE_URL）。
 */
export function assetPath(path: string): string {
	return path;
}
