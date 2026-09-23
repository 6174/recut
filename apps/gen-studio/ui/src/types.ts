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
