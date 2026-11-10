import { createApp } from "vue";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "./styles.css";
import App from "./App.vue";
import { bootstrap } from "./app/bootstrap";
import { disableTextSelection } from "./core/selection";

async function start() {
  // 全局禁止长按选中/复制文字，需在挂载前装好监听
  disableTextSelection();
  // 先完成设置与模块注册，避免首屏主题闪烁或首页缺少模块
  const router = await bootstrap();
  createApp(App).use(ElementPlus, { locale: zhCn }).use(router).mount("#app");
}

void start();
