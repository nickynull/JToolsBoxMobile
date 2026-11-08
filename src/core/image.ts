/**
 * 图片压缩：把用户拍摄 / 选择的照片缩放后转成 JPEG data URL。
 *
 * 这里产出的 data URL 只在编辑过程中当预览用，保存时由
 * `modules/expiry/images.ts` 写进模块目录的 `images/` 下，JSON 里只留相对路径。
 * 因此压缩的目标是「文件小、看着够清楚」：长边先缩到 1200，超预算继续降档，
 * 最差压到 640 / 0.55。
 */

export interface CompressedImage {
  /** `data:image/jpeg;base64,...` */
  data: string;
  width: number;
  height: number;
  /** 估算的二进制字节数（base64 按 3/4 折算） */
  bytes: number;
}

interface Attempt {
  maxEdge: number;
  quality: number;
  /** 单张允许的二进制上限 */
  budget: number;
}

const ATTEMPTS: Attempt[] = [
  { maxEdge: 1200, quality: 0.72, budget: 320 * 1024 },
  { maxEdge: 960, quality: 0.66, budget: 220 * 1024 },
  { maxEdge: 800, quality: 0.6, budget: 150 * 1024 },
  { maxEdge: 640, quality: 0.55, budget: 90 * 1024 },
];

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = url;
  });
}

/**
 * 压缩一张图片。抛错表示这张图无法解码（例如 WebView 不支持的 HEIC），
 * 由调用方决定是跳过还是提示用户。
 */
export async function compressImage(file: File | Blob): Promise<CompressedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
    if (!longEdge) {
      throw new Error("图片尺寸无效");
    }

    let last: CompressedImage = { data: "", width: 0, height: 0, bytes: 0 };
    for (const attempt of ATTEMPTS) {
      const scale = Math.min(1, attempt.maxEdge / longEdge);
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("无法创建画布");
      }
      // JPEG 没有透明通道，先铺白底，否则 PNG 的透明区域会变成黑色
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const data = canvas.toDataURL("image/jpeg", attempt.quality);
      last = { data, width, height, bytes: Math.round((data.length * 3) / 4) };
      if (last.bytes <= attempt.budget) {
        return last;
      }
    }
    // 已经压到最小一档仍超预算：直接用最差结果，避免无限递归
    return last;
  } finally {
    URL.revokeObjectURL(url);
  }
}
