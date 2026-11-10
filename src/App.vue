<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import AppShell from "./components/AppShell.vue";

/**
 * 页面缓存由路由自己声明：`meta.keepAlive` 为真就进 `<keep-alive>`，
 * 壳层不认识具体模块。KeepAlive 的 include 只认组件 name，
 * 所以这里从路由表里取组件名（对应组件需 `defineOptions({ name })`）。
 */
const router = useRouter();

const cachedNames = computed(() =>
  router
    .getRoutes()
    .filter((record) => record.meta.keepAlive)
    .map(
      (record) =>
        (record.components?.default as unknown as { name?: string } | undefined)
          ?.name,
    )
    .filter((name): name is string => typeof name === "string" && name !== ""),
);
</script>

<template>
  <AppShell>
    <RouterView v-slot="{ Component }">
      <keep-alive :include="cachedNames">
        <component :is="Component" />
      </keep-alive>
    </RouterView>
  </AppShell>
</template>
