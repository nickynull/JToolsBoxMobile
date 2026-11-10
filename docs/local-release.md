# 本地发布指南

> 适用场景：在**已经配置好开发环境的这台机器上**打出可安装的 release 包并归档。
> 换一台新机器打包见 [更换机器发布指南](./new-machine-release.md)；用 GitHub Actions 自动打包见 [GitHub 发布指南](./github-release.md)。
>
> 本系列文档只写操作流程，**不包含任何口令、密钥库路径、证书或别名等敏感信息**。签名所需的实际值请在你本机的私有配置中查阅，不要写进文档、代码或版本控制。

---

## 1. 发布前检查清单

逐项确认后再开始，避免产出一个「能装但不能覆盖升级」的包。

| 检查项 | 要求 |
| --- | --- |
| 依赖完整 | `npm ci` 可成功执行；Rust 依赖可正常拉取 |
| 前端类型检查 | `npm run build` 通过（含 `vue-tsc --noEmit`，未使用变量会直接失败） |
| 版本号 | `package.json` 与 `src-tauri/tauri.conf.json` 的 `version` 已同步更新 |
| 签名配置 | 项目内被忽略的签名配置文件存在且可被 Gradle 读取（内容不要外泄） |
| 密钥库 | 签名配置文件指向的密钥库文件可访问，且与上一版使用**同一个** |
| 工作区干净 | `git status` 中没有把签名配置文件、密钥库或产物误加进暂存区 |
| 设备 | 已连接开启 USB 调试的真机，`adb devices` 能看到已授权设备 |

> **重要**：`app/build.gradle.kts` 的逻辑是「签名配置文件存在才生成 release 签名配置」。如果该文件缺失，构建**照样会成功**，只是产出未签名包。所以第 4 项不能只看构建是否通过，必须按第 6 节校验签名。

---

## 2. 更新版本号

> 走 CI 发版时**不要**手工改版本号——release-please 的 release PR 会统一处理 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`。本节只适用于在本机直接打包、不经 CI 的情况。

1. 同步修改两处：`package.json` 的 `version`、`src-tauri/tauri.conf.json` 的 `version`（`Cargo.toml` 的 crate 版本建议一起改，前端显示的版本读的是 `package.json`）。
2. Android 的 `versionName` / `versionCode` 写在 `src-tauri/gen/android/app/tauri.properties`，该文件由 Tauri CLI 在构建时依据 `tauri.conf.json` 自动生成，**不要手工编辑**。
3. 如果改动了 `identifier`（应用包名），必须同步 `src-tauri/gen/android` 下的工程配置；仅发版时通常不要动它。
4. 确认 `src-tauri/tauri.conf.json` 的 `productName` 与期望的安装包名称一致。

---

## 3. 构建

### 3.1 前端校验

```bash
npm ci
npm run build
```

`npm run build` 只产出 `dist/`，不产安装包，但会提前暴露类型错误。

### 3.2 Android release

```bash
# 仅 arm64（推荐，体积最小，覆盖绝大多数现役手机）
npx tauri android build --apk --target aarch64

# 全 ABI（不加 --target，产物大很多）
npx tauri android build --apk

# 等价的 npm 脚本写法
npm run android:build -- --apk --target aarch64
```

首次构建需要下载 Gradle 发行版与 Maven 依赖，耗时较长属正常。构建过程中 Tauri CLI 会自动重建被忽略的生成文件，**不要**为了「初始化」去跑 `android:init`，那会覆盖工程里手工调整过的配置。

### 3.3 桌面端（可选）

```bash
npm run tauri:build
```

### 3.4 iOS

只能在 macOS + Xcode 15+ 上进行，见 [更换机器发布指南](./new-machine-release.md#6-平台差异)。

---

## 4. 产物位置

```
src-tauri/gen/android/app/build/outputs/apk/universal/release/   # Tauri 固定使用该目录名
```

即使只编译单个 ABI，目录名仍是 `universal`。打包完成后把 APK 归档到仓库根目录的 `release/`，建议命名：

```
JToolsBox-<version>-<abi>.apk
JToolsBox-<version>-<abi>.apk.sha256
```

生成校验文件：

```bash
# macOS / Linux / Git Bash
sha256sum <apk 文件名> > <apk 文件名>.sha256
```

```powershell
# Windows PowerShell
(Get-FileHash <apk 文件名> -Algorithm SHA256).Hash.ToLower()
```

> `release/` 目前**没有**被 `.gitignore` 忽略。归档产物前先确认是否要把它纳入版本控制；大体积安装包一般更适合作为 Release 附件而非仓库文件。

---

## 5. 安装验证

```bash
adb devices                 # 确认设备已授权
adb install -r <apk 路径>    # 覆盖安装
```

覆盖安装时若系统提示签名不一致，说明这次用的密钥库与设备上已装版本不同。**不要**为了绕过而卸载用户数据；如确需更换密钥库，先明确告知会影响升级，必要时先通过应用内备份导出 `.jtbx`。

安装后做一次冒烟：启动应用 → 进入任一工具模块 → 新增/编辑一条记录 → 杀掉应用重开确认数据仍在 → 检查深色模式与提醒开关。

---

## 6. 校验签名（必做）

```bash
# 用 JDK 自带工具查看 APK 签名证书信息
keytool -printcert -jarfile <apk 路径>

# 或使用 Android SDK 的 apksigner
apksigner verify --print-certs <apk 路径>
```

把输出的证书指纹与**上一版安装包**比对，一致才说明可以覆盖升级。命令只输出证书指纹，不会输出任何口令，但输出内容仍属于发布元信息，按你的安全习惯处理即可。

如果输出显示「未签名」，回到第 1 节检查签名配置文件是否存在、其中引用的密钥库路径是否可读。

---

## 7. 发布后

- 记录本次版本号、产物文件、校验值与构建日期，便于回溯。
- 确认签名配置文件、密钥库、`.jtbx` 备份文件都**没有**进入版本控制。
- 需要分发时优先使用 Release 附件或可信渠道，并同时提供 `.sha256`。

---

## 8. 常见失败

| 现象 | 原因与处理 |
| --- | --- |
| 构建成功但装不上 / 不能覆盖升级 | 多半是未签名或换了密钥库，按第 6 节校验 |
| `cargo` 连不上 crates.io | 本机 git 全局代理会被 cargo 继承；项目已在 `src-tauri/.cargo/config.toml` 显式关闭代理。若新环境需要代理，改该文件而不是改全局配置 |
| Gradle 下载超时 | 工程配置了国内镜像；在境外网络下可能反而更慢，见[更换机器发布指南](./new-machine-release.md#6-平台差异) |
| Windows 报符号链接权限错误 | 开启系统「开发者模式」后重开终端 |
| 1420 端口被占用 | Vite 使用固定端口且 `strictPort`，先关掉占用进程，不要改端口 |
| `vue-tsc` 报未使用变量 | 项目开启了 `noUnusedLocals` / `noUnusedParameters`，清理后再构建 |
| 首次构建特别慢 | 下载 Gradle 发行版、Maven 依赖与 Rust 依赖，属正常；后续有缓存会快很多 |
