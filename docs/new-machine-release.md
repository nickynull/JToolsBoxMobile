# 更换机器发布指南

> 适用场景：换一台电脑、重装系统后，或从 Windows 迁到 macOS / Linux，在新环境里打出与旧版**签名一致**的 release 包。
> 本机直接发版见 [本地发布指南](./local-release.md)；交给 GitHub Actions 自动打包见 [GitHub 发布指南](./github-release.md)。
>
> 本系列文档只写操作流程，**不包含任何口令、密钥库路径、证书或别名等敏感信息**。签名所需的实际值请通过带外方式自行迁移，不要写进文档、代码或版本控制。

---

## 1. 核心原则

> **代码走仓库，密钥走带外，生成文件交给 CLI。**

只要这三条守住，换机器就不会出现「包能打出来但用户无法覆盖升级」的事故。其中最容易被忽略的是第三条：`src-tauri/gen/android` 下有一批文件含**本机绝对路径**（例如 Rust 依赖在 cargo registry 中的位置），把它们拷到新机器会直接导致构建失败。

---

## 2. 三类文件怎么处理

### 2.1 随仓库走（正常 `git clone` 即可）

- `src/`、`src-tauri/src/`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`、`src-tauri/capabilities/`、`src-tauri/icons/`
- `package.json`、`package-lock.json`、`index.html`、`vite.config.ts`、`tsconfig*.json`
- `src-tauri/gen/android/` 下**已被跟踪**的工程文件：`build.gradle.kts`、`settings.gradle`、`gradle/wrapper/`、`gradle.properties`、`app/build.gradle.kts`、`app/src/main/AndroidManifest.xml`、`app/src/main/res/` 等

### 2.2 不能入库、必须带外迁移

| 内容 | 说明 |
| --- | --- |
| 签名密钥库文件 | 放在仓库目录之外。丢失后**无法**覆盖安装升级，只能让用户卸载重装并丢失本地数据 |
| 签名配置文件的 4 个值 | 项目内 `src-tauri/gen/android/keystore.properties` 使用 `storeFile`、`storePassword`、`keyAlias`、`keyPassword` 四个键。只迁移键对应的值，文件本身在新机器上重新生成 |

推荐做法：密钥库用加密介质或密码管理器传递，4 个值分开存放；**不要**通过聊天工具、截图、邮件正文或提交记录传递。迁移完成后确认旧机器上不再保留多余副本。

> `keystore.properties` 已被 `gen/android/.gitignore` 忽略。新机器上手工创建它时，键名必须与上表一致 —— Tauri 官方 CI 文档示例用的是另一套键名，照抄会构建失败。

### 2.3 不要拷贝、由 Tauri CLI 自动生成

以下文件都被 `.gitignore` 忽略，且含本机路径或由版本推导，**新机器上不要从旧机器复制**，跑一次 `tauri android build` 就会按新环境重建：

```
src-tauri/gen/android/tauri.settings.gradle
src-tauri/gen/android/keystore.properties
src-tauri/gen/android/app/tauri.properties
src-tauri/gen/android/app/tauri.build.gradle.kts
src-tauri/gen/android/app/proguard-tauri.pro
```

`tauri.settings.gradle` 里列出的是当前 Rust 依赖中各个 Tauri 插件的 Android 工程路径，它会随插件增删而变化，由 CLI 生成才可靠。

**不要执行 `npm run android:init`**：`gen/android` 已生成并手工调整过 Gradle 仓库、AGP/Kotlin 版本、NDK 与签名条件逻辑，重新 init 会覆盖这些改动；而且 init 并不会生成上面列表中的部分文件，只有 `android build` / `android dev` 会。

---

## 3. 新机器环境清单

| 项 | 要求 |
| --- | --- |
| Node.js | LTS，`npm ci` 可用 |
| Rust | stable；安装 Android 目标：`rustup target add aarch64-linux-android`（全 ABI 再加 `armv7-linux-androideabi`、`i686-linux-android`、`x86_64-linux-android`） |
| JDK | 17（Tauri / AGP 目前按此验证） |
| Android SDK | `platforms;android-37`、`build-tools;37.0.0`、`platform-tools` |
| Android NDK | `27.0.12077973` |
| 环境变量 | `JAVA_HOME`、`ANDROID_HOME`（或 `ANDROID_SDK_ROOT`）、`NDK_HOME`，PATH 含 Java、platform-tools、cmdline-tools |
| Python（可选） | 3 + Pillow，仅重新生成图标时需要 |

已打开的终端读不到新写入的环境变量，**配置完重开终端**再继续。

安装 SDK 组件示例（`sdkmanager` 来自 Android cmdline-tools）：

```bash
sdkmanager --install "platforms;android-37" "build-tools;37.0.0" "ndk;27.0.12077973" "platform-tools"
```

---

## 4. 操作步骤

```bash
# 1. 取代码
git clone <你的仓库地址>
cd <仓库目录>

# 2. 前端依赖与 Rust 目标
npm ci
rustup target add aarch64-linux-android

# 3. 确认环境变量已生效（不要把这些值打印到日志里）
#    JAVA_HOME / ANDROID_HOME / NDK_HOME

# 4. 带外放置密钥库，并在 gen/android 下新建 keystore.properties
#    内容包含 2.2 节列出的 4 个键，storeFile 指向新机器上的密钥库位置

# 5. 先跑一次类型检查
npm run build

# 6. 打 release 包（首次构建会重建 2.3 节的生成文件）
npx tauri android build --apk --target aarch64
```

产物路径与签名校验步骤与本机一致，见 [本地发布指南](./local-release.md) 第 4、6 节。

---

## 5. 验收清单

- [ ] 构建过程没有「未找到 NDK / SDK platform」之类的告警
- [ ] `keytool -printcert -jarfile <apk>` 输出的证书指纹与**上一版**一致
- [ ] `adb install -r` 能在装有旧版的设备上直接覆盖安装，数据未丢
- [ ] 应用内备份导出 / 导入、提醒排程等原生功能正常（验证插件都被正确打进包）
- [ ] 产物已生成 `.sha256` 并归档
- [ ] `git status` 中没有签名配置文件、密钥库或生成文件被意外跟踪

---

## 6. 平台差异

| 项 | Windows | macOS / Linux |
| --- | --- | --- |
| 开发者模式 | **必须开启**，否则 Tauri 创建符号链接会失败 | 不需要 |
| 路径分隔符 | 签名配置里的密钥库路径用 Windows 写法时注意转义 | 用 POSIX 路径 |
| 环境变量 | 系统「用户变量」设置后需重开终端 | 写入 shell 配置文件后 `source` 或重开终端 |
| iOS 构建 | 不支持 | macOS + Xcode 15+ 可跑 `ios:init` / `ios:build`，另需 Apple 签名证书与描述文件 |

### 网络与镜像

工程里的 Gradle Wrapper 指向国内发行版镜像，Maven 仓库也把国内镜像排在前面 —— 这是为本机网络做的优化。在**境外网络**的新机器上，国内镜像可能反而更慢或不可达：

- 临时方案：改 `gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl` 为官方发行版地址；依赖下载慢时把 `gen/android/build.gradle.kts` 与 `buildSrc/build.gradle.kts` 的仓库顺序调整为官方源优先。
- 长期方案（推荐，仓库与本机两全）：仓库只保留官方源，本机需要加速时在自己的用户目录下用 Gradle 初始化脚本（`~/.gradle/init.gradle`）注入镜像，不改动仓库文件。

### cargo 代理

项目 `src-tauri/.cargo/config.toml` 显式关闭了 HTTP 代理，用来绕开本机 git 全局代理对 cargo 的干扰。新机器若**必须**走代理才能访问 crates.io，改这个文件（或改全局 git 配置），二选一即可，不要两处一起改。

---

## 7. 常见失败

| 现象 | 原因与处理 |
| --- | --- |
| 报找不到某个 Tauri 插件的 Android 工程 | 生成文件是旧机器拷来的或已过期；删除 `tauri.settings.gradle` 后重跑 `tauri android build` 让 CLI 重建 |
| 构建成功但 APK 未签名 | `keystore.properties` 不存在或键名不对；Gradle 是「有条件签名」，缺文件不会报错 |
| 覆盖安装提示签名不一致 | 用了不同的密钥库；换回原来的密钥库，不要让用户卸载 |
| `cargo` 连不上 crates.io | 见第 6 节「cargo 代理」 |
| Gradle 一直卡在下载 | 国内/官方镜像不匹配，见第 6 节「网络与镜像」 |
| 符号链接权限错误（Windows） | 开启开发者模式并重开终端 |
| NDK 版本不对 | 确认 `NDK_HOME` 指向 27.x，且 `sdkmanager` 已安装对应版本 |

---

## 8. 什么时候改用 CI

如果打包会反复发生、需要多人协作，或希望每次打 tag 自动出包，建议直接走 [GitHub 发布指南](./github-release.md)：把工具链和签名的注入固化到工作流里，新机器就只需要能 `git clone`。
