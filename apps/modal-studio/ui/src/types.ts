export type LocalLabel = string | { zh?: string; en?: string };

export interface FormField {
  key: string;
  type: "textarea" | "select" | "number" | "text" | "boolean" | "media";
  required?: boolean;
  label?: LocalLabel;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  kind?: string;
  multiple?: boolean;
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
}

export interface ModalApp {
  id: string;
  label: LocalLabel;
  capability: string;
  appName: string;
  origin?: "builtin" | "user";
  sourceDir?: string;
  path?: string;
  deployed: boolean;
  volumeReady: boolean;
  stale?: boolean;
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
  pending?: boolean;
  error?: string;
  setupError?: string;
  setupLogs?: LogLine[];
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
