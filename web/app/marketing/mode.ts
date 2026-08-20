/*
 * [INPUT]: 依赖构建期环境变量 NEXT_PUBLIC_RECUT_WORKSPACE_MODE
 * [OUTPUT]: 判定当前构建是否需要生成营销站点页面
 * [PROPOS]: local（内嵌二进制/本地工作台）模式不生成任何营销内容，营销站点只由 CDN Worker 提供；
 *           cloud/lan（CDN 与本地官网）模式正常生成
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export function marketingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_RECUT_WORKSPACE_MODE !== "local";
}