export interface EffectParamOption {
  value: string;
  label: string;
  presets?: Record<string, unknown>;
  swatch?: string;
}

export interface EffectParam {
  key: string;
  label: string;
  type: "float" | "select" | "toggle" | "color" | "colors" | "float2" | "image";
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: EffectParamOption[];
  presets?: Record<string, unknown>;
  resetsAnimation?: boolean;
  hideFromUI?: boolean;
}

export interface EffectGroup {
  label: string;
  keys: string[];
}

export interface PaletteRamp {
  key?: string;
  addAt?: number;
}

export interface EffectSchema {
  id: string;
  name: string;
  category: string;
  gallery: string;
  kind: string;
  description: string;
  swatch: string;
  swiftModifier: string;
  isAnimated: boolean;
  mslEntry: string;
  wgslEntry: string;
  mslArgOrder?: string[];
  groups?: EffectGroup[];
  params: EffectParam[];
  releasedAt?: string;
  updatedAt?: string;
  iosDeploymentTarget?: string;
  hasRnExport?: boolean;
  hasWebExport?: boolean;
  paletteRamp?: PaletteRamp;
}

export interface ImportFile {
  platform: string;
  name: string;
  file: string;
  size: number;
  binary?: boolean;
}

export interface ImportEntry {
  id: string;
  name: string;
  gallery?: string;
  kind?: string;
  files: ImportFile[];
}
