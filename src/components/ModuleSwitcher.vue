<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { getModules } from "../core/module/registry";

const props = defineProps<{ modelValue: boolean; current?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const router = useRouter();
const modules = computed(() => getModules());
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

function open(entry: string) {
  visible.value = false;
  void router.push({ name: entry });
}
</script>

<template>
  <el-drawer
    v-model="visible"
    direction="btt"
    size="auto"
    :with-header="true"
    title="切换功能"
    class="switcher"
  >
    <div class="list">
      <button
        v-for="item in modules"
        :key="item.id"
        type="button"
        class="row"
        :class="{ active: item.id === current }"
        @click="open(item.entry)"
      >
        <span
          class="badge-icon"
          :style="{ background: item.accent + '1f', color: item.accent }"
        >
          <el-icon :size="18"><component :is="item.icon" /></el-icon>
        </span>
        <span class="meta">
          <strong>{{ item.name }}</strong>
          <small>{{ item.description }}</small>
        </span>
        <span v-if="item.id === current" class="current">当前</span>
      </button>
    </div>
  </el-drawer>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: calc(var(--safe-bottom) + 8px);
}

.row {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
  padding: 12px;
  text-align: left;
  background: var(--el-fill-color-lighter);
  border: 1px solid transparent;
  border-radius: 12px;
  cursor: pointer;
}

.row.active {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.badge-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
}

.meta {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.meta strong {
  font-size: 0.9rem;
  font-weight: 600;
}

.meta small {
  font-size: 0.72rem;
  color: var(--el-text-color-secondary);
}

.current {
  font-size: 0.7rem;
  color: var(--el-color-primary);
}
</style>
