/**
 * 全局「禁止长按复制文字」的事件层。
 *
 * CSS（styles.css）已把普通文本设为不可选中，但 Android System WebView 在长按后
 * 仍可能自行拉起选择手柄 / ACTION_MODE 菜单，所以还要在捕获阶段掐掉 contextmenu
 * 与 selectstart，并在抬手时清理残留选区。顺带挡住非编辑区的全选、复制、剪切，
 * 避免桌面端绕过限制。用捕获阶段是为了连 stopPropagation 的浮层组件也能拦住。
 *
 * 输入框、文本域与 contenteditable 一律放行：编辑页需要光标定位、选中与粘贴。
 */

const EDITABLE_SELECTOR =
  'input, textarea, [contenteditable]:not([contenteditable="false"])';

/** EventTarget 可能是 Text 节点或 Window，统一转成可 closest 的 Element */
function toElement(target: EventTarget | Node | null): Element | null {
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

function isEditable(target: EventTarget | Node | null): boolean {
  const element = toElement(target);
  return element !== null && element.closest(EDITABLE_SELECTOR) !== null;
}

let installed = false;

/** 在应用挂载前调用一次；重复调用无副作用。 */
export function disableTextSelection(): void {
  if (installed) {
    return;
  }
  installed = true;

  const block = (event: Event) => {
    if (isEditable(event.target)) {
      return;
    }
    event.preventDefault();
  };

  document.addEventListener("contextmenu", block, true);
  document.addEventListener("selectstart", block, true);

  // 某些 WebView 会先生成选区再弹菜单，抬手时把非编辑区的选区清干净
  document.addEventListener(
    "touchend",
    () => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed) {
        return;
      }
      if (isEditable(selection.anchorNode)) {
        return;
      }
      selection.removeAllRanges();
    },
    true,
  );

  // 桌面端：非编辑区不允许 Ctrl/Cmd+A 全选
  document.addEventListener(
    "keydown",
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") {
        return;
      }
      if (isEditable(event.target)) {
        return;
      }
      event.preventDefault();
      document.getSelection()?.removeAllRanges();
    },
    true,
  );

  // 即便有漏网的选区，也不允许把非编辑区的文字复制出去
  const blockClipboard = (event: ClipboardEvent) => {
    if (isEditable(event.target)) {
      return;
    }
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed && isEditable(selection.anchorNode)) {
      return;
    }
    event.preventDefault();
  };
  document.addEventListener("copy", blockClipboard, true);
  document.addEventListener("cut", blockClipboard, true);
}
