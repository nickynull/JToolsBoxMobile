<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import { Close, Search } from "@element-plus/icons-vue";
import { getModules } from "../core/module/registry";
import type { ToolModule } from "../core/module/types";
import { readJson, writeJson } from "../core/storage/driver";

/**
 * 必须早于 Android WebView 的长按判定（约 500ms），否则 touchcancel 会接管。
 */
const LONG_PRESS_MS = 350;
/** 手指轻微抖动 / 开始滚动就取消，避免误触发 */
const LONG_PRESS_SLOP = 10;
/** 拖动 / 长按结束后补发 click 的抑制窗口 */
const CLICK_SUPPRESS_MS = 800;

/** 主页卡片顺序的持久化 key（与模块数据同一套存储空间） */
const ORDER_KEY = "ui/home-order.json";

const router = useRouter();

const allModules = getModules();
/** 当前顺序（模块 id 列表）；持久化加载完成前先按注册顺序展示 */
const order = ref<string[]>(allModules.map((item) => item.id));

void readJson<string[]>(ORDER_KEY)
  .then((saved) => {
    if (!Array.isArray(saved)) {
      return;
    }
    // 只留现存模块，注册表里新出现的模块按注册顺序补到末尾
    const valid = saved.filter((id) =>
      allModules.some((item) => item.id === id),
    );
    for (const item of allModules) {
      if (!valid.includes(item.id)) {
        valid.push(item.id);
      }
    }
    order.value = valid;
  })
  .catch(() => {
    // 读不到就维持注册顺序，不阻断首页渲染
  });

async function persistOrder() {
  try {
    await writeJson(ORDER_KEY, order.value);
  } catch (error) {
    console.error("[home] 保存排序失败", error);
  }
}

/* ------------- 搜索 ------------- */

const query = ref("");

const cards = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  const list = order.value
    .map((id) => allModules.find((item) => item.id === id))
    .filter((item): item is ToolModule => item !== undefined);
  const filtered = keyword
    ? list.filter(
        (item) =>
          item.name.toLowerCase().includes(keyword) ||
          item.description.toLowerCase().includes(keyword),
      )
    : list;
  return filtered.map((module) => ({
    module,
    badge: module.badge?.() ?? null,
  }));
});

/* ------------- 长按拖动排序 ------------- */

const dragId = ref<string | null>(null);

let pressTimer: ReturnType<typeof setTimeout> | null = null;
let pressOrigin: { x: number; y: number } | null = null;
let pressItem: ToolModule | null = null;
/** 触摸补发的兼容鼠标事件要隔离，避免互相取消计时 */
let pressSource: "touch" | "mouse" | null = null;
/** 鼠标拖动必须听 window 级事件：指针一出卡片，卡片上的监听就断了 */
let windowMouseBound = false;
let suppressedId: string | null = null;
let suppressedAt = 0;

function cancelPress() {
  if (pressTimer !== null) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
  pressOrigin = null;
  pressItem = null;
  pressSource = null;
}

function beginPress(
  x: number,
  y: number,
  item: ToolModule,
  source: "touch" | "mouse",
) {
  cancelPress();
  pressOrigin = { x, y };
  pressItem = item;
  pressSource = source;
  pressTimer = setTimeout(() => {
    pressTimer = null;
    // 搜索过滤中显示的是子集，拖动会打乱持久化顺序，直接不支持
    if (!pressItem || query.value.trim()) {
      return;
    }
    dragId.value = pressItem.id;
    try {
      navigator.vibrate?.(15);
    } catch {
      // 无振动权限时静默忽略
    }
  }, LONG_PRESS_MS);
}

function movedTooFar(x: number, y: number) {
  return (
    pressOrigin !== null &&
    Math.hypot(x - pressOrigin.x, y - pressOrigin.y) > LONG_PRESS_SLOP
  );
}

/** 手指 / 鼠标悬到另一张卡片上就交换位置，TransitionGroup 负责 FLIP 动画 */
function handleDragHover(x: number, y: number) {
  const current = dragId.value;
  if (!current) {
    return;
  }
  const target = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>("[data-mid]");
  const targetId = target?.dataset.mid;
  if (!targetId || targetId === current) {
    return;
  }
  const from = order.value.indexOf(current);
  const to = order.value.indexOf(targetId);
  if (from < 0 || to < 0) {
    return;
  }
  const next = [...order.value];
  next.splice(to, 0, ...next.splice(from, 1));
  order.value = next;
}

function onTouchStart(event: TouchEvent, item: ToolModule) {
  if (event.touches.length !== 1) {
    cancelPress();
    return;
  }
  const touch = event.touches[0];
  if (touch) {
    beginPress(touch.clientX, touch.clientY, item, "touch");
  }
}

function onTouchMove(event: TouchEvent) {
  if (pressSource !== "touch") {
    return;
  }
  const touch = event.touches[0];
  if (!touch) {
    return;
  }
  if (!dragId.value) {
    if (movedTooFar(touch.clientX, touch.clientY)) {
      cancelPress();
    }
    return;
  }
  // 拖动中冻结页面滚动，把这段手势完全交给排序
  event.preventDefault();
  handleDragHover(touch.clientX, touch.clientY);
}

/** 拖动 / 长按结束：持久化顺序，并吃掉紧随其后的那次补发 click */
function finishPress() {
  if (dragId.value) {
    suppressedId = dragId.value;
    suppressedAt = Date.now();
    void persistOrder();
  }
  cancelPress();
  detachWindowMouse();
}

function onWindowMouseMove(event: MouseEvent) {
  if (pressSource !== "mouse") {
    return;
  }
  if (dragId.value) {
    handleDragHover(event.clientX, event.clientY);
  } else if (movedTooFar(event.clientX, event.clientY)) {
    cancelPress();
  }
}

function onWindowMouseUp() {
  finishPress();
}

function attachWindowMouse() {
  if (windowMouseBound) {
    return;
  }
  windowMouseBound = true;
  window.addEventListener("mousemove", onWindowMouseMove);
  window.addEventListener("mouseup", onWindowMouseUp);
}

function detachWindowMouse() {
  if (!windowMouseBound) {
    return;
  }
  windowMouseBound = false;
  window.removeEventListener("mousemove", onWindowMouseMove);
  window.removeEventListener("mouseup", onWindowMouseUp);
}

/** 触摸补发的兼容鼠标事件不参与计时 */
function fromTouch(event: MouseEvent) {
  const caps = (
    event as MouseEvent & {
      sourceCapabilities?: { firesTouchEvents?: boolean };
    }
  ).sourceCapabilities;
  return caps?.firesTouchEvents === true;
}

function onMouseDown(event: MouseEvent, item: ToolModule) {
  if (event.button !== 0 || pressSource === "touch" || fromTouch(event)) {
    return;
  }
  beginPress(event.clientX, event.clientY, item, "mouse");
  attachWindowMouse();
}

onBeforeUnmount(() => {
  cancelPress();
  detachWindowMouse();
});

function openModule(module: ToolModule) {
  // 拖动 / 长按抬手后浏览器会补发一次 click，这里吃掉，避免误进工具
  if (
    suppressedId === module.id &&
    Date.now() - suppressedAt < CLICK_SUPPRESS_MS
  ) {
    suppressedId = null;
    return;
  }
  void router.push({ name: module.entry });
}

const today = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());
</script>

<template>
  <div class="page">
    <section class="intro">
      <p class="date">{{ today }}</p>
      <h2>本机工具箱</h2>
      <p class="sub">所有数据只存在这台设备上</p>
    </section>

    <TransitionGroup v-if="cards.length > 0" tag="div" name="cards" class="grid">
      <button
        v-for="card in cards"
        :key="card.module.id"
        type="button"
        class="card"
        :class="{ dragging: dragId === card.module.id }"
        :data-mid="card.module.id"
        @click="openModule(card.module)"
        @touchstart.passive="onTouchStart($event, card.module)"
        @touchmove="onTouchMove"
        @touchend="finishPress"
        @touchcancel="finishPress"
        @mousedown="onMouseDown($event, card.module)"
        @mouseup="finishPress"
      >
        <span
          class="icon"
          :style="{
            background: card.module.accent + '1f',
            color: card.module.accent,
          }"
        >
          <el-icon :size="22"><component :is="card.module.icon" /></el-icon>
        </span>
        <strong class="name">{{ card.module.name }}</strong>
        <small class="desc">{{ card.module.description }}</small>
        <span
          v-if="card.badge"
          class="badge"
          :style="{
            color: card.module.accent,
            background: card.module.accent + '1a',
          }"
        >
          {{ card.badge }}
        </span>
      </button>
    </TransitionGroup>
    <p v-else class="empty">没有匹配的工具</p>

    <!--
      搜索条放在文档流底部而不是 fixed：fixed 版在键盘弹出时会被 WebView
      把滚动容器滚到底，卡片整体顶出视口；文档流只需最小滚动，卡片始终可见。
    -->
    <div class="searchbar">
      <el-icon :size="16"><Search /></el-icon>
      <input
        v-model="query"
        type="search"
        class="search-input"
        placeholder="搜索功能"
        enterkeyhint="search"
      >
      <button
        v-if="query"
        type="button"
        class="search-clear"
        aria-label="清空搜索"
        @click="query = ''"
      >
        <el-icon :size="14"><Close /></el-icon>
      </button>
    </div>

    <p class="tip">
      长按卡片可拖动排序；卸载或换机前，请到设置里导出备份。
    </p>
  </div>
</template>

<style scoped>
/* 底部固定搜索条改为文档流后，页面高度交给壳层滚动，无需额外预留 */
.page {
  position: relative;
}

.intro {
  padding: 4px 2px 16px;
}

.date {
  margin: 0 0 6px;
  font-size: 0.72rem;
  color: var(--el-text-color-secondary);
  letter-spacing: 0.5px;
}

.intro h2 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 600;
}

.sub {
  margin: 6px 0 0;
  font-size: 0.78rem;
  color: var(--el-text-color-secondary);
}

.grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

/* TransitionGroup 的 FLIP 位移动画：交换位置时平滑滑过去 */
.cards-move {
  transition: transform 0.2s ease;
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  min-height: 132px;
  padding: 14px;
  text-align: left;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
  cursor: pointer;
  transition:
    transform 0.15s ease,
    border-color 0.15s ease;
}

.card:active {
  transform: scale(0.98);
  border-color: var(--el-border-color);
}

/* 拖动中的卡片：放大浮起、不接收指针（让 elementFromPoint 穿透到下层卡片） */
.card.dragging {
  z-index: 5;
  background: var(--el-bg-color);
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 10px 24px rgb(0 0 0 / 18%);
  transform: scale(1.03);
  pointer-events: none;
  /* 拖动跟手，不做过渡；同时也盖过 .cards-move 的 transition */
  transition: none;
}

.icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
}

.name {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.desc {
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.badge {
  position: absolute;
  top: 14px;
  right: 14px;
  padding: 2px 8px;
  font-size: 0.65rem;
  font-weight: 500;
  border-radius: 999px;
}

.empty {
  margin: 32px 0;
  font-size: 0.82rem;
  text-align: center;
  color: var(--el-text-color-secondary);
}

.tip {
  margin: 20px 0 0;
  font-size: 0.72rem;
  text-align: center;
  color: var(--el-text-color-placeholder);
}

/* ---- 搜索条：文档流底部，胶囊造型；输入框不受全局禁止选中影响 ---- */
.searchbar {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 44px;
  margin-top: 16px;
  padding: 0 14px;
  color: var(--el-text-color-secondary);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 22px;
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  font-size: 0.9rem;
  color: var(--el-text-color-primary);
  background: transparent;
  border: none;
  outline: none;
  /* 去掉 WebKit search 输入的原生样式与取消按钮，用自定义清空钮 */
  -webkit-appearance: none;
  appearance: none;
}

.search-input::-webkit-search-cancel-button,
.search-input::-webkit-search-decoration {
  -webkit-appearance: none;
  appearance: none;
}

.search-input::placeholder {
  color: var(--el-text-color-placeholder);
}

.search-clear {
  display: grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  border: none;
  border-radius: 50%;
  cursor: pointer;
}
</style>
