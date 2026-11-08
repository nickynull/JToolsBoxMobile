export type ThemeMode = "light" | "dark" | "system";

/** 启动页：home / last（上次使用）/ 具体模块 id */
export type StartupTarget = string;

export interface AppSettings {
  version: number;
  theme: ThemeMode;
  startup: StartupTarget;
  notifyEnabled: boolean;
  /** 每天推送到期提醒的时刻，HH:mm */
  notifyTime: string;
  lastModuleId: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 2,
  theme: "system",
  startup: "home",
  notifyEnabled: true,
  notifyTime: "09:00",
  lastModuleId: null,
};
