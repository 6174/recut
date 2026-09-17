// Central loader for effect WGSL sources (vite ?raw glob).

const moduleCache = new Map<string, Promise<string>>();

const wgslModules = import.meta.glob("../catalog/wgsl/*.wgsl", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

export function loadEffectSource(id: string): Promise<string> {
  let entry = moduleCache.get(id);
  if (!entry) {
    const key = Object.keys(wgslModules).find((k) => k.endsWith(`/wgsl/${id}.wgsl`));
    if (!key) return Promise.reject(new Error(`找不到 WGSL: ${id}`));
    entry = wgslModules[key]();
    moduleCache.set(id, entry);
  }
  return entry;
}
