import type { Component } from "vue";
import type { RouteRecordRaw } from "vue-router";

/**
 * 工具模块契约。
 *
 * 新增一个子功能 = 新建 `src/modules/<id>/`，导出一个 ToolModule，
 * 然后在 `src/app/bootstrap.ts` 里 registerModule 一次。
 * 模块自带路由与数据文件，主壳不关心其内部实现。
 */
export interface ToolModule {
  /** 唯一标识，同时作为数据目录名：modules/<id>/data.json */
  id: string;
  name: string;
  description: string;
  icon: Component;
  /** 卡片主色，用于图标底色与角标 */
  accent: string;
  /** 入口路由 name */
  entry: string;
  routes: RouteRecordRaw[];
  /** 数据 schema 版本，供日后迁移 */
  version: number;
  /** 首页卡片的动态角标，返回 null 表示不显示 */
  badge?: () => string | null;
  /** 应用启动时预加载数据（用于首页角标、提醒检查） */
  preload?: () => Promise<void>;
}
