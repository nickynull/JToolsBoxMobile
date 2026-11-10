import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import { ElMessage } from "element-plus";
import type { Router } from "vue-router";
import { isTauri } from "./runtime";

/**
 * 系统返回键（Android 硬件 / 手势）语义。
 *
 * 这是**页签式**应用，不是浏览器：底栏只有「主页 / 工具 / 设置」几个根，历史栈没有
 * 浏览器的「上一页」含义。所以按页面深度分两种行为：
 * - 有 `meta.back` 的深层页（新增 / 编辑…）→ 回上一级；
 * - 没有 `meta.back` 的根页面（主页、设置、各工具的入口页）→ 提示「再按一次退出」，
 *   短时间内再次按返回才真正退出（防误触，Android 常见做法）。
 *
 * 完整优先级：系统浮层 → `registerBackInterceptor` 注册的页面态（多选 / 侧滑展开）
 * → 路由回退 → 双击退出确认。页面内有临时状态时必须先消费返回，贴近 Android 习惯。
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

/** 双击退出的确认窗口：在这个时间内第二次按返回才真正退出 */
const EXIT_CONFIRM_MS = 2000;
/** 上一次「再按一次退出」提示的时刻；0 表示当前没有待确认的退出 */
let exitPromptAt = 0;

/** 返回被「消费」（关浮层 / 退页面态 / 路由回退）后，退出确认重新计数 */
function resetExitPrompt(): void {
  exitPromptAt = 0;
}

async function handleBack(router: Router): Promise<void> {
  if (closeTopOverlay()) {
    resetExitPrompt();
    return;
  }
  // 页面态优先于路由：多选模式、侧滑展开这类「页面内状态」要先逐层退出，
  // 这才是 Android 用户对返回手势的预期，绝不能在多选时直接把应用退掉。
  for (const interceptor of interceptors) {
    if (interceptor()) {
      resetExitPrompt();
      return;
    }
  }
  const action = decideBack(router.currentRoute.value.meta);
  if (action.kind === "back") {
    resetExitPrompt();
    await router.push({ name: action.name });
    return;
  }
  // 根页面：第一次提示，窗口内再按一次才退出，避免误触手势直接丢掉应用
  const now = Date.now();
  if (exitPromptAt > 0 && now - exitPromptAt < EXIT_CONFIRM_MS) {
    await quitApp();
    return;
  }
  exitPromptAt = now;
  ElMessage({
    message: "再按一次退出应用",
    duration: EXIT_CONFIRM_MS,
    // 别打断用户：第二次返回不应被这条提示挡住手势
    showClose: false,
    grouping: true,
  });
}

type BackInterceptor = () => boolean;

const interceptors = new Set<BackInterceptor>();

/**
 * 注册页面级返回拦截：返回 `true` 表示本次返回已被消费（如退出多选、收起侧滑），
 * 不会再走路由 / 退出逻辑。组件在 `onBeforeUnmount` 里调用返回的函数注销。
 *
 * 优先级：系统浮层（closeTopOverlay）→ 这里 → 路由回退 → 退出应用。
 */
export function registerBackInterceptor(fn: BackInterceptor): () => void {
  interceptors.add(fn);
  return () => {
    interceptors.delete(fn);
  };
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
    // 换了页面就重新计数：提示过后切到别的页，再按返回仍要重新提示
    router.afterEach(() => {
      resetExitPrompt();
    });
  } catch (error) {
    console.error("[back] 注册返回键监听失败", error);
  }
}
