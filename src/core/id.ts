/** 生成短随机 id，仅用于本地数据标识，不做安全用途。 */
export function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  ).toLowerCase();
}
