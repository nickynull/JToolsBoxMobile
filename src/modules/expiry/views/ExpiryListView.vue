<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { Plus, Search } from "@element-plus/icons-vue";
import { activeItems, statusOf } from "../store";
import { describeRemaining } from "../../../core/date";
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_OPTIONS,
  STATUS_META,
  type ExpiryItem,
  type ExpiryStatus,
} from "../types";

const router = useRouter();
const keyword = ref("");
const category = ref("all");

const filters = [
  { value: "all", label: "全部" },
  ...CATEGORY_OPTIONS.map((option) => ({
    value: option.value as string,
    label: option.label,
  })),
];

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
</script>

<template>
  <div class="page">
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

    <div class="chips">
      <button
        v-for="filter in filters"
        :key="filter.value"
        type="button"
        class="chip"
        :class="{ active: category === filter.value }"
        @click="category = filter.value"
      >
        {{ filter.label }}
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
        @click="openItem(item)"
      >
        <span
          class="bar"
          :style="{ background: CATEGORY_COLORS[item.category] }"
        />
        <div class="main">
          <strong>{{ item.name }}</strong>
          <small>
            {{ CATEGORY_LABELS[item.category] }} · {{ item.expireAt }}
            <template v-if="item.quantity > 1"> · {{ item.quantity }} 件</template>
          </small>
        </div>
        <span class="state" :style="{ color: STATUS_META[statusOf(item)].color }">
          {{ describeRemaining(item.expireAt) }}
        </span>
      </article>
    </section>

    <button type="button" class="fab" aria-label="新增物品" @click="create">
      <el-icon :size="22"><Plus /></el-icon>
    </button>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  min-height: 100%;
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

.chips {
  display: flex;
  gap: 8px;
  padding-bottom: 12px;
  margin-bottom: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.chips::-webkit-scrollbar {
  display: none;
}

.chip {
  flex: none;
  padding: 5px 12px;
  font-size: 0.75rem;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
  border: 1px solid transparent;
  border-radius: 999px;
  cursor: pointer;
}

.chip.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
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
</style>
