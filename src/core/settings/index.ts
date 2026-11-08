import { reactive, watch } from "vue";
import { readJson, writeJson } from "../storage/driver";
import { DEFAULT_SETTINGS, type AppSettings, type ThemeMode } from "./types";

const KEY = "settings.json";
const THEMES: ThemeMode[] = ["light", "dark", "system"];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const settings = reactive<AppSettings>({ ...DEFAULT_SETTINGS });

const media = window.matchMedia("(prefers-color-scheme: dark)");
let hydrated = false;
let saveTimer: number | undefined;

function isDark(): boolean {
  return settings.theme === "system" ? media.matches : settings.theme === "dark";
}

export function applyTheme(): void {
  document.documentElement.classList.toggle("dark", isDark());
}

function sanitize(raw: Partial<AppSettings>): Partial<AppSettings> {
  const next: Partial<AppSettings> = {};
  if (raw.theme && THEMES.includes(raw.theme)) {
    next.theme = raw.theme;
  }
  if (typeof raw.startup === "string" && raw.startup) {
    next.startup = raw.startup;
  }
  if (typeof raw.notifyEnabled === "boolean") {
    next.notifyEnabled = raw.notifyEnabled;
  }
  if (typeof raw.notifyTime === "string" && TIME_PATTERN.test(raw.notifyTime)) {
    next.notifyTime = raw.notifyTime;
  }
  if (typeof raw.lastModuleId === "string" || raw.lastModuleId === null) {
    next.lastModuleId = raw.lastModuleId;
  }
  return next;
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void writeJson(KEY, settings).catch((error) => {
      console.error("[settings] 保存失败", error);
    });
  }, 250);
}

export async function initSettings(): Promise<void> {
  const stored = await readJson<Partial<AppSettings>>(KEY).catch(() => null);
  if (stored) {
    Object.assign(settings, sanitize(stored));
  }
  hydrated = true;
  applyTheme();

  watch(
    settings,
    () => {
      if (hydrated) {
        scheduleSave();
      }
    },
    { deep: true },
  );

  media.addEventListener("change", () => {
    if (settings.theme === "system") {
      applyTheme();
    }
  });
}

export function updateSettings(patch: Partial<AppSettings>): void {
  Object.assign(settings, patch);
  applyTheme();
}

export function setTheme(theme: ThemeMode): void {
  updateSettings({ theme });
}
