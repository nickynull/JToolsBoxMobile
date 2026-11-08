/** 运行环境判定：浏览器预览时没有 Tauri 运行时，需要走降级实现。 */
export const isTauri = "__TAURI_INTERNALS__" in window;
