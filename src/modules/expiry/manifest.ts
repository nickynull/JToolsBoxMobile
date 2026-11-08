import { AlarmClock } from "@element-plus/icons-vue";
import type { ToolModule } from "../../core/module/types";
import { alertCount, loadExpiry } from "./store";
import ExpiryListView from "./views/ExpiryListView.vue";
import ExpiryEditView from "./views/ExpiryEditView.vue";

export const expiryModule: ToolModule = {
  id: "expiry",
  name: "到期提醒",
  description: "食品、药品、证件的有效期管理",
  icon: AlarmClock,
  accent: "#E6A23C",
  entry: "expiry-list",
  version: 1,
  preload: loadExpiry,
  badge: () => {
    const count = alertCount.value;
    return count > 0 ? `${count} 项待处理` : null;
  },
  routes: [
    {
      path: "/m/expiry",
      name: "expiry-list",
      component: ExpiryListView,
      meta: { moduleId: "expiry", title: "到期提醒" },
    },
    {
      path: "/m/expiry/new",
      name: "expiry-new",
      component: ExpiryEditView,
      meta: { moduleId: "expiry", title: "新增物品", back: "expiry-list" },
    },
    {
      path: "/m/expiry/:id/edit",
      name: "expiry-edit",
      component: ExpiryEditView,
      meta: { moduleId: "expiry", title: "编辑物品", back: "expiry-list" },
    },
  ],
};
