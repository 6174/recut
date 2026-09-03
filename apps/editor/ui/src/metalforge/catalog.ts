import type { EffectSchema, ImportEntry } from "./types";
import schema from "./catalog/schema.json";
import importsIndex from "./imports/index.json";

export const effects = schema as EffectSchema[];

export const GALLERY_ORDER = ["gradient", "atmosphere", "space", "solid", "motion", "orbs"] as const;
export const GALLERY_LABELS: Record<string, string> = {
  gradient: "Gradient",
  atmosphere: "Atmosphere",
  space: "Space",
  solid: "3D & Glass",
  motion: "Motion",
  orbs: "Orbs",
  other: "Other",
};

export const PREVIEW_KINDS = new Set(["metal", "meshgradient", "particle"]);

export const importsById = new Map<string, ImportEntry>(
  (importsIndex as ImportEntry[]).map((e) => [e.id, e]),
);

export function effectsByGallery(): Array<{ id: string; label: string; effects: EffectSchema[] }> {
  return GALLERY_ORDER.map((id) => ({
    id,
    label: GALLERY_LABELS[id] ?? id,
    effects: effects.filter((e) => (e.gallery ?? "other") === id),
  }));
}

export function getEffect(id: string): EffectSchema | undefined {
  return effects.find((e) => e.id === id);
}
