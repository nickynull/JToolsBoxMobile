import { isTauri } from "../runtime";
import { mimeOfKey, storage } from "./driver";

/**
 * 媒体文件读写。
 *
 * 图片不再内联进 JSON，而是按 key 存成真实文件（Tauri）或 data URL 文本（浏览器预览），
 * JSON 里只保留相对路径。这样做的好处是 `data.json` 保持可读、备份包里是真正的图片文件。
 */

/** 拆出 data URL 的 MIME 与二进制内容 */
export function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+)(?:;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    return null;
  }
  const [, mime, payload] = match;
  try {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { mime, bytes };
  } catch {
    return null;
  }
}

/** 把 data URL 写到 key 对应的文件 */
export async function writeMedia(key: string, dataUrl: string): Promise<void> {
  const decoded = dataUrlToBytes(dataUrl);
  if (!decoded) {
    throw new Error("图片数据无效");
  }
  await storage.writeBytes(key, decoded.bytes);
}

/**
 * 取可给 `<img src>` 用的地址。
 *
 * - Tauri：读文件字节 → Blob URL（用完要 releaseMediaUrl）
 * - 浏览器：直接就是 data URL 文本
 */
export async function readMediaUrl(key: string): Promise<string | null> {
  if (!isTauri) {
    const raw = await storage.read(key);
    return raw && raw.startsWith("data:") ? raw : null;
  }
  const bytes = await storage.readBytes(key);
  if (!bytes) {
    return null;
  }
  return URL.createObjectURL(new Blob([bytes.slice()], { type: mimeOfKey(key) }));
}

/** 释放 Blob URL；data URL 无需处理 */
export function releaseMediaUrl(url: string | null | undefined): void {
  if (url && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}
