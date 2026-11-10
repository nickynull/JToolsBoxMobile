# GitHub 发布指南

> 适用场景：把 release 构建交给 GitHub Actions，推送代码或打 tag 后自动产出签名 APK。
> 在本机手动发版见 [本地发布指南](./local-release.md)；换电脑手动发版见 [更换机器发布指南](./new-machine-release.md)。
>
> 本系列文档只写操作流程与工作流模板，**不包含任何口令、密钥库路径、证书、别名或编码后的密钥内容**。所有敏感值一律通过 GitHub Secrets 注入，模板里出现的都是变量引用和占位符。

---

## 1. 前提

| 项 | 要求 |
| --- | --- |
| 仓库 | 项目已 `git init` 并推送到 <https://github.com/nickynull/JToolsBoxMobile>（默认分支 `main`） |
| 权限 | 有仓库 Settings 的配置权限；工作流需要 `contents: write`（建 Release / 推 tag）与 `pull-requests: write`（release-please 开 PR）；仓库还需在 Actions 设置里允许 GitHub Actions 创建 PR |
| 签名材料 | 能访问与历史版本**同一个**签名密钥库，否则用户无法覆盖升级 |
| 忽略规则 | 确认 `src-tauri/gen/android/keystore.properties`、密钥库文件都未被跟踪（前者已被忽略） |

发布前先确认 `.gitignore` 是否会误纳入大体积产物：`release/`、`*.apk`、`*.aab`、`*.jks` 与各 `keystore.properties` 已忽略，安装包只作为 Release 附件分发；AI 协作的本地文件 `CODEBUDDY.md` 与 `.workbuddy/` 也已忽略、不入库（`AGENTS.md` 保留）。

---

## 2. 整体流程

```
合并 release PR / 推 tag / 手动触发
   ↓
release-please 计算版本（仅 push 到 main 时）→ 打 tag、创建 Release
   ↓
checkout 代码（不含任何密钥）
   ↓
安装工具链：Node · Rust + Android target · JDK 17 · Android SDK 37 / NDK 27
   ↓
从 GitHub Secrets 还原密钥库文件 + 生成签名配置文件（仅存在于 runner 临时目录）
   ↓
npx tauri android build --apk --target aarch64
   ↓
校验签名 → 上传签名 APK 为 workflow artifact → 附加到 Release
```

关键点：**密钥只在 runner 运行时还原，构建结束随 runner 销毁**，仓库里永远不出现。

---

## 3. 配置 GitHub Secrets

在仓库 `Settings → Secrets and variables → Actions → New repository secret` 添加 4 项：

| Secret 名称 | 含义 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 签名密钥库文件的 Base64 文本 |
| `ANDROID_KEY_ALIAS` | 签名配置中 `keyAlias` 对应的值 |
| `ANDROID_STORE_PASSWORD` | 签名配置中 `storePassword` 对应的值 |
| `ANDROID_KEY_PASSWORD` | 签名配置中 `keyPassword` 对应的值 |

> 项目的 `app/build.gradle.kts` 读取 `storeFile`、`storePassword`、`keyAlias`、`keyPassword` **四个键**。Tauri 官方 CI 文档示例用的是另一套键名，直接照抄会导致构建失败 —— 以本项目四个键为准。

生成 Base64 文本（**在本地执行，结果只粘贴到 Secret 输入框**）：

```bash
# macOS
base64 -i <密钥库文件> | pbcopy

# Linux
base64 -w0 <密钥库文件> | xclip -selection clipboard
```

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("<密钥库文件>")) | Set-Clipboard
```

`<密钥库文件>` 换成你本机密钥库的实际位置即可，**不要把这个路径或命令输出写进任何文档、脚本或提交记录**。Base64 只是编码、不是加密，获取了它等于获取了密钥库，因此只能存放在 Secrets 中。单个 Secret 上限约 48 KiB，一般密钥库远小于此。

---

## 4. 工作流

已落地在 [`.github/workflows/android-release.yml`](../.github/workflows/android-release.yml)：与桌面端仓库同一套结构，分两个 job——`release_please`（仅在 push 到 `main` 时运行，算版本、开 release PR）与 `android`（`needs` 前者，构建签名包并附加到 Release）；权限为 `contents: write` + `pull-requests: write`。触发方式与取包见第 5 节。相比下面的模板额外做了三件事：

| 额外步骤 | 作用 |
| --- | --- |
| 整理产物 | 按 `tauri.conf.json` 的版本重命名为 `JToolsBox-Mobile-<版本>-arm64.apk`，同时生成 `.sha256` |
| 校验签名 | 用 `apksigner verify` 判定是否真被签名；未签名时给 warning 并**跳过** Release 附加，避免分发装不上的包 |
| 附加到 Release | 仅在 tag 触发且已签名时 `gh release upload --clobber`，Release 不存在则先 create |

签名仍是**有条件**的：未配置 `ANDROID_KEYSTORE_BASE64` 时构建照常跑通，只是产物未签名、无法安装。四个 Secret 的键名必须与 `app/build.gradle.kts` 读取的四个键一一对应（见第 3 节）。

以下是原始模板，留作对照参考：

```yaml
name: android-release

on:
  workflow_dispatch:
  push:
    tags: ['v*']

jobs:
  android:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-linux-android

      - uses: swatinem/rust-cache@v2
        with:
          workspaces: ./src-tauri -> target

      - uses: android-actions/setup-android@v3

      - name: Install Android SDK components
        run: |
          # 平台包带小版本号：android-37.0，写成 android-37 会 "Failed to find package"
          sdkmanager --install "platforms;android-37.0" "build-tools;37.0.0" "ndk;27.0.12077973" "platform-tools"
          echo "NDK_HOME=$ANDROID_HOME/ndk/27.0.12077973" >> $GITHUB_ENV

      # 仓库里的 Gradle Wrapper 指向国内镜像，境外 runner 改回官方发行版
      - name: Use official Gradle distribution
        run: sed -i 's|mirrors.cloud.tencent.com/gradle/|services.gradle.org/distributions/|' src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties

      - run: npm ci

      - name: Inject Android signing
        env:
          KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
          KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          STORE_PASSWORD: ${{ secrets.ANDROID_STORE_PASSWORD }}
          KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          printf '%s' "$KEYSTORE_BASE64" | base64 -d > "$RUNNER_TEMP/release.jks"
          printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=%s\nkeyPassword=%s\n' \
            "$RUNNER_TEMP/release.jks" "$STORE_PASSWORD" "$KEY_ALIAS" "$KEY_PASSWORD" \
            > src-tauri/gen/android/keystore.properties

      - name: Build release APK
        run: npx tauri android build --apk --target aarch64

      - uses: actions/upload-artifact@v4
        with:
          name: JToolsBox-android-arm64
          path: src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk
```

模板说明：

- 签名相关值全部通过 `env` 传入，不直接把 `${{ secrets.* }}` 拼进 shell 命令，避免特殊字符导致命令注入或解析错误。
- 密钥库还原到 `$RUNNER_TEMP`，`storeFile` 用绝对路径，Gradle 可正确解析。
- `android-actions/setup-android@v3` 的 `packages` 默认值是 `tools platform-tools`，而 legacy `tools` 包已从 SDK 仓库移除，保留默认会以 `Failed to find package 'tools'` 失败。必须显式传 `packages: 'platform-tools'`。
- `tauri android build` 会自动重建被忽略的生成文件（`tauri.settings.gradle`、`app/tauri.properties` 等，含当前机器的 cargo registry 路径），**不要**把它们提交进仓库，也**不要**在工作流里跑 `android:init`。
- 官方新文档示例已升级到 `checkout@v7` / `setup-node@v6`；上面的 v4 系列同样可用，按你仓库的策略选择。
- 如果 CI 卡在 Maven 依赖下载，把 `gen/android/build.gradle.kts` 的仓库顺序改成官方源优先；本机加速请用用户级 Gradle 初始化脚本，不要为 CI 改坏本机网络，见 [更换机器发布指南](./new-machine-release.md#6-平台差异)。

---

## 5. 触发与取包

工作流与桌面端仓库（`nickynull/JToolsBox`）是同一套编排：`release_please` job 决定版本，`android` job 跟着构建。

| 入口 | 条件 | 结果 |
| --- | --- | --- |
| 合并 release PR | push 到 `main`，release-please 判定 `release_created=true` | 打 tag、建 Release，同一次运行里构建 APK 并附加 |
| 推 `v*` 标签 | 手动 `git tag v1.2.0 && git push origin v1.2.0` | 跳过 release-please，直接构建；Release 不存在则兜底创建 |
| 手动 Run workflow | Actions 页面 | 只构建并产出 artifact，不改动 Release |

### 日常发版

1. 合并功能 PR。提交信息遵循 Conventional Commits：`feat:` 涨 minor、`fix:` 涨 patch，`chore:` / `docs:` 不单独发版。
2. 等 `chore(main): release X.Y.Z` 这个 PR 出现，检查里面的 `CHANGELOG.md` 与版本号。
3. 合并它，剩下全自动。
4. 到 Releases 页确认 `JToolsBox-Mobile-<版本>-arm64.apk` 与 `.sha256` 已附上。

### 前置设置

仓库 `Settings → Actions → General` 需要勾选 *Allow GitHub Actions to create and approve pull requests*，否则 release-please 建不出 PR。workflow 里已声明 `contents: write` 与 `pull-requests: write`。

### 版本号

只在 `package.json` 里维护一份。release-please 依据 `release-please-config.json` 的 `extra-files` 同步 `src-tauri/Cargo.toml`（`$.package.version`）与 `src-tauri/tauri.conf.json`（`$.version`），`src/core/version.ts` 直接读取 `package.json` 的 `version`。`src-tauri/Cargo.lock` 里的版本不跟随更新，构建时 cargo 会自行修正，不影响产物。

### 两个别踩的坑

- **release-please 用 `GITHUB_TOKEN` 推的 tag 不会触发新的 workflow 运行**（GitHub 抑制 token 产生的连锁事件）。所以 `android` job 必须 `needs: release_please` 跟在同一个 run 里，不能改成靠 `push: tags` 去接。
- tag 必须打在**已包含工作流文件**的提交上。历史上 `v1.0.0` 的 tag 早于 workflow 入库，推送后没创建任何运行。

### 取包

构建结束后在该次 workflow 页面下载 artifact（保留 30 天），Release 里则是长期附件。下载后建议按 [本地发布指南](./local-release.md) 的签名校验步骤确认证书指纹与上一版一致，再分发。

### 备选：改用 tauri-action 的移动端支持

`tauri-apps/tauri-action@v1` 提供实验性的 `mobile: android` 参数，可在构建后创建 Release 并上传 APK：

```yaml
- uses: tauri-apps/tauri-action@v1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    mobile: android
    args: --apk --target aarch64
    tagName: app-v__VERSION__
    releaseName: 'JToolsBox v__VERSION__'
    releaseDraft: true
```

官方 README 明确把移动端支持标注为 **experimental**，且 SDK / NDK / 签名注入仍需自行配置。建议先用第 4 节的手写 job 跑通，再考虑替换。

### 桌面端与 iOS

- **桌面端**：另建一条 job，用 `tauri-action@v1` 的 Windows / macOS / Ubuntu matrix（不带 `mobile` 参数）；Ubuntu 需先安装 `libwebkit2gtk-4.1-dev`、`libappindicator3-dev`、`librsvg2-dev`、`patchelf` 等系统依赖。
- **iOS**：需要 `macos-latest` + Xcode + Apple 签名证书与描述文件，可用 `mobile: ios`。官方不建议把未签名的 `.ipa` 直接作为 Release 资产。建议单独建工作流，与 Android 解耦。

---

## 6. 安全红线

1. 密钥库文件、`keystore.properties`、任何口令或 Base64 文本都**不得**进入仓库、日志、产物或 artifact。
2. 不要在 `run` 里 `echo` / `cat` 任何 Secret，也不要用 `set -x` 打印执行命令。
3. 工作流模板中的 `${{ secrets.* }}` 只是引用；GitHub 会自动脱敏日志，但仍应避免把它们拼进命令行参数。
4. 来自 fork 的 PR 默认拿不到 Secrets；**不要**为了让 PR 构建通过就改用 `pull_request_target` 并 checkout 不可信代码，那等于把密钥暴露给任意贡献者。
5. 触发方式建议限定为 `workflow_dispatch` + 受保护的 tag，避免任意分支推送都消耗构建额度。
6. 密钥轮换会影响覆盖安装，必须与版本发布节奏一起规划；轮换前先确认用户升级路径。
7. CI 产物只做完整性校验（如生成 `.sha256`），不要在公开 Release 里附带签名配置文件或调试日志。

---

## 7. 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 构建成功但 APK 未签名 | `keystore.properties` 未生成或键名不对；Gradle 是「有条件签名」，缺文件不会报错。检查注入步骤是否执行、四个键是否齐全 |
| `base64 -d` 失败 | Secret 里混入了换行或空格；重新生成并粘贴纯 Base64 文本 |
| 找不到 NDK / SDK platform | 确认 `sdkmanager --install` 执行成功、`NDK_HOME` 指向安装的版本 |
| Gradle 下载超时 / 504 | `services.gradle.org` 与 `downloads.gradle.org` 现已重定向到 GitHub Releases，实测偶发 504。工作流会依次探测腾讯云镜像 → services → downloads，取第一个返回 200 的源写回 `distributionUrl`，并把 `networkTimeout` 提到 120 s（wrapper 默认 10 s 且不重试） |
| 报找不到某个 Tauri 插件的 Android 工程 | 生成文件被误提交；从仓库移除 `tauri.settings.gradle` 等生成文件，让 CLI 重建 |
| Rust 依赖拉取失败 | 检查 `src-tauri/.cargo/config.toml` 的代理设置；CI 通常无需代理 |
| `Resource not accessible by integration` | `GITHUB_TOKEN` 权限不足，在仓库 Settings → Actions → Workflow permissions 开启读写，或在 job 上声明 `contents: write` |
| 覆盖安装提示签名不一致 | CI 用的密钥库与历史版本不同；换回原密钥库，不要让用户卸载重装 |
