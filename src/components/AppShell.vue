<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, Grid, Setting, Box } from "@element-plus/icons-vue";
import { getModule } from "../core/module/registry";
import ModuleSwitcher from "./ModuleSwitcher.vue";

const route = useRoute();
const router = useRouter();
const switcherOpen = ref(false);

const moduleId = computed(() => route.meta.moduleId as string | undefined);
const currentModule = computed(() => getModule(moduleId.value));
const title = computed(() => (route.meta.title as string) ?? "JToolsBox");
const backTarget = computed(() => route.meta.back as string | undefined);
const isSettings = computed(() => route.name === "settings");

function goBack() {
  if (backTarget.value) {
    void router.push({ name: backTarget.value });
  } else {
    void router.push({ name: "home" });
  }
}
</script>

<template>
  <div class="shell">
    <header class="bar">
      <button
        v-if="backTarget"
        class="bar-btn"
        type="button"
        aria-label="返回"
        @click="goBack"
      >
        <el-icon :size="20"><ArrowLeft /></el-icon>
      </button>
      <div class="bar-title">
        <h1>{{ title }}</h1>
        <p v-if="currentModule">{{ currentModule.description }}</p>
      </div>
      <button
        v-if="moduleId"
        class="bar-btn"
        type="button"
        aria-label="切换功能"
        @click="switcherOpen = true"
      >
        <el-icon :size="20"><Grid /></el-icon>
      </button>
    </header>

    <main class="content">
      <slot />
    </main>

    <nav class="tabbar">
      <button
        class="tab"
        type="button"
        :class="{ active: !isSettings }"
        @click="router.push({ name: 'home' })"
      >
        <el-icon :size="20"><Box /></el-icon>
        <span>工具</span>
      </button>
      <button
        class="tab"
        type="button"
        :class="{ active: isSettings }"
        @click="router.push({ name: 'settings' })"
      >
        <el-icon :size="20"><Setting /></el-icon>
        <span>设置</span>
      </button>
    </nav>

    <ModuleSwitcher v-model="switcherOpen" :current="moduleId" />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 560px;
  margin: 0 auto;
  background: var(--el-bg-color-page);
}

.bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: calc(var(--safe-top) + 10px) calc(var(--safe-right) + 12px) 10px
    calc(var(--safe-left) + 12px);
  background: color-mix(in srgb, var(--el-bg-color) 86%, transparent);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.bar-btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  color: var(--el-text-color-regular);
  background: transparent;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.bar-btn:active {
  background: var(--el-fill-color);
}

.bar-title {
  flex: 1;
  min-width: 0;
}

.bar-title h1 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0.2px;
}

.bar-title p {
  margin: 2px 0 0;
  overflow: hidden;
  font-size: 0.72rem;
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 14px calc(var(--safe-right) + 16px) 20px
    calc(var(--safe-left) + 16px);
  -webkit-overflow-scrolling: touch;
}

.tabbar {
  display: flex;
  gap: 4px;
  padding: 6px calc(var(--safe-right) + 12px) calc(var(--safe-bottom) + 6px)
    calc(var(--safe-left) + 12px);
  background: color-mix(in srgb, var(--el-bg-color) 92%, transparent);
  backdrop-filter: blur(14px);
  border-top: 1px solid var(--el-border-color-lighter);
}

.tab {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 0;
  font-size: 0.68rem;
  color: var(--el-text-color-secondary);
  background: transparent;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.tab.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
</style>
