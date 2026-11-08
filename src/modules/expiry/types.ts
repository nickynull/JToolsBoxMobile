export type ExpiryCategory =
  | "food"
  | "medicine"
  | "cosmetic"
  | "document"
  | "other";

export interface ExpiryItem {
  id: string;
  name: string;
  category: ExpiryCategory;
  /** 到期日期，YYYY-MM-DD */
  expireAt: string;
  /** 提前多少天提醒，如 [30, 7, 1, 0] */
  remindDays: number[];
  quantity: number;
  note: string;
  /** 已推送过的提醒标记，形如 `2026-11-08:7`，避免同一天重复提醒 */
  notifiedKeys: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpiryData {
  version: number;
  items: ExpiryItem[];
}

export const CATEGORY_LABELS: Record<ExpiryCategory, string> = {
  food: "食品",
  medicine: "药品",
  cosmetic: "化妆品",
  document: "证件",
  other: "其他",
};

export const CATEGORY_COLORS: Record<ExpiryCategory, string> = {
  food: "#E6A23C",
  medicine: "#F56C6C",
  cosmetic: "#D4537E",
  document: "#409EFF",
  other: "#909399",
};

export const CATEGORY_OPTIONS = (
  Object.keys(CATEGORY_LABELS) as ExpiryCategory[]
).map((value) => ({ value, label: CATEGORY_LABELS[value] }));

export const REMIND_DAY_OPTIONS = [30, 15, 7, 3, 1, 0];

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
