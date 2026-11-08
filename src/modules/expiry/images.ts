import { releaseMediaUrl, readMediaUrl, writeMedia } from "../../core/storage/media";
import { storage } from "../../core/storage/driver";

/**
 * 物品图片的落盘约定。
 *
 * - 文件位置：`modules/expiry/images/<imageId>.jpg`
 * - `data.json` 里存**相对模块目录**的路径（`images/img_xxx.jpg`），
 *   这样模块目录整体（含图片）可以原样打包进备份、换设备后路径依然有效。
 */

/** 模块数据目录，相对应用数据目录 */
export const MODULE_DIR = "modules/expiry";

const IMAGE_DIR = "images";
const ALLOWED_EXT = /\.(jpe?g|png|webp|gif)$/i;

/** 相对路径 → 存储 key */
export function imageKey(path: string): string {
  return `${MODULE_DIR}/${path}`;
}

/** 新图片的存放路径（id 里的异常字符一律去掉，避免拼出目录穿越的路径） */
export function newImagePath(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, "");
  return `${IMAGE_DIR}/${safe || `img_${Date.now().toString(36)}`}.jpg`;
}

/**
 * 校验并规范 data.json 里读到的路径：只接受模块内的图片相对路径，
 * 拒绝 `..`、绝对路径、非图片扩展名，避免备份被改坏后写到模块目录之外。
 */
export function normalizeImagePath(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  const value = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!value || value.includes("..") || !ALLOWED_EXT.test(value)) {
    return "";
  }
  return value;
}

/** 把 data URL 写成图片文件，返回相对路径 */
export async function saveImage(dataUrl: string, id: string): Promise<string> {
  const path = newImagePath(id);
  await writeMedia(imageKey(path), dataUrl);
  return path;
}

/** 取图片的可展示地址（Tauri 下是 Blob URL，用完需 releaseImageUrl） */
export async function readImageSrc(path: string): Promise<string | null> {
  const normalized = normalizeImagePath(path);
  if (!normalized) {
    return null;
  }
  return readMediaUrl(imageKey(normalized));
}

export const releaseImageUrl = releaseMediaUrl;

/** 删除图片文件；失败只记日志，不阻断主流程（最坏留下孤儿文件） */
export async function removeImages(paths: string[]): Promise<void> {
  const targets = paths.map(normalizeImagePath).filter((path) => path !== "");
  await Promise.all(
    targets.map((path) =>
      storage.remove(imageKey(path)).catch((error: unknown) => {
        console.warn("[expiry] 删除图片失败", path, error);
      }),
    ),
  );
}
