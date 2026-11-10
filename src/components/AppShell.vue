<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, House, Setting, Box } from "@element-plus/icons-vue";
import { getModule } from "../core/module/registry";

const route = useRoute();
const router = useRouter();
const isHome = computed(() => route.name === "home");

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
    // 主页不算工具页：从这里切走时，「工具」页签仍指向上一次停留的工具页
    if (!isSettings.value && !isHome.value) {
      lastToolsPath.value = route.fullPath;
      lastModuleId.value = moduleId.value;
    }
  },
  { immediate: true },
);

/**
 * 工具页签指向的模块：当前模块；在设置页或主页则用上次离开时所在的模块。
 * 文案与图标都从它派生，保证两者始终同步。
 */
const toolsTabModule = computed(() =>
  getModule(isSettings.value || isHome.value ? lastModuleId.value : moduleId.value),
);

const toolsTabLabel = computed(() => toolsTabModule.value?.name ?? "工具");
/** 无模块归属（首页）时退回通用图标 */
const toolsTabIcon = computed(() => toolsTabModule.value?.icon ?? Box);

function openTools() {
  if (isSettings.value || isHome.value) {
    // 从设置页 / 主页切回：原地返回离开工具页签时所在的那一页
    void router.push(lastToolsPath.value || "/");
    return;
  }
  // 已在工具页签内（含模块入口页与深层编辑页）：点当前页签保持原位。
  // 不要跳回应用主页；返回上一级交给顶栏返回按钮 / 系统返回键按 meta.back 处理。
}

function goHome() {
  void router.push({ name: "home" });
}

function goSettings() {
  void router.push({ name: "settings" });
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
    </header>

    <main class="content" :class="{ fill: fillLayout }">
      <slot />
    </main>

    <nav class="tabbar">
      <!-- 主页常驻最左：任何页面一键回主页（顶栏不再放主页按钮） -->
      <button
        class="tab tab-home"
        type="button"
        :class="{ active: isHome }"
        @click="goHome"
      >
        <el-icon :size="20"><House /></el-icon>
        <span>主页</span>
      </button>
      <button
        class="tab grow"
        type="button"
        :class="{ active: !isSettings && !isHome }"
        @click="openTools"
      >
        <el-icon :size="20"><component :is="toolsTabIcon" /></el-icon>
        <span class="tab-label">{{ toolsTabLabel }}</span>
      </button>
      <button
        class="tab tab-settings"
        type="button"
        :class="{ active: isSettings }"
        @click="goSettings"
      >
        <el-icon :size="20"><Setting /></el-icon>
        <span>设置</span>
      </button>
    </nav>
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
  background: var(--el-bg-color);
  /* 不用 backdrop-filter 毛玻璃：Android WebView 高频切页时重采样背景
     会触发渲染进程崩溃（真机验证中，确认后此注释改写为正式约定） */
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
  /*
   * 紧凑按钮当前约 40px（图标 20 + 左右内边距各 10），设置按钮约 42px
   *（中文文案 22 + 内边距 20）。最小宽度各取两倍以扩大点击区；
   * 用 min-width 而非 width，多语言文案变长时按钮仍会自己撑开。
   */
  --tab-min-home: 80px;
  --tab-min-settings: 84px;
  padding: 6px calc(var(--safe-right) + 12px) calc(var(--safe-bottom) + 6px)
    calc(var(--safe-left) + 12px);
  background: var(--el-bg-color);
  /* 同顶栏：去 backdrop-filter，避免合成器重采样背景崩溃 */
  border-top: 1px solid var(--el-border-color-lighter);
}

.tab {
  display: flex;
  /* 按内容自适应宽度；各按钮的 min-width 只保底，不锁死多语言文案宽度 */
  flex: 0 1 auto;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
  font-size: 0.68rem;
  /* 文案变长时不换行，避免把底栏撑高 */
  white-space: nowrap;
  color: var(--el-text-color-secondary);
  background: transparent;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

/* 工具页签吃掉剩余空间，名称过长时交给 .tab-label 省略 */
.tab.grow {
  flex: 1 1 0%;
  min-width: 0;
}

/* 最左侧的主页页签：与设置页签同宽，图标 + 文字 */
.tab-home {
  min-width: var(--tab-min-home);
}

/* 设置按钮同样给两倍最小宽度，文案仍按内容自适应 */
.tab-settings {
  min-width: var(--tab-min-settings);
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
