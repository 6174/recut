export type LocalLabel = string | { zh?: string; en?: string };

export interface FormField {
  key: string;
  type: "textarea" | "select" | "number" | "text" | "boolean" | "media";
  required?: boolean;
  label?: LocalLabel;
  /** 输入框占位提示（textarea/text 用）。 */
  placeholder?: LocalLabel;
  /** 字段级说明（渲染在控件下方），用于把档位语义写在字段旁而非文档里。 */
  hint?: LocalLabel;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  kind?: string;
  multiple?: boolean;
  /** number 字段：额外渲染「随机」按钮，点击填入一个区间内的随机整数（如随机种子）。 */
  randomizable?: boolean;
}

export interface OutputSpec {
  kind: "image" | "video" | "audio";
  mimeType?: string;
  ext?: string;
}

export interface GpuTier {
  id: string;
  gpu: string;
  label?: LocalLabel;
}

export interface GpuTiers {
  default: string;
  options: GpuTier[];
}

export interface ModalFunction {
  id: string;
  label: LocalLabel;
  entrypoint: string;
  output: OutputSpec;
  formSchema: FormField[];
  defaultParams: Record<string, unknown>;
  agentDefaults: Record<string, unknown>;
  minReferences?: number;
}

export interface ModalApp {
  id: string;
  label: LocalLabel;
  capability: string;
  appName: string;
  origin?: "builtin" | "user";
  sourceDir?: string;
  path?: string;
  /** 就绪度由后台探测填充；首次进入尚无任何探测结果时缺省（未知），不是「尚未部署」。 */
  deployed?: boolean;
  volumeReady?: boolean;
  stale?: boolean;
  expose?: { model?: string; function?: string };
  gpuTiers: GpuTiers;
  weights: { sizeGb?: number; revision?: string };
  profileId?: string;
  functions: ModalFunction[];
}

export interface Profile {
  id: string;
  name: string;
  tokenIdMasked: string;
  tokenSet: boolean;
}

export interface SecretDef {
  name: string;
  required: boolean;
  keys: string[];
  label: LocalLabel;
  set: boolean;
}

export interface Catalog {
  ready: boolean;
  connected: boolean;
  error?: string;
  account?: string;
  modalapps: ModalApp[];
  profiles: Profile[];
  defaultProfileId: string;
  downloadSource: string;
  defaultGpuTier: string;
}

export interface EnvStatus {
  ready: boolean;
  connected?: boolean;
  account?: string;
  pending?: boolean;
  error?: string;
  setupError?: string;
  setupLogs?: LogLine[];
  /** 各预设包的部署/权重/变更状态（探测结果）。 */
  modalapps?: Record<string, ModalAppReadiness>;
  /** 本次探测时间；界面据此判断快照是否新鲜（过期才在点击运行时重探）。 */
  checkedAt?: string;
}

export interface ModalAppReadiness {
  deployed?: boolean;
  volumeReady?: boolean;
  stale?: boolean;
}

/** modal.overview：首屏轻量负载（本机 registry/profiles/设置 + 上次就绪度快照，不拉起 modal CLI）。 */
export interface Overview {
  modalapps: ModalApp[];
  profiles: Profile[];
  defaultProfileId: string;
  downloadSource: string;
  defaultGpuTier: string;
  snapshot: EnvStatus | null;
}

export interface Task {
  id: string;
  action: string;
  name: string;
  modalapp?: string;
  function?: string;
  recordId: string;
  source: string;
  state: string;
  jobId?: string;
  createdAt: string;
  startedAt?: string;
  resolvedAt?: string;
  error?: string;
}

export interface TaskDetail extends Task {
  progress?: number;
  meta?: Record<string, unknown>;
  logPath?: string;
}

export interface LogLine {
  level: string;
  message: string;
}

export interface MediaAsset {
  id: string;
  name?: string;
  kind?: string;
  mimeType?: string;
  status?: string;
}

export interface InjectedReference {
  id: string;
  name?: string;
  nonce: number;
  error?: string;
  draft?: GenerationParams;
}

export interface ReferenceParam {
  id: string;
  name?: string;
  savedAssetId?: string;
  available?: boolean;
}

export interface GenerationParams {
  id: string;
  modalapp: string;
  function: string;
  model: string;
  gpuTier: string;
  values: Record<string, string>;
  prompt: string;
  referenceAssetIds: ReferenceParam[];
  status?: string;
  error?: string;
}

export interface Generation {
  id: string;
  modalapp: string;
  function: string;
  app: string;
  outputKind: "image" | "video" | "audio";
  width: number;
  height: number;
  duration: number;
  seed: number;
  gpuTier: string;
  outputURL: string;
  savedAssetId?: string;
  params?: Record<string, unknown>;
}
