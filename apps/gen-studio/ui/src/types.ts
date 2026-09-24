export type LocalLabel = string | { zh?: string; en?: string };

export interface FormField {
  key: string;
  type: "textarea" | "select" | "number" | "text";
  required?: boolean;
  label?: LocalLabel;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
}

export interface CatalogModel {
  model: string;
  capability: string;
  runtime: string;
  label: LocalLabel;
  inputModes: string[];
  formSchema: FormField[];
  defaultParams: Record<string, unknown>;
  ready: boolean;
  weight: { installed: boolean; sizeGb?: number; source?: string; revision?: string };
}

export interface RuntimeInfo {
  id: string;
  label: LocalLabel;
  venv: string;
  ready: boolean;
  error?: string;
}

export interface Catalog {
  ready: boolean;
  error?: string;
  runtimes: RuntimeInfo[];
  models: CatalogModel[];
  downloadSource: string;
}

export interface EngineStatus {
  running: boolean;
  port: number;
  pid?: string;
}

export interface EnvStatus {
  ready: boolean;
  pending?: boolean;
  error?: string;
  setupError?: string;
  setupLogs?: LogLine[];
}

export interface Task {
  id: string;
  action: string;
  name: string;
  recordId: string;
  source: string;
  state: string;
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
  model: string;
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  seed: string;
  steps: string;
  cfg: string;
  referenceAssetIds: ReferenceParam[];
  status?: string;
  error?: string;
}

export interface Generation {
  id: string;
  model: string;
  width: number;
  height: number;
  seed: string;
  steps: string;
  duration: number;
  outputURL: string;
  savedAssetId?: string;
}
