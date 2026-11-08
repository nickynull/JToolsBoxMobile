import { daysUntil, todayISO } from "../../core/date";
import { settings } from "../../core/settings";
import { notify } from "../../core/notify";
import { activeItems, markNotified, reminderKey } from "./store";
import { scheduleInfo, startScheduler, syncScheduledReminders } from "./schedule";
import type { ExpiryItem } from "./types";

interface Hit {
  item: ExpiryItem;
  days: number;
  key: string;
}

/**
 * 扫描一次到期提醒。
 *
 * 触发条件：剩余天数命中该物品的提醒档位（如提前 30/7/1 天），
 * 且当天同一档位尚未提醒过。已过期物品不再重复提醒。
 *
 * 移动端一旦排上了系统闹钟（`scheduleInfo.active`），这里直接让位——
 * 否则系统弹一条、应用内再弹一条。
 */
export async function runReminderCheck(): Promise<number> {
  if (!settings.notifyEnabled) {
    return 0;
  }
  if (scheduleInfo.active) {
    return 0;
  }

  const today = todayISO();
  const hits: Hit[] = [];

  for (const item of activeItems.value) {
    const days = daysUntil(item.expireAt);
    if (Number.isNaN(days) || days < 0) {
      continue;
    }
    if (!item.remindDays.includes(days)) {
      continue;
    }
    const key = reminderKey(item, days, today);
    if (item.notifiedKeys.includes(key)) {
      continue;
    }
    hits.push({ item, days, key });
  }

  if (hits.length === 0) {
    return 0;
  }

  const detail =
    hits.length === 1
      ? `${hits[0].item.name} ${hits[0].days === 0 ? "今天到期" : `还有 ${hits[0].days} 天到期`}`
      : `${hits.length} 件物品即将到期，记得处理`;

  await notify("到期提醒", detail);
  await markNotified(hits.map((hit) => hit.key));
  return hits.length;
}

let timer: number | undefined;

/**
 * 启动提醒：先把未来的提醒排进系统闹钟，再开始前台轮询。
 *
 * 排程是主路径（移动端关掉应用也会响）；前台检查是桌面端与
 * 排程不可用时的兜底。
 */
export async function startReminderWatcher(): Promise<void> {
  startScheduler();

  await syncScheduledReminders();
  await runReminderCheck();

  window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (document.visibilityState === "visible") {
      void syncScheduledReminders();
      void runReminderCheck();
    }
  }, 30 * 60 * 1000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void syncScheduledReminders();
      void runReminderCheck();
    }
  });
}
