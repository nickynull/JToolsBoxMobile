import { createRouter, createWebHashHistory, type Router } from "vue-router";
import HomeView from "../views/HomeView.vue";
import SettingsView from "../views/SettingsView.vue";
import { getModules } from "../core/module/registry";

declare module "vue-router" {
  interface RouteMeta {
    title?: string;
    /** 所属工具模块 id，存在即视为模块内页 */
    moduleId?: string;
    /** 返回按钮的目标路由 name */
    back?: string;
    /**
     * 页面布局。默认（不填）是壳层滚动整页；
     * `"fill"` 表示壳层交出高度且自身不滚动，由页面自行分区（如上部滚动 + 下部固定操作栏）。
     */
    layout?: "fill";
  }
}

export function createAppRouter(): Router {
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      {
        path: "/",
        name: "home",
        component: HomeView,
        meta: { title: "JToolsBox" },
      },
      {
        path: "/settings",
        name: "settings",
        component: SettingsView,
        meta: { title: "设置" },
      },
      ...getModules().flatMap((module) => module.routes),
      { path: "/:pathMatch(.*)*", redirect: "/" },
    ],
  });

  return router;
}
