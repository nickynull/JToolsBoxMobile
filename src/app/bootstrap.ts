import type { Router } from "vue-router";
import { installBackHandler } from "../core/back";
import { getModule, getModules, registerModule } from "../core/module/registry";
import { initSettings, settings } from "../core/settings";
import { expiryModule } from "../modules/expiry/manifest";
import { startReminderWatcher } from "../modules/expiry/reminder";
import { createAppRouter } from "./router";

/** 启动页：home / last / 某个模块 id → 对应入口路由 name */
function resolveStartup(): string {
  const target = settings.startup;
  if (target === "home") {
    return "home";
  }
  if (target === "last") {
    return getModule(settings.lastModuleId)?.entry ?? "home";
  }
  return getModule(target)?.entry ?? "home";
}

export async function bootstrap(): Promise<Router> {
  registerModule(expiryModule);

  await initSettings();
  await Promise.all(getModules().map((module) => module.preload?.()));

  const router = createAppRouter();

  // 仅首次进入时按设置跳转启动页
  let startupApplied = false;
  router.beforeEach((to) => {
    if (!startupApplied) {
      startupApplied = true;
      const target = resolveStartup();
      if (target !== "home" && to.name === "home") {
        return { name: target, replace: true };
      }
    }
    return true;
  });

  router.afterEach((to) => {
    const id = to.meta.moduleId;
    if (id && settings.lastModuleId !== id) {
      settings.lastModuleId = id;
    }
  });

  void startReminderWatcher();
  void installBackHandler(router);

  return router;
}
