/**
 * [INPUT]: 依赖 ui/src 静态文案
 * [OUTPUT]: 对外提供 zh/en 双语字典、Locale 类型、t(locale,key) 查询与 interpolate 插值
 * [POS]: ui/src 的文案边界；业务组件只引用 key，不内联用户可见字符串
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export type Locale = "zh" | "en";

const zh: Record<string, string> = {
  "app.name": "生成工坊",
  "app.kicker": "RECUT APP / 生成工坊",
  "app.subtitle": "一个运行环境托管多个本机模型：先准备环境、再下载权重，生成结果确认后进入素材库。",
  "app.resync": "重新同步",
  "app.loading": "正在连接生成工坊…",

  "setup.title": "正在准备运行环境",
  "setup.description": "首次使用需要安装 Python 依赖与 ComfyUI 源码；之后依赖锁定有变更时也会在这里自动重新安装。",
  "setup.running": "正在准备…已用时 {time}",
  "setup.preparing": "准备中…",
  "setup.retry": "重新准备",
  "setup.failure-title": "运行环境准备失败",
  "setup.logs-empty": "（等待日志输出…）",
  "setup.logs-label": "环境准备日志",
  "setup.failure-logs-label": "失败日志",
  "setup.hint": "准备完成后即可开始生成。",

  "tab.generate": "生成",
  "tab.records": "记录",

  "generate.model": "模型",
  "generate.ready": "环境与权重就绪",
  "generate.runtime-missing": "runtime 未就绪",
  "generate.weight-missing": "权重未下载",
  "generate.submit": "生成",
  "generate.set-default": "设为生图默认",
  "generate.default-set": "已把生图默认路由设为 {model}。",
  "generate.default-failed": "设置失败：{error}",
  "generate.hint-prepare": "请在「记录」中执行「准备环境」与「下载模型」。",
  "generate.dep.title": "该模型尚未就绪，先完成环境与权重准备",
  "generate.dep.runtime": "运行环境",
  "generate.dep.weights": "模型权重",
  "generate.empty-models": "没有可用模型。请先在「记录」中准备环境并下载模型。",
  "generate.failed": "生成失败：{error}",

  "records.prepare": "准备环境",
  "records.install": "下载模型",
  "records.source": "下载来源",
  "records.save-source": "保存来源",
  "records.empty": "暂无任务记录。",

  "source.automatic": "自动来源",
  "source.huggingface": "Hugging Face",
  "source.modelscope": "ModelScope",

  "state.completed": "已完成",
  "state.failed": "失败",
  "state.queued": "排队中",
  "state.running": "进行中",
  "state.cancelled": "已取消",
  "state.interrupted": "已中断",

  "action.prepare": "准备运行环境",
  "action.install": "下载模型",
  "action.generate": "生成",

  "preview.title": "生产预览",
  "preview.empty": "选择或提交一个任务后，这里显示结果与进度日志。",
  "preview.cancel": "取消",
  "preview.save": "保存入库",
  "preview.saved": "已入库",
  "preview.no-logs": "（暂无日志）",
  "preview.meta": "{model} · {width}×{height} · seed {seed} · {steps} 步 · {duration}s",
};

const en: Record<string, string> = {
  "app.name": "Generation Studio",
  "app.kicker": "RECUT APP / GENERATION STUDIO",
  "app.subtitle": "One runtime hosts many local models: prepare the environment, download weights on demand, and save confirmed results to the library.",
  "app.resync": "Resync",
  "app.loading": "Connecting to Generation Studio…",

  "setup.title": "Preparing the runtime",
  "setup.description": "First use installs the Python dependencies and the ComfyUI source; later lock changes are reinstalled automatically here too.",
  "setup.running": "Preparing… {time} elapsed",
  "setup.preparing": "Preparing…",
  "setup.retry": "Prepare again",
  "setup.failure-title": "Runtime setup failed",
  "setup.logs-empty": "(waiting for log output…)",
  "setup.logs-label": "Setup logs",
  "setup.failure-logs-label": "Failure logs",
  "setup.hint": "Generation opens once setup finishes.",

  "tab.generate": "Generate",
  "tab.records": "Records",

  "generate.model": "Model",
  "generate.ready": "Environment and weights ready",
  "generate.runtime-missing": "Runtime not ready",
  "generate.weight-missing": "Weights not downloaded",
  "generate.submit": "Generate",
  "generate.set-default": "Set as image default",
  "generate.default-set": "Image default route set to {model}.",
  "generate.default-failed": "Failed to set: {error}",
  "generate.hint-prepare": "Prepare the environment and download the model in Records first.",
  "generate.dep.title": "This model is not ready — prepare the environment and weights first",
  "generate.dep.runtime": "Runtime",
  "generate.dep.weights": "Model weights",
  "generate.empty-models": "No models available. Prepare the environment and download a model in Records first.",
  "generate.failed": "Generation failed: {error}",

  "records.prepare": "Prepare environment",
  "records.install": "Download model",
  "records.source": "Download source",
  "records.save-source": "Save source",
  "records.empty": "No tasks yet.",

  "source.automatic": "Automatic",
  "source.huggingface": "Hugging Face",
  "source.modelscope": "ModelScope",

  "state.completed": "Completed",
  "state.failed": "Failed",
  "state.queued": "Queued",
  "state.running": "Running",
  "state.cancelled": "Cancelled",
  "state.interrupted": "Interrupted",

  "action.prepare": "Prepare runtime",
  "action.install": "Download model",
  "action.generate": "Generate",

  "preview.title": "Production preview",
  "preview.empty": "Pick or submit a task to see its result and progress logs here.",
  "preview.cancel": "Cancel",
  "preview.save": "Save to library",
  "preview.saved": "Saved",
  "preview.no-logs": "(no logs yet)",
  "preview.meta": "{model} · {width}×{height} · seed {seed} · {steps} steps · {duration}s",
};

const dicts: Record<Locale, Record<string, string>> = { zh, en };

export function t(locale: Locale, key: string): string {
  return dicts[locale][key] ?? dicts.zh[key] ?? key;
}

export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}
