<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
} from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import {
  Check,
  Close,
  Delete,
  Finished,
  Plus,
  Search,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { describeRemaining } from "../../../core/date";
import { registerBackInterceptor } from "../../../core/back";
import {
  activeItems,
  addCategory,
  categoryColorOf,
  categoryLabelOf,
  categoryOptions,
  categoryUsage,
  isBuiltinCategory,
  removeCategory,
  removeItems,
  setCategoryColor,
  statusOf,
} from "../store";
import {
  CATEGORY_PALETTE,
  STATUS_META,
  normalizeHexColor,
  type CategoryDef,
  type ExpiryItem,
  type ExpiryStatus,
} from "../types";

const router = useRouter();
const keyword = ref("");
const category = ref("all");

/** 路由 `meta.keepAlive` 靠组件 name 命中，必须显式声明 */
defineOptions({ name: "ExpiryListView" });

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return activeItems.value.filter((item) => {
    if (category.value !== "all" && item.category !== category.value) {
      return false;
    }
    if (!kw) {
      return true;
    }
    return (
      item.name.toLowerCase().includes(kw) ||
      item.note.toLowerCase().includes(kw)
    );
  });
});

const groups = computed(() => {
  const buckets: Record<ExpiryStatus, ExpiryItem[]> = {
    expired: [],
    soon: [],
    month: [],
    normal: [],
  };
  for (const item of filtered.value) {
    buckets[statusOf(item)].push(item);
  }
  return (["expired", "soon", "month", "normal"] as ExpiryStatus[])
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ meta: STATUS_META[key], items: buckets[key] }));
});

const stats = computed(() => {
  const items = activeItems.value;
  return {
    total: items.length,
    expired: items.filter((item) => statusOf(item) === "expired").length,
    soon: items.filter((item) => statusOf(item) === "soon").length,
  };
});

function openItem(item: ExpiryItem) {
  void router.push({ name: "expiry-edit", params: { id: item.id } });
}

function create() {
  // 把主页当前筛选的分类带进新增页，省得再选一次
  void router.push({
    name: "expiry-new",
    query: category.value === "all" ? {} : { category: category.value },
  });
}

/* ------------- 多选删除 ------------- */

const selecting = ref(false);
/** 选中项 id 集合；用 Set 便于 O(1) 判断与去重 */
const selected = ref(new Set<string>());

/* ------------- 侧滑露出删除 ------------- */

/** 删除按钮宽度，也是完全展开时的位移量 */
const SWIPE_OPEN = 78;
/** 横向位移超过这个值才判定为侧滑，避免影响轻点和竖向滚动 */
const SWIPE_SLOP = 8;
/** 松手时位移超过这个值就吸附展开 */
const SWIPE_TRIGGER = 36;

/** 当前展开的那一条；同时只允许一条展开 */
const swipedId = ref<string | null>(null);
/** 正在拖动的那一条与其实时位移（仅用于跟随手指，不参与吸附判断） */
const dragId = ref<string | null>(null);
const dragDx = ref(0);

let swipe: {
  id: string;
  startX: number;
  startY: number;
  /** 本次手势的起始位移：已展开的条目从 -SWIPE_OPEN 开始 */
  base: number;
  active: boolean;
} | null = null;

function closeSwipe() {
  swipedId.value = null;
  dragId.value = null;
  dragDx.value = 0;
  swipe = null;
}

/** 拖动中跟手；其余情况取展开/收起的目标位置 */
function itemStyle(item: ExpiryItem) {
  const dx =
    dragId.value === item.id
      ? dragDx.value
      : swipedId.value === item.id
        ? -SWIPE_OPEN
        : 0;
  return { transform: `translateX(${dx}px)` };
}

/**
 * 收尾：commit=true 按位移决定吸附方向（抬手），否则回退到手势开始前的状态
 * （系统抢事件等异常中断）。侧滑会消耗掉补发的 click，避免顺带进编辑页。
 */
function endSwipe(commit: boolean) {
  if (!swipe) {
    dragId.value = null;
    dragDx.value = 0;
    return;
  }
  if (swipe.active) {
    if (commit) {
      swipedId.value = dragDx.value <= -SWIPE_TRIGGER ? swipe.id : null;
      suppressedId = swipe.id;
      suppressedAt = Date.now();
    } else {
      swipedId.value = swipe.base < 0 ? swipe.id : null;
    }
  }
  swipe = null;
  dragId.value = null;
  dragDx.value = 0;
}

/* ------------- 长按进入多选 ------------- */

/**
 * 必须**早于** Android WebView 自己的长按判定（约 500ms）：系统一旦认定长按，
 * 会派发 touchcancel 接管后续事件，和它同时起跑很容易被抢先取消。
 */
const LONG_PRESS_MS = 350;
/** 手指轻微抖动 / 开始滚动就取消，避免误触发 */
const LONG_PRESS_SLOP = 12;
/** 补发 click 的抑制窗口，从触摸/鼠标结束时刻算起 */
const CLICK_SUPPRESS_MS = 800;

let pressTimer: ReturnType<typeof setTimeout> | null = null;
let pressOrigin: { x: number; y: number } | null = null;
let pressItem: ExpiryItem | null = null;
/** 本次按压来源；触摸序列补发的兼容鼠标事件必须隔离，否则会互相取消计时 */
let pressSource: "touch" | "mouse" | null = null;
/** 刚被长按的条目 id，用于只吃掉它自己的那次补发 click */
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

/** 长按命中：进入多选并勾中该条；重复调用无副作用 */
function activateSelection(item: ExpiryItem) {
  suppressedId = item.id;
  suppressedAt = Date.now();
  // 已在多选模式时保留其它勾选项，只把长按这条加进来
  if (!selecting.value) {
    selecting.value = true;
    selected.value.clear();
  }
  selected.value.add(item.id);
}

function beginPress(
  x: number,
  y: number,
  item: ExpiryItem,
  source: "touch" | "mouse",
) {
  cancelPress();
  pressOrigin = { x, y };
  pressItem = item;
  pressSource = source;
  pressTimer = setTimeout(() => {
    pressTimer = null;
    if (!pressItem) {
      return;
    }
    activateSelection(pressItem);
  }, LONG_PRESS_MS);
}

function endPress() {
  cancelPress();
  // 以结束时刻重新计时：按多久都不影响对紧随其后那次 click 的判断；
  // 若浏览器根本没补发 click，窗口过后自动失效，不会吞掉下一次正常点击
  if (suppressedId !== null) {
    suppressedAt = Date.now();
  }
}

function movedTooFar(x: number, y: number) {
  return (
    pressOrigin !== null &&
    Math.hypot(x - pressOrigin.x, y - pressOrigin.y) > LONG_PRESS_SLOP
  );
}

/** 触摸设备会补发兼容鼠标事件，跳过以免和 touch 逻辑重复计时 */
function fromTouch(event: MouseEvent) {
  const caps = (
    event as MouseEvent & {
      sourceCapabilities?: { firesTouchEvents?: boolean };
    }
  ).sourceCapabilities;
  return caps?.firesTouchEvents === true;
}

function onTouchStart(event: TouchEvent, item: ExpiryItem) {
  if (event.touches.length !== 1) {
    cancelPress();
    swipe = null;
    return;
  }
  const touch = event.touches[0];
  if (!touch) {
    return;
  }
  // 多选态只做勾选，不参与侧滑
  swipe = selecting.value
    ? null
    : {
        id: item.id,
        startX: touch.clientX,
        startY: touch.clientY,
        base: swipedId.value === item.id ? -SWIPE_OPEN : 0,
        active: false,
      };
  beginPress(touch.clientX, touch.clientY, item, "touch");
}

function onTouchMove(event: TouchEvent) {
  const touch = event.touches[0];
  if (event.touches.length !== 1 || !touch) {
    cancelPress();
    return;
  }

  // 侧滑：先判定手势方向，横向占优才接管，否则交还给页面竖向滚动
  if (swipe) {
    const dx = touch.clientX - swipe.startX;
    const dy = touch.clientY - swipe.startY;
    if (!swipe.active) {
      if (Math.abs(dx) > SWIPE_SLOP && Math.abs(dx) > Math.abs(dy)) {
        swipe.active = true;
        dragId.value = swipe.id;
        dragDx.value = swipe.base;
        // 侧滑优先于长按，避免手上还在横移却弹出多选
        cancelPress();
      } else if (Math.abs(dy) > SWIPE_SLOP) {
        swipe = null;
      }
    }
    if (swipe && swipe.active) {
      // 只允许在「完全展开」和「收起」之间移动，越界不再跟手
      dragDx.value = Math.min(0, Math.max(-SWIPE_OPEN, swipe.base + dx));
    }
  }

  if (pressSource === "touch" && movedTooFar(touch.clientX, touch.clientY)) {
    cancelPress();
  }
}

function onTouchEnd() {
  endSwipe(true);
  endPress();
}

function onTouchCancel() {
  endSwipe(false);
  endPress();
}

function onMouseDown(event: MouseEvent, item: ExpiryItem) {
  if (event.button !== 0 || pressSource === "touch" || fromTouch(event)) {
    return;
  }
  beginPress(event.clientX, event.clientY, item, "mouse");
}

function onMouseMove(event: MouseEvent) {
  if (pressSource !== "mouse" || !pressOrigin) {
    return;
  }
  if (movedTooFar(event.clientX, event.clientY)) {
    cancelPress();
  }
}

/** 鼠标按住后移出条目就取消；触摸补发的合成鼠标事件不参与 */
function onMouseLeave() {
  if (pressSource === "mouse") {
    cancelPress();
  }
}

/**
 * 兜底：部分 WebView 会把系统长按表现成 contextmenu。若 350ms 的计时被
 * touchcancel 抢先取消，这里补一次；桌面右键（button 2）忽略。
 */
function onItemContextMenu(item: ExpiryItem, event: MouseEvent) {
  if (event.button === 2 || suppressedId === item.id) {
    return;
  }
  activateSelection(item);
}

/* ------------- 返回键 / 页面缓存 -------------- */

/** 多选与侧滑展开是页内临时状态，返回手势要先把它们逐层收掉（见 core/back.ts） */
function onBackPressed(): boolean {
  if (swipedId.value !== null) {
    closeSwipe();
    return true;
  }
  if (selecting.value) {
    toggleSelecting();
    return true;
  }
  return false;
}

let removeBack: (() => void) | null = null;

/**
 * 本页被 keep-alive 缓存，实例会一直存活：拦截器必须跟着激活/失活注册与注销，
 * 否则在新增 / 编辑页按返回会被这里先吃掉。
 */
function attachBack() {
  removeBack ??= registerBackInterceptor(onBackPressed);
}

function detachBack() {
  removeBack?.();
  removeBack = null;
}

/** 壳层的滚动容器；失活后祖先链已断开，激活时缓存一次 */
const pageEl = ref<HTMLElement | null>(null);
let scroller: HTMLElement | null = null;
let savedScrollTop = 0;

function findScroller(): HTMLElement | null {
  let node: HTMLElement | null = pageEl.value?.parentElement ?? null;
  while (node) {
    if (node.classList.contains("content")) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

// 离开前记录滚动位置：这时 DOM 还在，deactivated 之后已经拿不到真实值
onBeforeRouteLeave(() => {
  if (scroller) {
    savedScrollTop = scroller.scrollTop;
  }
});

onActivated(() => {
  attachBack();
  scroller ??= findScroller();
  if (savedScrollTop > 0 && scroller) {
    const target = scroller;
    const top = savedScrollTop;
    // 等缓存节点重新插回 DOM 再恢复，否则会被浏览器夹回 0
    void nextTick(() => {
      target.scrollTop = top;
    });
  }
});

onDeactivated(() => {
  cancelPress();
  closeSwipe();
  detachBack();
});

onBeforeUnmount(() => {
  cancelPress();
  closeSwipe();
  detachBack();
});

const allPicked = computed(
  () =>
    filtered.value.length > 0 &&
    filtered.value.every((item) => selected.value.has(item.id)),
);

function toggleSelecting() {
  closeSwipe();
  selecting.value = !selecting.value;
  selected.value.clear();
}

function onItemTap(item: ExpiryItem) {
  // 长按抬手 / 侧滑收尾后浏览器会补发一次 click：非多选态会误进编辑页，
  // 多选态会把刚勾中的项又取消掉，这里只吃掉被操作那一条的补发 click
  if (
    suppressedId === item.id &&
    Date.now() - suppressedAt < CLICK_SUPPRESS_MS
  ) {
    suppressedId = null;
    return;
  }
  // 有展开的删除按钮时，点击先收起，避免误进编辑页
  if (swipedId.value !== null) {
    closeSwipe();
    return;
  }
  if (!selecting.value) {
    openItem(item);
    return;
  }
  if (selected.value.has(item.id)) {
    selected.value.delete(item.id);
  } else {
    selected.value.add(item.id);
  }
}

/** 只影响当前筛选出来的条目，避免「全选」把看不见的记录也带走 */
function toggleAll() {
  if (allPicked.value) {
    for (const item of filtered.value) {
      selected.value.delete(item.id);
    }
    return;
  }
  for (const item of filtered.value) {
    selected.value.add(item.id);
  }
}

async function deleteSelected() {
  const ids = [...selected.value];
  if (ids.length === 0) {
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${ids.length} 件物品？删除后无法恢复。`,
      "删除物品",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        // MessageBox 默认不吃 ESC，系统返回键靠它关浮层
        closeOnPressEscape: true,
      },
    );
  } catch {
    return;
  }
  const removed = await removeItems(ids);
  ElMessage.success(`已删除 ${removed} 件物品`);
  toggleSelecting();
}

/** 单条删除：侧滑露出的按钮触发，与批量删除同样二次确认 */
async function deleteOne(item: ExpiryItem) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${item.name}」？删除后无法恢复。`,
      "删除物品",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        closeOnPressEscape: true,
      },
    );
  } catch {
    return;
  }
  const removed = await removeItems([item.id]);
  closeSwipe();
  if (removed > 0) {
    ElMessage.success(`已删除「${item.name}」`);
  }
}

/* ------------- 分类管理 ------------- */

const categoryDialog = ref(false);
const newCategory = ref("");
/** 正在调色的分类 id；同一时刻只展开一个取色板 */
const colorEditing = ref<string | null>(null);
/** 手输色值输入框的内容，展开取色板时用当前颜色初始化 */
const customColor = ref("");
/** 取色器绑定的值：必须是合法色值，手输无效时不污染它 */
const pickerColor = ref("#409EFF");
/** 手输内容是否已是合法色值，控制「应用」按钮 */
const customColorValid = computed(
  () => normalizeHexColor(customColor.value) !== null,
);

function openCategoryDialog() {
  newCategory.value = "";
  colorEditing.value = null;
  categoryDialog.value = true;
}

function toggleColorEditor(cat: CategoryDef) {
  if (colorEditing.value === cat.id) {
    colorEditing.value = null;
    return;
  }
  colorEditing.value = cat.id;
  // 两种取色方式共用当前色起步：输入框给完整色值，取色器只接受合法值
  customColor.value = cat.color;
  pickerColor.value = normalizeHexColor(cat.color) ?? "#409EFF";
}

/**
 * 三种取色入口（预设块 / 手输 / 调色板）最终都落到这里：
 * 规范化 → 落盘。调色板走 `collapse: false`，因为面板刚关掉就收起整行会很突兀。
 */
async function applyColor(
  target: CategoryDef,
  input: string,
  options: { collapse?: boolean; toast?: boolean } = {},
) {
  const { collapse = true, toast = true } = options;
  const color = normalizeHexColor(input);
  if (!color) {
    ElMessage.warning("颜色格式不对，请填 #RRGGBB，如 #409EFF");
    return;
  }
  if (collapse) {
    colorEditing.value = null;
  }
  if (target.color.toLowerCase() === color.toLowerCase()) {
    return;
  }
  await setCategoryColor(target.id, color);
  customColor.value = color;
  pickerColor.value = color;
  if (toast) {
    ElMessage.success(`「${target.label}」颜色已更新`);
  }
}

/** 点预设色块 */
function pickColor(target: CategoryDef, color: string) {
  void applyColor(target, color);
}

/** 手输色值后回车或点「应用」 */
function submitCustomColor(target: CategoryDef) {
  void applyColor(target, customColor.value);
}

/** 调色板选完（el-color-picker 在面板确定时触发 change） */
function pickCustomColor(target: CategoryDef, value: string | null) {
  if (typeof value !== "string") {
    return;
  }
  void applyColor(target, value, { collapse: false, toast: false });
}

async function submitCategory() {
  const label = newCategory.value.trim();
  if (!label) {
    return;
  }
  const created = await addCategory(label);
  if (!created) {
    ElMessage.warning("该分类已存在");
    return;
  }
  newCategory.value = "";
  ElMessage.success(`已添加「${created.label}」`);
}

async function dropCategory(target: CategoryDef) {
  const used = categoryUsage(target.id);
  if (used > 0) {
    ElMessage.warning(`还有 ${used} 件物品在用「${target.label}」，请先改分类`);
    return;
  }
  const done = await removeCategory(target.id);
  if (!done) {
    ElMessage.error("删除失败");
    return;
  }
  if (category.value === target.id) {
    category.value = "all";
  }
  ElMessage.success("已删除");
}
</script>

<template>
  <div ref="pageEl" class="page" :class="{ 'sel-mode': selecting }">
    <section class="stats">
      <div class="stat">
        <strong>{{ stats.total }}</strong>
        <small>全部</small>
      </div>
      <div class="stat">
        <strong class="warn">{{ stats.soon }}</strong>
        <small>7 天内</small>
      </div>
      <div class="stat">
        <strong class="danger">{{ stats.expired }}</strong>
        <small>已过期</small>
      </div>
    </section>

    <el-input
      v-model="keyword"
      placeholder="搜索物品名称或备注"
      clearable
      :prefix-icon="Search"
      class="search"
    />

    <div class="filter">
      <el-select v-model="category" class="filter-select" placeholder="全部分类">
        <el-option label="全部分类" value="all" />
        <el-option
          v-for="option in categoryOptions"
          :key="option.id"
          :value="option.id"
          :label="option.label"
        >
          <span class="option">
            <i :style="{ background: option.color }" />
            <span>{{ option.label }}</span>
          </span>
        </el-option>
      </el-select>
      <button
        v-if="!selecting"
        type="button"
        class="filter-btn is-add"
        aria-label="管理分类"
        @click="openCategoryDialog"
      >
        <el-icon :size="14"><Plus /></el-icon>
        <span>分类</span>
      </button>
      <button
        type="button"
        class="filter-btn"
        :class="{ 'is-on': selecting }"
        :aria-label="selecting ? '退出多选' : '多选'"
        @click="toggleSelecting"
      >
        <el-icon :size="14">
          <component :is="selecting ? Close : Finished" />
        </el-icon>
        <span>{{ selecting ? "退出" : "多选" }}</span>
      </button>
    </div>

    <div v-if="groups.length === 0" class="empty">
      <p>{{ stats.total === 0 ? "还没有记录物品" : "没有符合条件的物品" }}</p>
      <small>
        {{
          stats.total === 0
            ? "点击右下角按钮添加第一件物品"
            : "换个关键词或分类试试"
        }}
      </small>
    </div>

    <section v-for="group in groups" :key="group.meta.key" class="group">
      <header>
        <span class="dot" :style="{ background: group.meta.color }" />
        <h3>{{ group.meta.label }}</h3>
        <span class="count">{{ group.items.length }}</span>
      </header>

      <div
        v-for="item in group.items"
        :key="item.id"
        class="row"
        :class="{
          'is-open': swipedId === item.id,
          'is-dragging': dragId === item.id,
        }"
      >
        <button
          v-if="!selecting"
          type="button"
          class="row-del"
          aria-label="删除"
          @click.stop="deleteOne(item)"
        >
          <el-icon :size="17"><Delete /></el-icon>
          <span>删除</span>
        </button>
        <article
          class="item"
          :class="{
            picked: selecting && selected.has(item.id),
            dragging: dragId === item.id,
          }"
          :style="itemStyle(item)"
          @click="onItemTap(item)"
          @touchstart.passive="onTouchStart($event, item)"
          @touchmove.passive="onTouchMove"
          @touchend="onTouchEnd"
          @touchcancel="onTouchCancel"
          @mousedown="onMouseDown($event, item)"
          @mousemove="onMouseMove"
          @mouseup="endPress"
          @mouseleave="onMouseLeave"
          @contextmenu="onItemContextMenu(item, $event)"
        >
          <span v-if="selecting" class="pick">
            <el-icon v-if="selected.has(item.id)" :size="12"><Check /></el-icon>
          </span>
          <span
            v-else
            class="bar"
            :style="{ background: categoryColorOf(item.category) }"
          />
          <div class="main">
            <strong>{{ item.name }}</strong>
            <small>
              {{ categoryLabelOf(item.category) }} · {{ item.expireAt }}
              <template v-if="item.quantity > 1"> · {{ item.quantity }} 件</template>
              <template v-if="item.images.length > 0">
                · {{ item.images.length }} 张图
              </template>
            </small>
          </div>
          <span class="state" :style="{ color: STATUS_META[statusOf(item)].color }">
            {{ describeRemaining(item.expireAt) }}
          </span>
        </article>
      </div>
    </section>

    <button
      v-if="!selecting"
      type="button"
      class="fab"
      aria-label="新增物品"
      @click="create"
    >
      <el-icon :size="22"><Plus /></el-icon>
    </button>

    <div v-if="selecting" class="selbar">
      <span class="selbar-count">已选 {{ selected.size }} 项</span>
      <button type="button" class="selbar-all" @click="toggleAll">
        {{ allPicked ? "取消全选" : "全选" }}
      </button>
      <el-button
        type="danger"
        class="selbar-del"
        :disabled="selected.size === 0"
        @click="deleteSelected"
      >
        删除
      </el-button>
    </div>

    <el-dialog
      v-model="categoryDialog"
      title="分类管理"
      width="86%"
      align-center
      class="category-dialog"
      @closed="colorEditing = null"
    >
      <div class="cat-new">
        <el-input
          v-model="newCategory"
          maxlength="8"
          clearable
          placeholder="新分类名称，如：母婴"
          @keyup.enter="submitCategory"
        />
        <el-button
          type="success"
          :disabled="!newCategory.trim()"
          @click="submitCategory"
        >
          添加
        </el-button>
      </div>

      <div class="cat-list">
        <div
          v-for="cat in categoryOptions"
          :key="cat.id"
          class="cat-row"
          :class="{ 'is-coloring': colorEditing === cat.id }"
        >
          <button
            type="button"
            class="cat-dot"
            :style="{ background: cat.color }"
            :aria-label="`调整「${cat.label}」的颜色`"
            @click="toggleColorEditor(cat)"
          />
          <span class="cat-name">{{ cat.label }}</span>
          <small>{{ categoryUsage(cat.id) }} 件</small>
          <button
            v-if="!isBuiltinCategory(cat.id)"
            type="button"
            class="cat-del"
            @click="dropCategory(cat)"
          >
            删除
          </button>
          <div v-if="colorEditing === cat.id" class="cat-palette">
            <button
              v-for="color in CATEGORY_PALETTE"
              :key="color"
              type="button"
              class="swatch"
              :class="{ on: cat.color.toLowerCase() === color.toLowerCase() }"
              :style="{ background: color }"
              :aria-label="color"
              @click="pickColor(cat, color)"
            />
            <!-- 预设之外的自定义色：手输占一个输入框，调色板占一个取色按钮 -->
            <div class="cat-custom">
              <input
                v-model="customColor"
                class="hex-input"
                type="text"
                maxlength="7"
                autocomplete="off"
                spellcheck="false"
                placeholder="#RRGGBB"
                :aria-label="`输入「${cat.label}」的颜色代码`"
                @keyup.enter="submitCustomColor(cat)"
              />
              <el-color-picker
                v-model="pickerColor"
                class="hex-picker"
                color-format="hex"
                :predefine="CATEGORY_PALETTE"
                @change="(value: string | null) => pickCustomColor(cat, value)"
              />
              <button
                type="button"
                class="hex-apply"
                :disabled="!customColorValid"
                @click="submitCustomColor(cat)"
              >
                应用
              </button>
            </div>
          </div>
        </div>
      </div>
      <p class="cat-tip">
        点左侧色块可改颜色（内置分类也能改）：预设色直接点，自定义可手输色值或用调色板取色；内置分类不能删除。
      </p>

      <template #footer>
        <el-button @click="categoryDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  min-height: 100%;
}

/* 多选时给底部操作条留出空间，避免最后一条被压住 */
.page.sel-mode {
  padding-bottom: 96px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
}

.stat strong {
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.2;
}

.stat small {
  font-size: 0.7rem;
  color: var(--el-text-color-secondary);
}

.stat .warn {
  color: var(--el-color-warning);
}

.stat .danger {
  color: var(--el-color-danger);
}

.search {
  margin-bottom: 10px;
}

.filter {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.filter-select {
  flex: 1;
  min-width: 0;
}

.filter-btn {
  display: inline-flex;
  flex: none;
  gap: 4px;
  align-items: center;
  height: 32px;
  padding: 0 10px;
  font-size: 0.78rem;
  line-height: 1;
  color: var(--el-color-primary);
  white-space: nowrap;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.filter-btn:active {
  background: var(--el-color-primary-light-8);
}

/* 添加分类：绿色实心，和右侧的多选开关区分开 */
.filter-btn.is-add {
  color: #fff;
  background: var(--el-color-success);
  border-color: transparent;
}

.filter-btn.is-add:active {
  background: var(--el-color-success-dark-2);
}

/* 多选模式下的开关：点亮成实心主色，图标换成 × */
.filter-btn.is-on {
  color: #fff;
  background: var(--el-color-primary);
  border-color: transparent;
}

.option {
  display: flex;
  gap: 8px;
  align-items: center;
}

.option i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.group {
  margin-bottom: 16px;
}

.group header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 2px 8px;
}

.group h3 {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.count {
  margin-left: auto;
  font-size: 0.7rem;
  color: var(--el-text-color-placeholder);
}

/* ---- 侧滑删除：外层裁切，红色按钮垫在条目下方 ---- */
.row {
  position: relative;
  margin-bottom: 8px;
  overflow: hidden;
  border-radius: 14px;
}

.row-del {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  justify-content: center;
  width: 78px;
  padding: 0;
  font-size: 0.72rem;
  color: #fff;
  background: var(--el-color-danger);
  border: none;
  cursor: pointer;
  /* 静止时完全隐藏：红色块垫在圆角卡片下会从抗锯齿缝隙透出残影，
     只在展开 / 拖动时淡入，收回时随位移动画一起淡出 */
  opacity: 0;
  transition: opacity 0.15s ease;
}

.row.is-open .row-del,
.row.is-dragging .row-del {
  opacity: 1;
}

.row-del:active {
  background: var(--el-color-danger-dark-2);
}

.item {
  position: relative;
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  cursor: pointer;
  /* 横向手势自己处理，竖向滚动仍交给 WebView，避免侧滑时页面同时滚动 */
  touch-action: pan-y;
  transition:
    border-color 0.15s ease,
    transform 0.2s ease;
}

/* 拖动中取消过渡，保证完全跟手 */
.item.dragging {
  transition: none;
}

.item:active {
  border-color: var(--el-border-color);
}

.bar {
  flex: none;
  width: 3px;
  height: 32px;
  border-radius: 2px;
}

/* 多选时左侧的勾选圈，占位与分类色条一致（宽 20 + gap 10 ≈ 原 3 + 10） */
.pick {
  display: grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  color: #fff;
  border: 1.5px solid var(--el-border-color);
  border-radius: 50%;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.item.picked {
  border-color: var(--el-color-primary);
}

.item.picked .pick {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
}

.main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.main strong {
  overflow: hidden;
  font-size: 0.88rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.main small {
  font-size: 0.7rem;
  color: var(--el-text-color-secondary);
}

.state {
  flex: none;
  font-size: 0.72rem;
  font-weight: 500;
}

.empty {
  padding: 48px 16px;
  text-align: center;
}

.empty p {
  margin: 0 0 6px;
  font-size: 0.88rem;
  color: var(--el-text-color-regular);
}

.empty small {
  font-size: 0.74rem;
  color: var(--el-text-color-placeholder);
}

.fab {
  position: fixed;
  right: max(20px, calc(50% - 280px + 20px));
  bottom: calc(var(--safe-bottom) + 74px);
  z-index: 30;
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  color: #111;
  background: #ffc800;
  border: none;
  border-radius: 50%;
  box-shadow: 0 8px 20px rgb(255 200 0 / 32%);
  cursor: pointer;
}

.fab:active {
  transform: scale(0.94);
}

/* ---- 多选操作条：浮在底栏上方，随窗口居中，最大宽度与壳层一致 ---- */
.selbar {
  position: fixed;
  /* 底栏约 50px 高，再留 10px 呼吸区 */
  bottom: calc(var(--safe-bottom) + 60px);
  left: 50%;
  z-index: 30;
  display: flex;
  gap: 12px;
  align-items: center;
  width: min(calc(100% - 32px), 528px);
  padding: 12px 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
  box-shadow: 0 10px 28px rgb(0 0 0 / 14%);
  transform: translateX(-50%);
}

.selbar-count {
  font-size: 0.86rem;
  color: var(--el-text-color-regular);
}

.selbar-all {
  padding: 8px 12px;
  margin-left: auto;
  font-size: 0.84rem;
  color: var(--el-color-primary);
  background: none;
  border: none;
  cursor: pointer;
}

/* 删除按钮用默认尺寸（比原来的 small 更高），并给足点击宽度 */
.selbar-del {
  min-width: 84px;
}

/* ---- 分类管理弹窗 ---- */

.cat-new {
  display: flex;
  gap: 8px;
}

.cat-list {
  margin-top: 12px;
}

.cat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 9px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.cat-row:last-child {
  border-bottom: none;
}

/* 色块本身就是取色按钮：比原来的小圆点大一圈，方便手指点中 */
.cat-dot {
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.12s ease;
}

.cat-dot:active {
  transform: scale(0.92);
}

.cat-row.is-coloring .cat-dot {
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: 2px;
}

/* 取色板：占满整行，在名称下方展开 */
.cat-palette {
  display: grid;
  flex: 0 0 100%;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
  padding: 8px 2px 4px;
}

.swatch {
  aspect-ratio: 1;
  padding: 0;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.12s ease;
}

.swatch:active {
  transform: scale(0.94);
}

/* 当前颜色：白心 + 主色描边，深浅色都能一眼认出选中项 */
.swatch.on {
  box-shadow:
    inset 0 0 0 3px var(--el-bg-color),
    0 0 0 2px var(--el-text-color-primary);
}

/* 自定义色：手输色值 + 调色板 + 应用，占满取色板一整行 */
.cat-custom {
  display: flex;
  grid-column: 1 / -1;
  gap: 8px;
  align-items: center;
  padding-top: 8px;
  border-top: 1px dashed var(--el-border-color-lighter);
}

.hex-input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82rem;
  letter-spacing: 0.5px;
  color: var(--el-text-color-regular);
  text-transform: uppercase;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.hex-input:focus {
  border-color: var(--el-color-primary);
}

/* el-color-picker 默认 32px 触发块，收到和输入框同高 */
.hex-picker :deep(.el-color-picker__trigger) {
  width: 34px;
  height: 34px;
  padding: 3px;
}

.hex-apply {
  flex: none;
  height: 34px;
  padding: 0 14px;
  font-size: 0.82rem;
  color: #fff;
  background: var(--el-color-primary);
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

.hex-apply:disabled {
  background: var(--el-color-primary-light-5);
  cursor: default;
}

.cat-name {
  flex: 1;
  font-size: 0.84rem;
  color: var(--el-text-color-regular);
}

.cat-row small {
  font-size: 0.7rem;
  color: var(--el-text-color-placeholder);
}

.cat-del {
  padding: 2px 0 2px 10px;
  font-size: 0.74rem;
  color: var(--el-color-danger);
  background: none;
  border: none;
  cursor: pointer;
}

.cat-tip {
  margin: 12px 0 0;
  font-size: 0.74rem;
  line-height: 1.6;
  color: var(--el-text-color-placeholder);
}
</style>
