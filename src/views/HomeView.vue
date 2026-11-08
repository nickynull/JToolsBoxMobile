<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { getModules } from "../core/module/registry";
import type { ToolModule } from "../core/module/types";

const router = useRouter();

const cards = computed(() =>
  getModules().map((module) => ({
    module,
    badge: module.badge?.() ?? null,
  })),
);

const today = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());

function open(module: ToolModule) {
  void router.push({ name: module.entry });
}
</script>

<template>
  <div class="page">
    <section class="intro">
      <p class="date">{{ today }}</p>
      <h2>本机工具箱</h2>
      <p class="sub">所有数据只存在这台设备上</p>
    </section>

    <div class="grid">
      <button
        v-for="card in cards"
        :key="card.module.id"
        type="button"
        class="card"
        @click="open(card.module)"
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
    </div>

    <p class="tip">卸载或换机前，请到设置里导出备份。</p>
  </div>
</template>

<style scoped>
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
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
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

.tip {
  margin: 20px 0 0;
  font-size: 0.72rem;
  text-align: center;
  color: var(--el-text-color-placeholder);
}
</style>
