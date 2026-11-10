/**
 * 版本号单一来源：package.json 的 version。
 * release-please 发版时同时改 package.json、Cargo.toml、tauri.conf.json，
 * 这里直接读取，避免出现「记得手动同步的第四个地方」。
 *
 * 用具名导入而非 `import pkg`：整包默认导入会让打包器把 dependencies /
 * devDependencies 一并内联进产物，具名导入只保留 version 一个字段。
 */
import { version as pkgVersion } from "../../package.json";

export const APP_VERSION = pkgVersion;
export const APP_NAME = "JToolsBox";
export const BACKUP_EXT = "jtbx";
export const BACKUP_SCHEMA = 1;
