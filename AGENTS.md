# AGENTS.md — JToolsBox

> 跨工具兼容入口。人类文档见 `README.md`；本文件是仓库内保留的精简上下文。完整的 AI 协作上下文 `CODEBUDDY.md` 与 `.workbuddy/` 笔记仅存于本地（已忽略、不入库），本地环境下 WorkBuddy / CodeBuddy 会自动加载。

## 项目速览

本地优先的移动工具箱：Tauri 2 + Vue 3 + TypeScript + Element Plus，v1.1.0，同一套前端跑 Android / iOS / 桌面，无服务端。已完成基础设施（路由 / 壳层 / 设置 / 存储 / 备份）与「物品到期提醒」模块。应用标识 `com.jimmy.jtoolsbox.mobile`，产品名 `JToolsBox`。

## 最小必要约定

- 入口 `src/main.ts` 先 `await bootstrap()` 再挂载；`src/App.vue` 只有 `AppShell + RouterView`，页面在 `src/views` 与 `src/modules/<id>/views`。
- 新增子功能 = 写 `src/modules/<id>/manifest.ts`（`ToolModule` 契约）+ 在 `src/app/bootstrap.ts` `registerModule`；首页、切换抽屉、路由、备份自动纳入。
- 模块数据固定写 `modules/<id>/data.json`，统一走 `storage.write`（自带 `.bak` 与临时文件 rename），不要直接调 `writeTextFile`。
- 原生能力（fs / dialog / notification）必须有浏览器分支：`isTauri`（`src/core/runtime.ts`）判断，纯前端预览降级到 localStorage。
- 深色模式靠 `<html>` 的 `dark` 类；改设置用 `updateSettings/setTheme`，它们会重新 `applyTheme()`。
- 安全区变量 `--safe-top/right/bottom/left` 在 `src/styles.css`；内边距写 `calc(var(--safe-*) + Npx)`。
- Vite 固定 1420 端口、`strictPort`、`clearScreen: false`、忽略监听 `src-tauri/**`，均为 Tauri 集成需要，勿改。
- TS 开启 `strict` / `noUnusedLocals` / `noUnusedParameters`；`npm run build` 会先跑 `vue-tsc --noEmit`。
- `fs:default` 只给读权限，写文件需要 `fs:allow-app-read-recursive` + `fs:allow-app-write-recursive`（已在 `capabilities/default.json` 配好）。

## 命令

`npm run dev`（浏览器预览）· `npm run tauri:dev` · `npm run build` · `npm run tauri:build` · `npm run android:dev` · `npm run android:build` · `npm run android:build:debug` · `npm run ios:*`（仅 macOS）。

图标：`python scripts/make-icon.py --android` → `npx tauri icon src-tauri/icons/app-icon.png`。

## 不要做的事

- 不要重跑 `npm run android:init`：`src-tauri/gen/android` 已生成并手工配置过国内镜像与签名。
- 不要读取、回显或提交 `src-tauri/gen/android/keystore.properties`（含签名口令）；release 密钥库在仓库外，丢失无法升级覆盖安装。
- 不要把本机 JDK / Android SDK 绝对路径硬编码进代码或提交的配置。
- 改 `tauri.conf.json` 的 `identifier` 时必须同步 `gen/android` 工程；权限要在 `AndroidManifest.xml` 与 `capabilities/` 两处放行。
- 不要手工替换图标文件，统一用图标脚本生成。

## 仓库状态

已推送至 <https://github.com/nickynull/JToolsBoxMobile>（public，`main`）。根 `.gitignore` 忽略 `node_modules`、`dist`、`*.log`、`release/`、`*.apk`/`*.aab`、`*.jks` 与 `keystore.properties`，以及 AI 协作的本地文件 `CODEBUDDY.md` / `.workbuddy/`（`AGENTS.md` 保留入库）。**仓库公开，文档里不写本机绝对路径与机器特定配置。**
