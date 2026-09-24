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

export interface CatalogApp {
  app: string;
  model: string;
  capability: string;
  runtime: string;
  label: LocalLabel;
  output: OutputSpec;
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
  apps: CatalogApp[];
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
  app: string;
  model: string;
  values: Record<string, string>;
  prompt: string;
  referenceAssetIds: ReferenceParam[];
  status?: string;
  error?: string;
}

export interface Generation {
  id: string;
  app: string;
  model: string;
  outputKind: "image" | "video" | "audio";
  width: number;
  height: number;
  duration: number;
  outputURL: string;
  savedAssetId?: string;
  params?: Record<string, unknown>;
}
