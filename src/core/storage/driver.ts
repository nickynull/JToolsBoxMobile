import { appDataDir, dirname, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { isTauri } from "../runtime";

/**
 * 统一存储抽象。
 *
 * - Tauri 运行时：写入应用数据目录，按 key 的相对路径落到子目录
 * - 浏览器预览：降级到 localStorage（前缀 jtb:）
 *
 * key 使用正斜杠，形如 `modules/expiry/data.json`。
 */
export interface StorageDriver {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const WEB_PREFIX = "jtb:";

const webDriver: StorageDriver = {
  async read(key) {
    return localStorage.getItem(WEB_PREFIX + key);
  },
  async write(key, value) {
    localStorage.setItem(WEB_PREFIX + key, value);
  },
  async remove(key) {
    localStorage.removeItem(WEB_PREFIX + key);
  },
};

async function resolve(key: string): Promise<string> {
  return join(await appDataDir(), key);
}

const tauriDriver: StorageDriver = {
  async read(key) {
    const path = await resolve(key);
    try {
      return await readTextFile(path);
    } catch {
      // 主文件损坏时回退到上一次成功写入的副本
      try {
        return await readTextFile(`${path}.bak`);
      } catch {
        return null;
      }
    }
  },

  async write(key, value) {
    const path = await resolve(key);
    await mkdir(await dirname(path), { recursive: true });

    if (await exists(path)) {
      try {
        await writeTextFile(`${path}.bak`, await readTextFile(path));
      } catch {
        // 备份失败不阻断主写入
      }
    }

    const tmp = `${path}.tmp`;
    await writeTextFile(tmp, value);
    if (await exists(path)) {
      await remove(path);
    }
    await rename(tmp, path);
  },

  async remove(key) {
    const path = await resolve(key);
    for (const target of [path, `${path}.bak`]) {
      if (await exists(target)) {
        await remove(target);
      }
    }
  },
};

export const storage: StorageDriver = isTauri ? tauriDriver : webDriver;

export async function readJson<T>(key: string): Promise<T | null> {
  const raw = await storage.read(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`[storage] 解析 ${key} 失败`, error);
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await storage.write(key, JSON.stringify(value, null, 2));
}
