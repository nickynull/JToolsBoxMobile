import { appDataDir, dirname, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { isTauri } from "../runtime";

/**
 * 统一存储抽象。
 *
 * - Tauri 运行时：写入应用数据目录，按 key 的相对路径落到子目录
 * - 浏览器预览：降级到 localStorage（前缀 jtb:）
 *
 * key 使用正斜杠，形如 `modules/expiry/data.json`、`modules/expiry/images/img_x.jpg`。
 * 文本与二进制共用一套 key 空间：图片等媒体文件按 key 存放，`data.json` 里只记相对路径。
 */
export interface StorageDriver {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** 读二进制文件（图片等），不存在返回 null */
  readBytes(key: string): Promise<Uint8Array | null>;
  /** 写二进制文件，自动创建父目录 */
  writeBytes(key: string, value: Uint8Array): Promise<void>;
  /** 列出某前缀下的所有文件 key，不含 `.bak` / `.tmp` 中间产物 */
  list(prefix: string): Promise<string[]>;
  /** 递归删除某前缀下的所有内容 */
  clearDir(prefix: string): Promise<void>;
}

const WEB_PREFIX = "jtb:";

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
};

/** 按扩展名猜 MIME，用于把二进制还原成 data URL 或 Blob */
export function mimeOfKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function isTempKey(key: string): boolean {
  return key.endsWith(".bak") || key.endsWith(".tmp");
}

function bytesToBinary(bytes: Uint8Array): string {
  let out = "";
  // 分块拼字符串：一次性展开几十万个参数会爆栈（移动端 WebView 更保守）
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

function binaryToBytes(binary: string): Uint8Array {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

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
  async readBytes(key) {
    const raw = localStorage.getItem(WEB_PREFIX + key);
    if (raw === null) {
      return null;
    }
    // 浏览器里媒体文件存成 data URL 文本，与真实文件一一对应
    if (raw.startsWith("data:")) {
      const comma = raw.indexOf(",");
      const base64 = comma >= 0 ? raw.slice(comma + 1) : "";
      try {
        return binaryToBytes(atob(base64));
      } catch {
        return null;
      }
    }
    return new TextEncoder().encode(raw);
  },
  async writeBytes(key, value) {
    const dataUrl = `data:${mimeOfKey(key)};base64,${btoa(bytesToBinary(value))}`;
    localStorage.setItem(WEB_PREFIX + key, dataUrl);
  },
  async list(prefix) {
    const head = WEB_PREFIX + prefix.replace(/\/+$/, "") + "/";
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(head)) {
        const relative = key.slice(WEB_PREFIX.length);
        if (!isTempKey(relative)) {
          keys.push(relative);
        }
      }
    }
    return keys;
  },
  async clearDir(prefix) {
    const keys = await webDriver.list(prefix);
    for (const key of keys) {
      localStorage.removeItem(WEB_PREFIX + key);
    }
  },
};

async function resolve(key: string): Promise<string> {
  return join(await appDataDir(), key);
}

/** 递归收集目录下的文件 key（相对应用数据目录） */
async function walk(dirPath: string, keyPrefix: string, out: string[]): Promise<void> {
  let entries: Awaited<ReturnType<typeof readDir>>;
  try {
    entries = await readDir(dirPath);
  } catch {
    // 目录不存在：视为空
    return;
  }
  for (const entry of entries) {
    const childPath = await join(dirPath, entry.name);
    const childKey = `${keyPrefix}${entry.name}`;
    if (entry.isDirectory) {
      await walk(childPath, `${childKey}/`, out);
    } else if (entry.isFile && !isTempKey(childKey)) {
      out.push(childKey);
    }
  }
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

  async readBytes(key) {
    const path = await resolve(key);
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  },

  async writeBytes(key, value) {
    const path = await resolve(key);
    await mkdir(await dirname(path), { recursive: true });
    await writeFile(path, value);
  },

  async list(prefix) {
    const dirPath = await resolve(prefix.replace(/\/+$/, ""));
    const out: string[] = [];
    await walk(dirPath, `${prefix.replace(/\/+$/, "")}/`, out);
    return out;
  },

  async clearDir(prefix) {
    const dirPath = await resolve(prefix.replace(/\/+$/, ""));
    if (await exists(dirPath)) {
      await remove(dirPath, { recursive: true });
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
