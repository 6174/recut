export class DependencyManager {
  dependencies: Map<string, Set<string>> = new Map();

  addDependency(blockId: string, dependsOnId: string) {
    if (!this.dependencies.has(blockId)) {
      this.dependencies.set(blockId, new Set());
    }
    this.dependencies.get(blockId)!.add(dependsOnId);
  }

  resolveDependencies(changedBlockIds: Set<string>): string[] {
    const resolved = new Set<string>();
    const toResolve = new Set(changedBlockIds);

    while (toResolve.size > 0) {
      for (const blockId of toResolve) {
        resolved.add(blockId);
        const dependents = this.dependencies.get(blockId) || new Set();
        for (const dependentId of dependents) {
          if (!resolved.has(dependentId)) {
            toResolve.add(dependentId);
          }
        }
        toResolve.delete(blockId);
      }
    }

    return Array.from(resolved);
  }
}