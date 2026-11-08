<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { Check, Close, Finished, Plus, Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { describeRemaining } from "../../../core/date";
import {
  activeItems,
  addCategory,
  categoryColorOf,
  categoryLabelOf,
  categoryOptions,
  categoryUsage,
  expiryState,
  removeCategory,
  removeItems,
  statusOf,
} from "../store";
import {
  STATUS_META,
  type CustomCategory,
  type ExpiryItem,
  type ExpiryStatus,
} from "../types";

const router = useRouter();
const keyword = ref("");
const category = ref("all");

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
  void router.push({ name: "expiry-new" });
}

/* ------------- 多选删除 ------------- */

const selecting = ref(false);
/** 选中项 id 集合；用 Set 便于 O(1) 判断与去重 */
const selected = ref(new Set<string>());

const allPicked = computed(
  () =>
    filtered.value.length > 0 &&
    filtered.value.every((item) => selected.value.has(item.id)),
);

function toggleSelecting() {
  selecting.value = !selecting.value;
  selected.value.clear();
}

function onItemTap(item: ExpiryItem) {
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

/* ------------- 分类管理 ------------- */

const categoryDialog = ref(false);
const newCategory = ref("");
const customCategories = computed(() => expiryState.categories);

function openCategoryDialog() {
  newCategory.value = "";
  categoryDialog.value = true;
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

async function dropCategory(target: CustomCategory) {
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
  <div class="page" :class="{ 'sel-mode': selecting }">
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
        class="filter-add"
        aria-label="管理分类"
        @click="openCategoryDialog"
      >
        <el-icon :size="16"><Plus /></el-icon>
      </button>
      <button
        type="button"
        class="filter-add"
        :class="{ 'is-on': selecting }"
        :aria-label="selecting ? '退出多选' : '多选'"
        @click="toggleSelecting"
      >
        <el-icon :size="16"><component :is="selecting ? Close : Finished" /></el-icon>
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

      <article
        v-for="item in group.items"
        :key="item.id"
        class="item"
        :class="{ picked: selecting && selected.has(item.id) }"
        @click="onItemTap(item)"
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
        size="small"
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
    >
      <div class="cat-new">
        <el-input
          v-model="newCategory"
          maxlength="8"
          clearable
          placeholder="新分类名称，如：母婴"
          @keyup.enter="submitCategory"
        />
        <el-button type="primary" :disabled="!newCategory.trim()" @click="submitCategory">
          添加
        </el-button>
      </div>

      <div v-if="customCategories.length > 0" class="cat-list">
        <div
          v-for="cat in customCategories"
          :key="cat.id"
          class="cat-row"
        >
          <i :style="{ background: cat.color }" />
          <span class="cat-name">{{ cat.label }}</span>
          <small>{{ categoryUsage(cat.id) }} 件</small>
          <button type="button" class="cat-del" @click="dropCategory(cat)">
            删除
          </button>
        </div>
      </div>
      <p v-else class="cat-tip">
        还没有自定义分类。添加后会同时出现在筛选和新增物品的分类里。
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
  padding-bottom: 64px;
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

.filter-add {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 32px;
  padding: 0;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.filter-add:active {
  background: var(--el-color-primary-light-8);
}

/* 多选模式下的开关：点亮成实心主色，图标换成 × */
.filter-add.is-on {
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

.item {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px;
  margin-bottom: 8px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  cursor: pointer;
  transition: border-color 0.15s ease;
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

/* ---- 多选操作条：贴在底栏上方，随窗口居中，最大宽度与壳层一致 ---- */
.selbar {
  position: fixed;
  bottom: calc(var(--safe-bottom) + 62px);
  left: 50%;
  z-index: 30;
  display: flex;
  gap: 10px;
  align-items: center;
  width: min(calc(100% - 32px), 528px);
  padding: 8px 12px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  box-shadow: 0 6px 20px rgb(0 0 0 / 10%);
  transform: translateX(-50%);
}

.selbar-count {
  font-size: 0.78rem;
  color: var(--el-text-color-regular);
}

.selbar-all {
  padding: 4px 8px;
  margin-left: auto;
  font-size: 0.76rem;
  color: var(--el-color-primary);
  background: none;
  border: none;
  cursor: pointer;
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
  gap: 8px;
  align-items: center;
  padding: 9px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.cat-row:last-child {
  border-bottom: none;
}

.cat-row i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
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
