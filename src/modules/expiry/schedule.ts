import { reactive, watch } from "vue";
import { addDays, daysUntil, isValidISODate } from "../../core/date";
import {
  canScheduleInBackground,
  hasNotifyPermission,
  notifyState,
  replaceScheduled,
  type ScheduledPlan,
} from "../../core/notify";
import { settings } from "../../core/settings";
import { expiryState, reminderKey } from "./store";
import type { ExpiryItem } from "./types";

/** 一次最多排入多少条，超出部分留给下次同步（按触发时间从近到远取） */
const MAX_PLANS = 60;
/** 与当前时间的最小间隔，插件会拒绝已过去的时间点 */
const MIN_LEAD_MS = 60_000;

export interface PlannedReminder extends ScheduledPlan {
  /** 去重键，与前台提醒共用同一套格式 */
  key: string;
  itemId: string;
}

interface Draft {
  key: string;
  itemId: string;
  at: Date;
  title: string;
  body: string;
}

/** 排程是否已接管提醒（移动端 + 权限齐备）。条数等展示信息在 `notifyState`。 */
export const scheduleInfo = reactive({
  active: false,
});

function readNotifyTime(): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(settings.notifyTime);
  if (!match) {
    return { hour: 9, minute: 0 };
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return { hour: 9, minute: 0 };
  }
  return { hour, minute };
}

/** 把 YYYY-MM-DD 与 HH:mm 组合成本地时间。 */
function atTimeOfDate(
  isoDate: string,
  time: { hour: number; minute: number },
): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    return null;
  }
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    time.hour,
    time.minute,
    0,
    0,
  );
}

function describe(item: ExpiryItem, days: number): string {
  const when =
    days === 0 ? "今天到期" : days === 1 ? "明天到期" : `还有 ${days} 天到期`;
  const count = item.quantity > 1 ? `（${item.quantity} 件）` : "";
  return `${item.name} ${when}${count}`;
}

/** 由去重键派生稳定的通知 id（FNV-1a），避免重复排程时产生孤立闹钟。 */
function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 1) % 2_000_000_000) + 1;
}

/**
 * 计算未来一段时间内所有需要系统闹钟的提醒。
 *
 * 纯函数：不读写存储、不碰通知接口，方便单独验证。
 * 已归档、已过期、时间点已过的档位都不排——补发会在下一次同步
 * 被「先清后建」取消，所以宁可漏掉当天补发，也不做会漂移的重排。
 */
export function buildReminderPlan(
  items: ExpiryItem[],
  now: Date = new Date(),
): PlannedReminder[] {
  const time = readNotifyTime();
  const drafts: Draft[] = [];

  for (const item of items) {
    if (item.archived || !isValidISODate(item.expireAt)) {
      continue;
    }
    const remaining = daysUntil(item.expireAt, now);
    if (Number.isNaN(remaining) || remaining < 0) {
      continue;
    }

    const levels = [...new Set(item.remindDays)].filter(
      (days) => Number.isFinite(days) && days >= 0,
    );

    for (const days of levels) {
      const fireDate = addDays(item.expireAt, -days);
      const fireAt = atTimeOfDate(fireDate, time);
      if (!fireAt || fireAt.getTime() - now.getTime() < MIN_LEAD_MS) {
        continue;
      }
      drafts.push({
        key: reminderKey(item, days, fireDate),
        itemId: item.id,
        at: fireAt,
        title: "到期提醒",
        body: describe(item, days),
      });
    }
  }

  drafts.sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key),
  );

  const used = new Set<number>();
  return drafts.slice(0, MAX_PLANS).map((draft) => {
    let id = hashKey(draft.key);
    while (used.has(id)) {
      id = id >= 2_000_000_000 ? 1 : id + 1;
    }
    used.add(id);
    return { ...draft, id };
  });
}

function resetInfo(): void {
  scheduleInfo.active = false;
  // 排程没接管时不要留下上一次的条数，设置页据此切换文案
  notifyState.pending = 0;
  notifyState.nextAt = "";
}

async function runSync(): Promise<void> {
  if (!canScheduleInBackground()) {
    resetInfo();
    return;
  }

  if (!settings.notifyEnabled) {
    // 关掉开关就把系统里已排的闹钟清干净
    await replaceScheduled([]);
    resetInfo();
    return;
  }

  if (!(await hasNotifyPermission())) {
    resetInfo();
    return;
  }

  await replaceScheduled(buildReminderPlan(expiryState.items));
  scheduleInfo.active = true;
}

let queue: Promise<void> = Promise.resolve();

/**
 * 重排系统闹钟（幂等）。
 *
 * 串行执行，避免连续改动数据时多次「清空 + 重建」交叉进行。
 */
export function syncScheduledReminders(): Promise<void> {
  queue = queue.then(
    () => runSync(),
    () => runSync(),
  );
  return queue;
}

let debounceTimer: number | undefined;

export function scheduleSyncSoon(delay = 1200): void {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    void syncScheduledReminders();
  }, delay);
}

let started = false;

/** 监听数据与设置变化，任何改动都会触发重排。 */
export function startScheduler(): void {
  if (started) {
    return;
  }
  started = true;

  watch(expiryState, () => scheduleSyncSoon(), { deep: true });
  watch(
    () => `${settings.notifyEnabled}|${settings.notifyTime}`,
    () => scheduleSyncSoon(0),
  );
}
