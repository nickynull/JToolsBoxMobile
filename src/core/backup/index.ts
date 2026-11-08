import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "../runtime";
import { storage } from "../storage/driver";
import { applyTheme, settings } from "../settings";
import { getModules } from "../module/registry";
import { todayISO } from "../date";
import { APP_NAME, APP_VERSION, BACKUP_EXT, BACKUP_SCHEMA } from "../version";

export interface BackupManifest {
  app: string;
  schema: number;
  appVersion: string;
  exportedAt: string;
  modules: string[];
  includeSettings: boolean;
}

export interface BackupPayload {
  fileName: string;
  manifest: BackupManifest;
  files: Record<string, Uint8Array>;
}

export type ImportMode = "replace" | "merge";

export const moduleDataKey = (id: string) => `modules/${id}/data.json`;

const MANIFEST_KEY = "manifest.json";
const SETTINGS_KEY = "settings.json";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasId(value: unknown): boolean {
  return isPlainObject(value) && typeof value.id === "string";
}

/** 通用合并：对象逐键递归，带 id 的数组按 id 覆盖，其余以新数据为准。 */
export function mergeValue(base: unknown, incoming: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(incoming)) {
    if (base.length > 0 && incoming.length > 0 && base.every(hasId) && incoming.every(hasId)) {
      const map = new Map<string, unknown>();
      for (const item of base) {
        map.set((item as { id: string }).id, item);
      }
      for (const item of incoming) {
        map.set((item as { id: string }).id, item);
      }
      return [...map.values()];
    }
    return incoming;
  }
  if (isPlainObject(base) && isPlainObject(incoming)) {
    const merged: Record<string, unknown> = { ...base };
    for (const key of Object.keys(incoming)) {
      merged[key] = mergeValue(base[key], incoming[key]);
    }
    return merged;
  }
  return incoming;
}

async function saveBytes(name: string, bytes: Uint8Array): Promise<boolean> {
  if (!isTauri) {
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // 立即 revoke 会让部分浏览器取消下载
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  }

  const path = await save({
    defaultPath: name,
    filters: [{ name: `${APP_NAME} 备份`, extensions: [BACKUP_EXT] }],
  });
  if (!path) {
    return false;
  }
  await writeFile(path, bytes);
  return true;
}

export async function exportBackup(scope: "all" | string[]): Promise<boolean> {
  const all = scope === "all";
  const ids = all ? getModules().map((item) => item.id) : scope;

  const files: Record<string, Uint8Array> = {};
  for (const id of ids) {
    const raw = await storage.read(moduleDataKey(id));
    files[moduleDataKey(id)] = strToU8(raw ?? JSON.stringify({ version: 1, items: [] }));
  }

  if (all) {
    files[SETTINGS_KEY] = strToU8(JSON.stringify(settings, null, 2));
  }

  const manifest: BackupManifest = {
    app: APP_NAME,
    schema: BACKUP_SCHEMA,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    modules: ids,
    includeSettings: all,
  };
  files[MANIFEST_KEY] = strToU8(JSON.stringify(manifest, null, 2));

  const zipped = zipSync(files, { level: 6 });
  const suffix = all ? "all" : ids.join("-");
  return saveBytes(`${APP_NAME}-${suffix}-${todayISO()}.${BACKUP_EXT}`, zipped);
}

async function pickFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (!isTauri) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = `.${BACKUP_EXT},.zip`;
      input.style.display = "none";
      // 部分 WebView 只对已挂载的 input 响应点击
      document.body.appendChild(input);
      input.onchange = async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) {
          resolve(null);
          return;
        }
        resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      };
      input.click();
    });
  }

  const path = await open({
    multiple: false,
    filters: [{ name: `${APP_NAME} 备份`, extensions: [BACKUP_EXT, "zip"] }],
  });
  if (!path || typeof path !== "string") {
    return null;
  }
  const bytes = await readFile(path);
  const name = path.split(/[\\/]/).pop() ?? `backup.${BACKUP_EXT}`;
  return { name, bytes };
}

/** 选择并解析备份文件，返回清单供界面确认。 */
export async function readBackup(): Promise<BackupPayload | null> {
  const picked = await pickFile();
  if (!picked) {
    return null;
  }

  const files = unzipSync(picked.bytes);
  const raw = files[MANIFEST_KEY];
  if (!raw) {
    throw new Error("备份文件缺少 manifest.json，可能不是 JToolsBox 备份");
  }
  const manifest = JSON.parse(strFromU8(raw)) as BackupManifest;
  if (manifest.app !== APP_NAME) {
    throw new Error("备份来源不是 JToolsBox");
  }
  return { fileName: picked.name, manifest, files };
}

export async function applyBackup(
  payload: BackupPayload,
  mode: ImportMode,
): Promise<{ modules: string[]; settingsApplied: boolean }> {
  const applied: string[] = [];
  let settingsApplied = false;

  for (const [key, bytes] of Object.entries(payload.files)) {
    if (key === MANIFEST_KEY) {
      continue;
    }

    const incoming = strFromU8(bytes);

    if (key === SETTINGS_KEY) {
      const parsed = JSON.parse(incoming) as Record<string, unknown>;
      const current = settings as unknown as Record<string, unknown>;
      const next =
        mode === "merge"
          ? (mergeValue(current, parsed) as Record<string, unknown>)
          : parsed;
      Object.assign(settings, next);
      // 旧备份可能没有 notifyTime，或被改坏；排程依赖它，兜底回默认值
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.notifyTime)) {
        settings.notifyTime = "09:00";
      }
      // 导入的主题/偏好需要立刻反映到界面
      applyTheme();
      settingsApplied = true;
      continue;
    }

    if (!key.startsWith("modules/") || !key.endsWith("/data.json")) {
      continue;
    }

    if (mode === "merge") {
      const existing = await storage.read(key);
      if (existing) {
        try {
          const merged = mergeValue(JSON.parse(existing), JSON.parse(incoming));
          await storage.write(key, JSON.stringify(merged, null, 2));
          applied.push(key);
          continue;
        } catch {
          // 解析失败时退化为直接覆盖
        }
      }
    }

    await storage.write(key, incoming);
    applied.push(key);
  }

  // 让各模块重新读取刚写入的数据
  for (const module of getModules()) {
    await module.preload?.();
  }

  return {
    modules: applied
      .map((key) => key.split("/")[1])
      .filter((id): id is string => typeof id === "string"),
    settingsApplied,
  };
}
