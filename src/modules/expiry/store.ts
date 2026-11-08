import { computed, reactive } from "vue";
import { readJson, writeJson } from "../../core/storage/driver";
import { uid } from "../../core/id";
import { daysUntil } from "../../core/date";
import type { ExpiryData, ExpiryItem, ExpiryStatus } from "./types";

const KEY = "modules/expiry/data.json";
const DATA_VERSION = 1;

interface ExpiryState {
  items: ExpiryItem[];
  loaded: boolean;
}

export const expiryState = reactive<ExpiryState>({ items: [], loaded: false });

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

function normalize(raw: Partial<ExpiryItem>): ExpiryItem | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string") {
    return null;
  }
  return {
    id: raw.id,
    name: raw.name,
    category: raw.category ?? "other",
    expireAt: raw.expireAt ?? "",
    remindDays: Array.isArray(raw.remindDays) ? raw.remindDays : [30, 7, 1, 0],
    quantity: typeof raw.quantity === "number" ? raw.quantity : 1,
    note: typeof raw.note === "string" ? raw.note : "",
    notifiedKeys: Array.isArray(raw.notifiedKeys) ? raw.notifiedKeys : [],
    archived: raw.archived === true,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

export async function loadExpiry(): Promise<void> {
  const stored = await readJson<ExpiryData>(KEY).catch(() => null);
  const items = Array.isArray(stored?.items) ? stored.items : [];
  expiryState.items = items
    .map((item) => normalize(item))
    .filter((item): item is ExpiryItem => item !== null);
  expiryState.loaded = true;
}

export async function persistExpiry(): Promise<void> {
  await writeJson(KEY, { version: DATA_VERSION, items: expiryState.items });
}

export function getItem(id: string): ExpiryItem | undefined {
  return expiryState.items.find((item) => item.id === id);
}

export async function createItem(
  input: Omit<ExpiryItem, "id" | "createdAt" | "updatedAt" | "notifiedKeys" | "archived">,
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
  expiryState.items = expiryState.items.filter((item) => item.id !== id);
  await persistExpiry();
}

export async function clearItems(): Promise<void> {
  expiryState.items = [];
  await persistExpiry();
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
