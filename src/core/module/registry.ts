import type { ToolModule } from "./types";

const registry = new Map<string, ToolModule>();

export function registerModule(module: ToolModule): void {
  if (registry.has(module.id)) {
    console.warn(`[module] 重复注册：${module.id}`);
    return;
  }
  registry.set(module.id, module);
}

export function getModules(): ToolModule[] {
  return [...registry.values()];
}

export function getModule(id: string | undefined | null): ToolModule | undefined {
  return id ? registry.get(id) : undefined;
}
