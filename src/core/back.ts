import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import type { Router } from "vue-router";
import { isTauri } from "./runtime";

/**
 * 系统返回键（Android 硬件 / 手势）语义。
 *
 * 这是**页签式**应用，不是浏览器：底栏只有「工具 / 设置」两个根，历史栈没有浏览器的
 * 「上一页」含义。所以按页面深度分两种行为：
 * - 有 `meta.back` 的深层页（新增 / 编辑…）→ 回上一级；
 * - 没有 `meta.back` 的根页面（首页、设置、各工具的入口页）→ 退出应用。
 *
 * 注册监听会接管系统的默认行为（默认是 WebView 历史回退），所以必须自己处理完。
 */

/** 仅 Android 支持返回键事件；桌面端注册了也永远收不到。 */
const hasBackButton = isTauri && /Android/i.test(navigator.userAgent);

/** 返回键该做什么：回上一级，还是退出应用。 */
export type BackAction = { kind: "back"; name: string } | { kind: "exit" };

/** 纯函数，便于单测与复用（顶栏返回按钮也可参考同一套判断）。 */
export function decideBack(meta: { back?: string }): BackAction {
  if (meta.back) {
    return { kind: "back", name: meta.back };
  }
  return { kind: "exit" };
}

/** 退出程序。Android 上是 finish Activity，桌面端是关闭窗口。 */
export async function quitApp(): Promise<void> {
  if (!isTauri) {
    return;
  }
  await exit(0);
}

/**
 * 有浮层（对话框 / 确认框）时先关浮层，不要直接退出。
 * Element Plus 的弹层都是 `.el-overlay`（关闭时 `display: none`），
 * 且内部用 document 上的 Escape keydown 做关闭，直接派发即可。
 */
function closeTopOverlay(): boolean {
  const opened = Array.from(
    document.querySelectorAll<HTMLElement>(".el-overlay"),
  ).filter((el) => getComputedStyle(el).display !== "none");
  if (opened.length === 0) {
    return false;
  }
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}

async function handleBack(router: Router): Promise<void> {
  if (closeTopOverlay()) {
    return;
  }
  const action = decideBack(router.currentRoute.value.meta);
  if (action.kind === "back") {
    await router.push({ name: action.name });
    return;
  }
  await quitApp();
}

/** 接管系统返回键；浏览器预览与桌面端直接跳过。 */
export async function installBackHandler(router: Router): Promise<void> {
  if (!hasBackButton) {
    return;
  }
  try {
    await onBackButtonPress(() => {
      void handleBack(router);
    });
  } catch (error) {
    console.error("[back] 注册返回键监听失败", error);
  }
}
