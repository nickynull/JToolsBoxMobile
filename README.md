# JToolsBox

[![android-release](https://github.com/nickynull/JToolsBoxMobile/actions/workflows/android-release.yml/badge.svg)](https://github.com/nickynull/JToolsBoxMobile/actions/workflows/android-release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

本地优先的移动工具箱：**Tauri 2 + Vue 3 + TypeScript + Element Plus**，同一套前端代码运行在 Android、iOS 和桌面端。所有数据保存在设备本地，不需要任何服务端。

## 下载

Android 安装包发布在 [**GitHub Releases**](https://github.com/nickynull/JToolsBoxMobile/releases)，当前版本 **v1.0.0**：

| 文件 | 说明 |
| --- | --- |
| `JToolsBox-Mobile-1.0.0-arm64.apk` | arm64-v8a 设备，Android 7.0（API 24）及以上 |
| `*.apk.sha256` | 校验值，`sha256sum -c <文件名>` 可验证完整性 |

> 仅归档 arm64 包；其它架构、桌面端与 iOS 需从源码构建。本仓库不跟踪构建产物（`release/` 已在 `.gitignore` 中忽略）。

## 功能

- **模块化工具箱**：每个子功能是独立模块，拥有自己的数据文件，互不影响；首页网格进入，模块内右上角可一键切换到其它功能。
- **物品到期提醒**（首个模块）：记录食品、药品、化妆品、证件的有效期，按物品自定义提前提醒天数，分组展示「已过期 / 7 天内 / 30 天内 / 正常」。
- **关掉应用也会响**：Android / iOS 上把未来的每个提醒点排进系统闹钟，应用被划掉、重启手机后依然推送；桌面端保持前台定时检查。
- **设置**：浅色 / 深色 / 跟随系统三种主题；可配置启动页（首页 / 上次使用的功能 / 指定模块）；到期通知开关与每日提醒时间。
- **备份与恢复**：导出全部数据（含设置）或单个模块为 `.jtbx` 包，导入时可选**覆盖**或**合并**。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 应用框架 | Tauri 2 |
| 前端框架 | Vue 3（`<script setup>` + TypeScript strict） |
| 路由 | Vue Router 5（hash 模式） |
| 构建工具 | Vite 8 |
| UI 组件库 | Element Plus（中文语言包 + 深色模式） |
| 本地能力 | `plugin-fs` / `plugin-dialog` / `plugin-notification` |
| 压缩 | fflate（备份包 zip） |
| 原生层 | Rust 2024 edition |

## 目录结构

```
src/
├─ app/
│  ├─ bootstrap.ts        # 注册模块、加载设置、启动页跳转、启动提醒监听
│  └─ router.ts           # 路由表（模块路由由注册表聚合）
├─ core/
│  ├─ backup/             # 备份导出 / 解析 / 覆盖与合并
│  ├─ module/             # 模块契约（types）与注册表
│  ├─ notify/             # 系统通知：权限、即时推送、系统闹钟排程
│  ├─ settings/           # 全局设置持久化与主题应用
│  ├─ storage/            # 统一存储驱动（Tauri fs / localStorage）
│  ├─ date.ts             # 本地时区日期计算
│  ├─ id.ts / runtime.ts / version.ts
├─ modules/
│  └─ expiry/             # 物品到期提醒
│     ├─ manifest.ts      # 模块声明：路由 / 图标 / 角标 / 预加载
│     ├─ store.ts         # 数据读写与状态
│     ├─ schedule.ts      # 计算未来提醒点并排入系统闹钟
│     ├─ reminder.ts      # 前台兜底扫描与通知
│     ├─ types.ts
│     └─ views/           # 列表页、编辑页
├─ components/            # AppShell（顶栏 / 底栏 / 切换抽屉）
├─ views/                 # 首页、设置页
├─ App.vue                # 仅承载 AppShell + RouterView
└─ main.ts                # 先 bootstrap 再挂载
```

## 数据存储

Tauri 运行时写入应用数据目录（`appDataDir`），按模块分目录：

```
settings.json
modules/expiry/data.json          # 每个模块独占一份
modules/expiry/data.json.bak      # 上一次成功写入的副本
```

写入策略为「临时文件 → 校验 → 覆盖」，读取失败时自动回退 `.bak`。浏览器预览（`npm run dev`）没有 Tauri 运行时，驱动自动降级到 `localStorage`（前缀 `jtb:`），页面全部功能可离线调试。

### 备份包格式

`.jtbx` 是标准 zip：

```
manifest.json            { app, schema, appVersion, exportedAt, modules, includeSettings }
settings.json            仅「导出全部」时包含
modules/expiry/data.json
```

「合并」按 id 覆盖同名条目、保留其余数据；「覆盖」直接用包内数据替换。导入前会展示包内模块与导出时间。

## 新增一个工具模块

1. 新建 `src/modules/<id>/`，实现 `manifest.ts`（导出 `ToolModule`）、`store.ts`、`views/`。
2. 在 `src/app/bootstrap.ts` 里 `registerModule(<module>)`。
3. 首页网格、切换抽屉、路由、备份导出会自动纳入，无需改动主壳。

`ToolModule` 契约见 `src/core/module/types.ts`：`id`（同时是数据目录名）、`name`、`description`、`icon`、`accent`、`entry`、`routes`、`version`，可选 `badge()`（首页角标）与 `preload()`（启动预加载）。

## 图标

图标为黄底黑字「JT」，由脚本生成，避免手工替换：

```bash
python scripts/make-icon.py --android   # 生成 1024 源图 + Android 自适应前景层
npx tauri icon src-tauri/icons/app-icon.png
```

需要 Python 3 + Pillow。`--android` 会同时把 Android 自适应图标背景色改成 `#FFC800`，并把前景层替换为透明底 + 居中 JT（否则圆形裁切后会露出白角）。

## 常用脚本

| 脚本 | 说明 |
| --- | --- |
| `npm run dev` | 仅前端预览 http://localhost:1420（无原生能力，数据存 localStorage） |
| `npm run tauri:dev` | 桌面端开发调试（完整原生能力） |
| `npm run tauri:build` | 桌面端安装包 |
| `npm run build` | `vue-tsc --noEmit && vite build` |
| `npm run android:dev` | Android 真机/模拟器调试 |
| `npm run android:build` | Android release 安装包 |
| `npm run android:build:debug` | universal debug APK |
| `npm run ios:init` / `ios:dev` / `ios:build` | iOS（仅 macOS + Xcode 15+） |

## 桌面端开发

```bash
npm install
npm run tauri dev
```

## Android 开发

本机（Windows）环境已配置完成：

| 项 | 路径 / 版本 |
| --- | --- |
| JDK | Microsoft OpenJDK 17.0.21，`%USERPROFILE%\.jdks\microsoft-jdk-17` |
| Android SDK | `%LOCALAPPDATA%\Android\Sdk` |
| SDK Platform | android-37.0（应用 compileSdk 37）、android-36（Tauri 库 compileSdk 36） |
| Build-Tools | 36.0.0（AGP 默认）、37.0.0 |
| NDK | 27.0.12077973 |
| Platform-Tools | adb 37.0.1 |
| Rust 目标 | aarch64 / armv7 / i686 / x86_64-linux-android |

用户环境变量已写入 `JAVA_HOME`、`ANDROID_HOME`、`ANDROID_SDK_ROOT`、`NDK_HOME`，PATH 已加入 Java、platform-tools、cmdline-tools 与 emulator。**已打开的终端需要重开**才能读到新变量。

> Android 工程已生成在 `src-tauri/gen/android`，无需再次 `android:init`。
> Gradle Wrapper 使用腾讯云镜像下载 Gradle 9.6.1；`build.gradle.kts` / `buildSrc/build.gradle.kts` 已加入阿里云 Maven 镜像，避免 Google Maven 下载超时。
> Windows 必须开启「开发者模式」（非管理员进程创建符号链接需要），本机已开启。

连接开启 USB 调试的真机后运行：

```bash
adb devices        # 确认设备已授权
npm run android:dev
```

产物固定落在 `src-tauri/gen/android/app/build/outputs/apk/universal/{debug,release}/`。universal debug 包含 4 个 ABI 与调试符号，体积约 480 MB；release 包明显更小。已发布的 arm64 包见 [GitHub Releases](https://github.com/nickynull/JToolsBoxMobile/releases)，本地归档目录 `release/` 不入库。

Release 签名：

- 密钥库：`%USERPROFILE%\.android\jtoolsbox-release.jks`（RSA 2048，alias `jtoolsbox`，有效期 10000 天），**放在仓库外，务必自行备份**；丢失后无法覆盖安装升级。
- `src-tauri/gen/android/keystore.properties` 保存路径与口令，已被忽略，不要提交。
- `app/build.gradle.kts` 读取该文件并条件生成 `release` signingConfig；不存在时回退为未签名构建。
- 更换密钥库后需先卸载旧版本才能安装新签名的包。

Android 备忘：

- 包名来自 `tauri.conf.json` 的 `identifier`（`com.jimmy.jtoolsbox.mobile`），修改需同步 `gen/android`。
- 应用显示名称在 `gen/android/app/src/main/res/values/strings.xml`。
- 图标用 `scripts/make-icon.py` + `npx tauri icon` 生成，不要手工替换。
- 本机未安装模拟器与系统镜像，调试优先使用 USB 真机。

## 移动端适配

- `index.html` 启用 `viewport-fit=cover` 并禁止缩放。
- `src/styles.css` 提供 `--safe-top / --safe-right / --safe-bottom / --safe-left`，页面内边距统一写 `calc(var(--safe-*) + Npx)`。
- 深色模式通过 `<html>` 的 `dark` 类切换 Element Plus 暗色变量，偏好存 `settings.json`，`system` 时跟随 `prefers-color-scheme`。

## 提醒机制

分两条路径，互不重叠：

| 平台 | 触发方式 | 应用关闭 |
| --- | --- | --- |
| Android / iOS | 把每个未来的提醒点用 `Schedule.at` 排进系统闹钟（Android 走 `AlarmManager`，iOS 走 `UNUserNotificationCenter`） | 照常推送，重启手机后由 `BOOT_COMPLETED` 接收器恢复 |
| 桌面 / 浏览器预览 | 启动时检查一次 + 前台每 30 分钟 + 回到前台时检查，命中即 `sendNotification` | 不推送 |

- 提醒时刻 = 到期日减 `remindDays` 中的档位，统一落在设置里的「提醒时间」（默认 09:00）。
- 数据或设置一改就重排：`schedule.ts` 监听模块数据与 `notifyEnabled / notifyTime`，去抖 1.2 s 后整表重建（插件没有「原地更新」能力，只能先清空待发再重建，幂等）。
- 一次最多排 60 条（按时间从近到远）；更远的会在后续同步中补上，不会丢。
- 移动端一旦排程生效，前台扫描自动让位，避免系统弹一条、应用内再弹一条。设置页会显示「已排入 N 条系统提醒」和下一次触发时间。
- **当天已过提醒时间的不补发**：补发闹钟会被下一次同步取消而漂移，宁可漏一次也不做不稳定的重排。

## 已知限制

- **提醒时间可能有几分钟偏差**：Android 12+ 未授予「闹钟和提醒」权限时，插件降级为 `setAndAllowWhileIdle`（不精确但能在 Doze 下唤醒）。需要准点可自行在系统设置里允许精确闹钟，或在 Manifest 声明 `SCHEDULE_EXACT_ALARM`。
- **省电策略**：部分国产 ROM 的「自启动 / 后台限制」会清掉闹钟，需要在系统设置里给本应用加白名单。
- **桌面端不会后台响**：桌面没有跨平台的后台定时任务，需要应用保持运行；Windows 计划任务方案暂未实现。
- **Android 导出**：备份导出依赖系统文件选择器，部分机型对 `content://` 写入支持有限，若失败请改用桌面端导出或后续改用 SAF。
- 本机未安装 Android 模拟器，需真机调试。
- iOS 构建只能在 macOS + Xcode 下进行。
- 桌面窗口默认 390×844（模拟手机比例）。
- Element Plus 为桌面优先组件库，触控交互较重的页面可考虑搭配 Vant。

## 自动构建

推 `v*` 标签即触发 [`.github/workflows/android-release.yml`](.github/workflows/android-release.yml)，在 GitHub Runner 上产出 arm64 签名 APK 并自动附加到同名 Release；也可在 Actions 页面手动 Run workflow，只产出 artifact、不动 Release。

签名材料通过 4 个 Secrets 注入（`ANDROID_KEYSTORE_BASE64` / `ANDROID_KEY_ALIAS` / `ANDROID_STORE_PASSWORD` / `ANDROID_KEY_PASSWORD`），密钥库只在 runner 临时目录还原，构建结束即销毁。**未配置 Secrets 也能构建，但产物未签名、无法安装**，工作流会给出警告并跳过 Release 附加。配置步骤见 [docs/github-release.md](docs/github-release.md)。

## 许可证

[MIT](LICENSE) © 2026 Jimmy
