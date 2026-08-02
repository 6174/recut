/*
 * [INPUT]: 无运行时依赖；发布时维护的应用身份、版本与仓库元数据
 * [OUTPUT]: 对外提供静态 App Catalog、应用市场条目与按 ID 查询能力
 * [POS]: web/lib 的发布目录真相；Apps 目录与详情页以它渲染身份，service 只回答安装状态并执行安装
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export type AppManifest = {
  id: string;
  name: string;
  author: string;
  description: string;
  repository?: string;
  version: string;
  type: "project" | "standalone";
};

export type CatalogApp = { manifest: AppManifest };

export const appCatalog: CatalogApp[] = [
  {
    manifest: {
      id: "recut.vox-broll",
      name: "Vox B-roll Explainer",
      author: "6174",
      description: "将一个主题制作成可审阅、可继续制作的 Vox 风格 B-roll 解说片。",
      repository: "https://github.com/6174/recut-vox-broll",
      version: "0.14.0",
      type: "project",
    },
  },
  {
    manifest: {
      id: "recut.depth-anything",
      name: "Depth Anything",
      author: "Recut",
      description: "在本机将图片或视频转换为可预览的深度图，再按需保存到素材库。",
      repository: "https://github.com/6174/recut-depth-anything-v2",
      version: "0.2.0",
      type: "standalone",
    },
  },
  {
    manifest: {
      id: "recut.cover-studio",
      name: "封面生成",
      author: "Recut",
      description: "用渠道尺寸、参考封面和创作要求生成并沉淀封面素材。",
      repository: "https://github.com/6174/recut-cover-studio",
      version: "0.2.0",
      type: "standalone",
    },
  },
];

export const marketplaceApps = appCatalog;

export function getCatalogApp(appID: string) {
  return appCatalog.find((app) => app.manifest.id === appID) ?? null;
}
