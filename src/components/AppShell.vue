<script setup lang="ts">
import { computed, ref, watch } from "vue";
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
/**
 * 满高布局：路由声明 `meta.layout = "fill"` 后，`.content` 不再滚动、也不留内边距，
 * 整块高度交给页面自己切分（常见做法：上部内容区 `flex:1` + `overflow-y:auto`，
 * 下部吸底操作栏、不随内容滚动）。
 */
const fillLayout = computed(() => route.meta.layout === "fill");

/**
 * 记住最后一次停留的工具页（含模块内页与首页）。
 * 底栏是「页签」语义：从设置切回工具时应原地返回，而不是重置到首页。
 */
const lastToolsPath = ref("");
/** 同一次记录里的工具模块 id，用于设置页也能显示「回到哪个工具」 */
const lastModuleId = ref<string | undefined>();

watch(
  () => route.fullPath,
  () => {
    if (!isSettings.value) {
      lastToolsPath.value = route.fullPath;
      lastModuleId.value = moduleId.value;
    }
  },
  { immediate: true },
);

/**
 * 工具页签指向的模块：当前模块；在设置页则用上次离开时所在的模块。
 * 文案与图标都从它派生，保证两者始终同步。
 */
const toolsTabModule = computed(() =>
  getModule(isSettings.value ? lastModuleId.value : moduleId.value),
);

const toolsTabLabel = computed(() => toolsTabModule.value?.name ?? "工具");
/** 无模块归属（首页）时退回通用图标 */
const toolsTabIcon = computed(() => toolsTabModule.value?.icon ?? Box);

function openTools() {
  // 在设置页：回到离开工具页签时的那一页
  if (isSettings.value) {
    void router.push(lastToolsPath.value || "/");
    return;
  }
  // 已在工具页签内（深一层）：点当前页签回到页签根
  if (route.name !== "home") {
    void router.push({ name: "home" });
  }
}

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

    <main class="content" :class="{ fill: fillLayout }">
      <slot />
    </main>

    <nav class="tabbar">
      <button
        class="tab"
        type="button"
        :class="{ active: !isSettings }"
        @click="openTools"
      >
        <el-icon :size="20"><component :is="toolsTabIcon" /></el-icon>
        <span class="tab-label">{{ toolsTabLabel }}</span>
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

/* 满高布局：滚动与内边距都交给页面，壳层只负责给出高度 */
.content.fill {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
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

/* 工具页签显示模块名，名字过长时省略而不是撑破页签 */
.tab-label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
