const DAY_MS = 86_400_000;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 本地时区的 YYYY-MM-DD，避免 toISOString 的 UTC 偏移问题。 */
export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

function parseISO(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function isValidISODate(value: string): boolean {
  const date = parseISO(value);
  return !!date && toISODate(date) === value;
}

/** 距目标日期还有几天；负数表示已过期。 */
export function daysUntil(value: string, from: Date = new Date()): number {
  const target = parseISO(value);
  if (!target) {
    return Number.NaN;
  }
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((target.getTime() - base.getTime()) / DAY_MS);
}

export function addDays(value: string, days: number): string {
  const date = parseISO(value) ?? new Date();
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** 加整月，月末自动收敛（1 月 31 日 + 1 月 = 2 月 28/29 日）。 */
export function addMonths(value: string, months: number): string {
  const date = parseISO(value) ?? new Date();
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(day, lastDay));
  return toISODate(target);
}

/** 相对描述：已过期 3 天 / 今天到期 / 还有 12 天 */
export function describeRemaining(value: string): string {
  const days = daysUntil(value);
  if (Number.isNaN(days)) {
    return "日期无效";
  }
  if (days < 0) {
    return `已过期 ${Math.abs(days)} 天`;
  }
  if (days === 0) {
    return "今天到期";
  }
  if (days === 1) {
    return "明天到期";
  }
  return `还有 ${days} 天`;
}

export function describeSpan(value: string): string {
  const days = daysUntil(value);
  if (Number.isNaN(days)) {
    return "";
  }
  if (days < 0) {
    return `${Math.abs(days)} 天前`;
  }
  if (days === 0) {
    return "今天";
  }
  return `${days} 天后`;
}
