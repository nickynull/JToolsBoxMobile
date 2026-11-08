import { invoke } from "@tauri-apps/api/core";
import {
  cancel,
  isPermissionGranted,
  pending,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { reactive } from "vue";
import { isTauri } from "../runtime";

/**
 * 移动端判定。
 *
 * 通知插件的 `schedule` 只在 Android / iOS 生效（走 AlarmManager / UNUserNotificationCenter），
 * 桌面端会忽略排程参数、立即弹出，所以必须按平台分流，不能把排程当成跨平台能力。
 */
export const isMobileRuntime =
  isTauri && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** 一条待排入系统闹钟的提醒。 */
export interface ScheduledPlan {
  /** 32 位整数，插件用它作为 PendingIntent 的 requestCode，必须唯一 */
  id: number;
  /** 触发时刻，必须是未来时间 */
  at: Date;
  title: string;
  body: string;
  extra?: Record<string, unknown>;
}

/** 当前环境能否做到「关掉应用也会响」。 */
export function canScheduleInBackground(): boolean {
  return isMobileRuntime;
}

/** 排程概况，供设置页展示「闹钟到底排上了没有」。 */
export const notifyState = reactive({
  canSchedule: isMobileRuntime,
  /** 系统里待触发的提醒条数 */
  pending: 0,
  /** 最近一条待触发提醒的时刻（ISO） */
  nextAt: "",
});

/** 仅查询权限，绝不弹窗（同步排程时用）。 */
export async function hasNotifyPermission(): Promise<boolean> {
  if (!isTauri) {
    return false;
  }
  try {
    return await isPermissionGranted();
  } catch (error) {
    console.error("[notify] 查询权限失败", error);
    return false;
  }
}

/** 确保拥有通知权限；浏览器预览下恒为 false（改用应用内提示）。 */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (!isTauri) {
    return false;
  }
  try {
    if (await isPermissionGranted()) {
      return true;
    }
    return (await requestPermission()) === "granted";
  } catch (error) {
    console.error("[notify] 申请权限失败", error);
    return false;
  }
}

export async function notify(title: string, body: string): Promise<void> {
  if (!isTauri) {
    return;
  }
  try {
    sendNotification({ title, body });
  } catch (error) {
    console.error("[notify] 发送通知失败", error);
  }
}

/** 读取系统里尚未触发的排程 id。 */
export async function listPending(): Promise<number[]> {
  if (!isMobileRuntime) {
    return [];
  }
  try {
    const items = await pending();
    return items
      .map((item) => item.id)
      .filter((id): id is number => typeof id === "number");
  } catch (error) {
    console.error("[notify] 读取待发通知失败", error);
    return [];
  }
}

export async function cancelScheduled(ids: number[]): Promise<void> {
  if (!isMobileRuntime || ids.length === 0) {
    return;
  }
  try {
    await cancel(ids);
  } catch (error) {
    console.error("[notify] 取消排程失败", error);
  }
}

/**
 * 用一份完整计划替换系统里的待发提醒。
 *
 * 插件没有「按 id 查内容」的能力，改了标题或时间也无法原地更新，所以统一
 * 「先清空全部待发，再重建」——对同一份计划重复调用结果一致（幂等）。
 * 调用方需保证本应用只有一个排程来源，否则会互相清掉。
 *
 * 这里直接 invoke 而不走 `sendNotification`：后者是同步的 Web Notification 包装，
 * 错误只会变成未捕获的 Promise rejection（比如时间已过、权限被拒），没法逐条处理。
 */
export async function replaceScheduled(
  plans: ScheduledPlan[],
): Promise<number> {
  if (!isMobileRuntime) {
    return 0;
  }

  await cancelScheduled(await listPending());

  let scheduled = 0;
  for (const plan of plans) {
    try {
      await invoke("plugin:notification|notify", {
        options: {
          id: plan.id,
          title: plan.title,
          body: plan.body,
          extra: plan.extra,
          schedule: {
            at: {
              date: plan.at.toISOString(),
              repeating: false,
              allowWhileIdle: true,
            },
          },
        },
      });
      scheduled += 1;
    } catch (error) {
      console.error("[notify] 排程失败", plan.title, plan.at, error);
    }
  }

  notifyState.pending = scheduled;
  notifyState.nextAt = scheduled > 0 ? plans[0].at.toISOString() : "";
  return scheduled;
}
