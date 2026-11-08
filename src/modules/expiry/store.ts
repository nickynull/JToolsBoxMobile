import { computed, reactive } from "vue";
import { readJson, writeJson } from "../../core/storage/driver";
import { uid } from "../../core/id";
import { addDays, addMonths, daysUntil, isValidISODate } from "../../core/date";
import { normalizeImagePath, removeImages, saveImage } from "./images";
import {
  BUILTIN_CATEGORIES,
  CUSTOM_CATEGORY_COLORS,
  DEFAULT_CATEGORY,
  MAX_IMAGES,
  type CategoryDef,
  type CustomCategory,
  type ExpiryData,
  type ExpiryImage,
  type ExpiryItem,
  type ExpiryStatus,
  type ShelfLifeUnit,
} from "./types";

const KEY = "modules/expiry/data.json";
/** v4：图片从内联 base64 改为模块目录下的图片文件 + 相对路径 */
const DATA_VERSION = 4;

interface ExpiryState {
  items: ExpiryItem[];
  categories: CustomCategory[];
  loaded: boolean;
}

export const expiryState = reactive<ExpiryState>({
  items: [],
  categories: [],
  loaded: false,
});

/** 内置 + 自定义，供筛选、编辑页下拉共同使用。 */
export const categoryOptions = computed<CategoryDef[]>(() => [
  ...BUILTIN_CATEGORIES,
  ...expiryState.categories,
]);

const categoryMap = computed(
  () => new Map(categoryOptions.value.map((item) => [item.id, item])),
);

export function categoryLabelOf(id: string): string {
  return categoryMap.value.get(id)?.label ?? id;
}

export function categoryColorOf(id: string): string {
  return categoryMap.value.get(id)?.color ?? "#909399";
}

/** 未归档物品，按到期日期升序。 */
export const activeItems = computed(() =>
  expiryState.items
    .filter((item) => !item.archived)
    .slice()
    .sort((a, b) => a.expireAt.localeCompare(b.expireAt)),
);

export function statusOf(item: ExpiryItem): ExpiryStatus {
  const days = daysUntil(item.expireAt);
  if (Number.isNaN(days)) {
    return "normal";
  }
  if (days < 0) {
    return "expired";
  }
  if (days <= 7) {
    return "soon";
  }
  if (days <= 30) {
    return "month";
  }
  return "normal";
}

/** 30 天内（含已过期）待处理的条数，用于首页角标。 */
export const alertCount = computed(
  () => activeItems.value.filter((item) => statusOf(item) !== "normal").length,
);

/**
 * 由生产日期 + 有效期推算到期日期，条件不足时返回空串。
 *
 * 纯函数：编辑页的实时预览与保存都走它，保证展示和落库一致。
 */
export function computeExpireAt(
  productionDate: string,
  amount: number,
  unit: ShelfLifeUnit,
): string {
  if (!isValidISODate(productionDate) || !Number.isFinite(amount) || amount <= 0) {
    return "";
  }
  const span = Math.floor(amount);
  if (unit === "day") {
    return addDays(productionDate, span);
  }
  return addMonths(productionDate, unit === "year" ? span * 12 : span);
}

function normalizeImage(raw: Partial<ExpiryImage>): ExpiryImage | null {
  if (!raw) {
    return null;
  }
  const path = normalizeImagePath(raw.path);
  // v3 的内联图片：先留着 data，loadExpiry 里迁移成文件
  const legacy =
    typeof raw.data === "string" && raw.data.startsWith("data:image/") ? raw.data : undefined;
  if (!path && !legacy) {
    return null;
  }
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `img_${uid()}`,
    path,
    addedAt: raw.addedAt ?? new Date().toISOString(),
    ...(legacy ? { data: legacy } : {}),
  };
}

function normalizeItem(raw: Partial<ExpiryItem>): ExpiryItem | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string") {
    return null;
  }
  const unit: ShelfLifeUnit =
    raw.shelfLifeUnit === "day" ||
    raw.shelfLifeUnit === "month" ||
    raw.shelfLifeUnit === "year"
      ? raw.shelfLifeUnit
      : "month";
  const images = Array.isArray(raw.images) ? raw.images : [];
  return {
    id: raw.id,
    name: raw.name,
    category: typeof raw.category === "string" ? raw.category : DEFAULT_CATEGORY,
    productionDate:
      typeof raw.productionDate === "string" ? raw.productionDate : "",
    shelfLife: typeof raw.shelfLife === "number" ? raw.shelfLife : 0,
    shelfLifeUnit: unit,
    expireAt: raw.expireAt ?? "",
    remindDays: Array.isArray(raw.remindDays) ? raw.remindDays : [30, 7, 1, 0],
    quantity: typeof raw.quantity === "number" ? raw.quantity : 1,
    note: typeof raw.note === "string" ? raw.note : "",
    images: images
      .map((image) => normalizeImage(image))
      .filter((image): image is ExpiryImage => image !== null)
      .slice(0, MAX_IMAGES),
    notifiedKeys: Array.isArray(raw.notifiedKeys) ? raw.notifiedKeys : [],
    archived: raw.archived === true,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

function normalizeCategory(raw: Partial<CustomCategory>): CustomCategory | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.label !== "string") {
    return null;
  }
  const label = raw.label.trim();
  if (!label) {
    return null;
  }
  return {
    id: raw.id,
    label,
    color: typeof raw.color === "string" && raw.color ? raw.color : "#909399",
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

/**
 * 把 v3 的内联 base64 图片迁移成文件，同时丢掉读不出内容的脏图片。
 * 返回是否有改动（有则调用方补一次落盘）。
 */
async function migrateInlineImages(items: ExpiryItem[]): Promise<boolean> {
  let changed = false;
  for (const item of items) {
    const kept: ExpiryImage[] = [];
    for (const image of item.images) {
      if (image.path) {
        kept.push(image);
        continue;
      }
      if (!image.data) {
        changed = true;
        continue;
      }
      try {
        image.path = await saveImage(image.data, image.id);
        delete image.data;
        kept.push(image);
        changed = true;
      } catch (error) {
        // 写文件失败就放弃这张图，避免 JSON 里继续背着几十 KB 的 base64
        console.warn("[expiry] 内联图片迁移失败", error);
        changed = true;
      }
    }
    if (kept.length !== item.images.length) {
      changed = true;
    }
    item.images = kept;
  }
  return changed;
}

export async function loadExpiry(): Promise<void> {
  const stored = await readJson<ExpiryData>(KEY).catch(() => null);
  const items = Array.isArray(stored?.items) ? stored.items : [];
  const categories = Array.isArray(stored?.categories) ? stored.categories : [];
  const normalized = items
    .map((item) => normalizeItem(item))
    .filter((item): item is ExpiryItem => item !== null);
  const migrated = await migrateInlineImages(normalized);
  expiryState.items = normalized;
  expiryState.categories = categories
    .map((item) => normalizeCategory(item))
    .filter((item): item is CustomCategory => item !== null);
  expiryState.loaded = true;
  if (migrated) {
    await persistExpiry();
  }
}

export async function persistExpiry(): Promise<void> {
  await writeJson(KEY, {
    version: DATA_VERSION,
    items: expiryState.items,
    categories: expiryState.categories,
  });
}

export function getItem(id: string): ExpiryItem | undefined {
  return expiryState.items.find((item) => item.id === id);
}

/** 该分类下已归档 + 未归档的物品数，用于阻止删除仍在使用的分类。 */
export function categoryUsage(id: string): number {
  return expiryState.items.filter((item) => item.category === id).length;
}

/** 新增自定义分类；重名（含内置）返回 null。 */
export async function addCategory(label: string): Promise<CustomCategory | null> {
  const name = label.trim();
  if (!name) {
    return null;
  }
  const lower = name.toLowerCase();
  const duplicated = categoryOptions.value.some(
    (item) => item.label.toLowerCase() === lower,
  );
  if (duplicated) {
    return null;
  }
  const used = new Set(categoryOptions.value.map((item) => item.color));
  const color =
    CUSTOM_CATEGORY_COLORS.find((item) => !used.has(item)) ??
    CUSTOM_CATEGORY_COLORS[expiryState.categories.length % CUSTOM_CATEGORY_COLORS.length];
  const category: CustomCategory = {
    id: `c_${uid()}`,
    label: name,
    color,
    createdAt: new Date().toISOString(),
  };
  expiryState.categories.push(category);
  await persistExpiry();
  return category;
}

/** 删除自定义分类；分类下还有物品时拒绝，避免数据变成孤儿。 */
export async function removeCategory(id: string): Promise<boolean> {
  if (categoryUsage(id) > 0) {
    return false;
  }
  const next = expiryState.categories.filter((item) => item.id !== id);
  if (next.length === expiryState.categories.length) {
    return false;
  }
  expiryState.categories = next;
  await persistExpiry();
  return true;
}

export async function createItem(
  input: Omit<
    ExpiryItem,
    "id" | "createdAt" | "updatedAt" | "notifiedKeys" | "archived"
  >,
): Promise<ExpiryItem> {
  const now = new Date().toISOString();
  const item: ExpiryItem = {
    ...input,
    id: uid(),
    notifiedKeys: [],
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  expiryState.items.push(item);
  await persistExpiry();
  return item;
}

export async function updateItem(
  id: string,
  patch: Partial<Omit<ExpiryItem, "id" | "createdAt">>,
): Promise<void> {
  const item = getItem(id);
  if (!item) {
    return;
  }
  const expireChanged =
    typeof patch.expireAt === "string" && patch.expireAt !== item.expireAt;
  Object.assign(item, patch, {
    updatedAt: new Date().toISOString(),
    // 日期变了就重置提醒记录，让新周期的提醒能正常触发
    ...(expireChanged ? { notifiedKeys: [] } : {}),
  });
  await persistExpiry();
}

export async function removeItem(id: string): Promise<void> {
  const target = getItem(id);
  expiryState.items = expiryState.items.filter((item) => item.id !== id);
  await persistExpiry();
  if (target) {
    await removeImages(target.images.map((image) => image.path));
  }
}

/** 批量删除：只写一次存储，避免逐条删除时反复落盘。 */
export async function removeItems(ids: string[]): Promise<number> {
  const drop = new Set(ids);
  if (drop.size === 0) {
    return 0;
  }
  const before = expiryState.items.length;
  const removedItems = expiryState.items.filter((item) => drop.has(item.id));
  expiryState.items = expiryState.items.filter((item) => !drop.has(item.id));
  const removed = before - expiryState.items.length;
  if (removed > 0) {
    await persistExpiry();
    // JSON 已经不再引用这些图片，最后再删文件（删失败只是留下孤儿，不至于丢记录）
    await removeImages(
      removedItems.flatMap((item) => item.images.map((image) => image.path)),
    );
  }
  return removed;
}

export async function clearItems(): Promise<void> {
  const paths = expiryState.items.flatMap((item) =>
    item.images.map((image) => image.path),
  );
  expiryState.items = [];
  await persistExpiry();
  await removeImages(paths);
}

/** 提醒去重标记：同一天同一档位只提醒一次。 */
export function reminderKey(item: ExpiryItem, days: number, date: string): string {
  return `${date}:${item.id}:${days}`;
}

export async function markNotified(keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }
  const set = new Set(keys);
  for (const item of expiryState.items) {
    const mine = [...set]
      .filter((key) => key.includes(`:${item.id}:`))
      .filter((key) => !item.notifiedKeys.includes(key));
    if (mine.length > 0) {
      item.notifiedKeys.push(...mine);
    }
  }
  await persistExpiry();
}
