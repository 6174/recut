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

export type AppRequirement = {
  title: string;
  items: string[];
  note?: string;
};

export type CatalogApp = { manifest: AppManifest; requirements?: AppRequirement };

export const appCatalog: CatalogApp[] = [
  {
    manifest: {
      id: "recut.vox-broll",
      name: "AI 短片",
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
      name: "深度图",
      author: "Recut",
      description: "在本机将图片或视频转换为可预览的深度图，再按需保存到素材库。",
      repository: "https://github.com/6174/recut-depth-anything-v2",
      version: "0.2.0",
      type: "standalone",
    },
  },
  {
    manifest: {
      id: "recut.remotion-studio",
      name: "Remotion 视频",
      author: "6174",
      description: "把选题、文案和素材编排成可审阅、可实时预览、可导出的 Remotion 程序化视频。",
      repository: "https://github.com/6174/recut-remotion-studio",
      version: "0.2.0",
      type: "project",
    },
  },
  {
    manifest: {
      id: "recut.audio-studio",
      name: "声音工坊",
      author: "Recut",
      description: "本地转写、声音角色与配音：把音视频转成字幕和可编辑文稿，再让角色朗读新文本。",
      repository: "https://github.com/6174/recut-audio-studio",
      version: "0.1.0",
      type: "standalone",
    },
    requirements: {
      title: "运行前请确认设备条件",
      items: [
        "基础转写建议至少 16 GB 内存；要稳定创建声音角色和合成配音，建议 32 GB 及以上。8 GB 内存或较旧设备不建议下载。",
        "建议至少预留 15 GB 磁盘空间；Qwen3-ASR 0.6B 连同时间戳对齐器约 3.5 GB，CosyVoice2-0.5B 约 1 GB，Python 运行环境和缓存还会占用额外空间；下载多个模型需要更多空间。",
        "想要较快的 Qwen 转写，推荐 Windows / Linux 上具备 8 GB 以上显存的 NVIDIA CUDA 显卡。纯 CPU 与 Apple 芯片 Mac 也能运行，但当前版本不会使用 Apple GPU 加速，Qwen 和配音会明显更慢。",
      ],
      note: "模型在本机运行。安装 App 不会下载权重；只有你在声音工坊中选择模型后才会下载。",
    },
  },
  {
    manifest: {
      id: "recut.cover-studio",
      name: "封面生成",
      author: "Recut",
      description: "用渠道尺寸、参考封面和创作要求生成并沉淀封面素材。",
      repository: "https://github.com/6174/recut-cover-studio",
      version: "0.3.1",
      type: "standalone",
    },
  },
];

export const marketplaceApps = appCatalog;

export function getCatalogApp(appID: string) {
  return appCatalog.find((app) => app.manifest.id === appID) ?? null;
}
