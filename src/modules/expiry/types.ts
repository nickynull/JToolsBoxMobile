/** 分类定义。内置分类的 id 会写进数据，不可随意改名（旧备份靠它回显）。 */
export interface CategoryDef {
  id: string;
  label: string;
  color: string;
}

/** 内置分类：id 只用于数据兼容，界面文案走 label。 */
export const BUILTIN_CATEGORIES: CategoryDef[] = [
  { id: "food", label: "食品", color: "#E6A23C" },
  { id: "medicine", label: "药品", color: "#F56C6C" },
  { id: "cosmetic", label: "化妆品", color: "#D4537E" },
  { id: "document", label: "证件", color: "#409EFF" },
  { id: "other", label: "其他", color: "#909399" },
];

/** 自定义分类，随模块数据一起持久化在 data.json 的 categories 里。 */
export interface CustomCategory extends CategoryDef {
  createdAt: string;
}

/** 删除自定义分类时的兜底分类。 */
export const DEFAULT_CATEGORY = "other";

/** 自定义分类取色顺序，按未占用的颜色依次分配。 */
export const CUSTOM_CATEGORY_COLORS = [
  "#67C23A",
  "#9254DE",
  "#13C2C2",
  "#EB2F96",
  "#FA8C16",
  "#2F54EB",
  "#12B76A",
  "#F759AB",
];

/**
 * 分类取色板：分类管理里换颜色用（内置分类也能改）。
 * 都是中等明度的实色，深色模式下压在深底上仍然看得清。
 */
export const CATEGORY_PALETTE = [
  "#E6A23C",
  "#FA8C16",
  "#F56C6C",
  "#D4537E",
  "#EB2F96",
  "#F759AB",
  "#9254DE",
  "#2F54EB",
  "#409EFF",
  "#13C2C2",
  "#67C23A",
  "#12B76A",
];

/** 颜色合法性：只认 `#RRGGBB`，避免脏数据写进样式里 */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * 把用户输入的颜色规范成 `#RRGGBB`。
 * 容忍省略 `#` 与 3 位简写（`f00` → `#FF0000`），非法返回 null。
 */
export function normalizeHexColor(input: string): string | null {
  const text = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(text)) {
    return `#${text
      .split("")
      .map((char) => char + char)
      .join("")
      .toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(text)) {
    return `#${text.toUpperCase()}`;
  }
  return null;
}

/** 有效期单位：天 / 月 / 年 */
export type ShelfLifeUnit = "day" | "month" | "year";

/** 单件物品最多几张图片 */
export const MAX_IMAGES = 6;

/**
 * 物品图片。图片本体是模块目录下的真实文件（`images/<id>.jpg`），
 * `path` 是相对模块数据目录的路径，`data.json` 只存路径不存二进制。
 */
export interface ExpiryImage {
  id: string;
  /** 相对模块目录的路径，如 `images/img_abc.jpg` */
  path: string;
  addedAt: string;
  /** @deprecated v3 的内联 base64，加载时自动迁移成文件后清空 */
  data?: string;
}

export const SHELF_LIFE_UNITS: { value: ShelfLifeUnit; label: string }[] = [
  { value: "day", label: "天" },
  { value: "month", label: "月" },
  { value: "year", label: "年" },
];

export interface ExpiryItem {
  id: string;
  name: string;
  /** 分类 id，指向内置分类或自定义分类 */
  category: string;
  /** 生产日期，YYYY-MM-DD，选填 */
  productionDate: string;
  /** 有效期数值，0 表示未填 */
  shelfLife: number;
  shelfLifeUnit: ShelfLifeUnit;
  /** 到期日期，YYYY-MM-DD（由生产日期 + 有效期算出，或手动指定） */
  expireAt: string;
  /** 提前多少天提醒，如 [30, 7, 1, 0] */
  remindDays: number[];
  quantity: number;
  note: string;
  /** 最多 MAX_IMAGES 张，图片文件存在模块目录的 images/ 下，这里只存相对路径 */
  images: ExpiryImage[];
  /** 已推送过的提醒标记，形如 `2026-11-08:7`，避免同一天重复提醒 */
  notifiedKeys: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpiryData {
  version: number;
  items: ExpiryItem[];
  categories: CustomCategory[];
  /**
   * 内置分类的颜色覆盖，形如 `{ food: "#67C23A" }`。
   * 内置分类的定义是代码里的常量，改色只能记在这张表里。
   */
  categoryColors?: Record<string, string>;
}

export const REMIND_DAY_OPTIONS = [30, 15, 7, 3, 1, 0];

export function remindDayLabel(day: number): string {
  return day === 0 ? "当天" : `${day} 天前`;
}

export type ExpiryStatus = "expired" | "soon" | "month" | "normal";

export interface StatusMeta {
  key: ExpiryStatus;
  label: string;
  color: string;
}

export const STATUS_META: Record<ExpiryStatus, StatusMeta> = {
  expired: { key: "expired", label: "已过期", color: "#F56C6C" },
  soon: { key: "soon", label: "7 天内到期", color: "#E6A23C" },
  month: { key: "month", label: "30 天内到期", color: "#409EFF" },
  normal: { key: "normal", label: "正常", color: "#67C23A" },
};
