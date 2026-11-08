<script setup lang="ts">
import { computed, onMounted, reactive } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { addDays, describeRemaining, isValidISODate, todayISO } from "../../../core/date";
import {
  createItem,
  expiryState,
  getItem,
  loadExpiry,
  removeItem,
  updateItem,
} from "../store";
import {
  CATEGORY_OPTIONS,
  REMIND_DAY_OPTIONS,
  type ExpiryCategory,
} from "../types";

const route = useRoute();
const router = useRouter();

const id = computed(() => {
  const raw = route.params.id;
  return Array.isArray(raw) ? raw[0] : raw;
});
const isEdit = computed(() => typeof id.value === "string" && id.value.length > 0);

const form = reactive({
  name: "",
  category: "food" as ExpiryCategory,
  expireAt: addDays(todayISO(), 30),
  quantity: 1,
  remindDays: [7, 1, 0] as (string | number | boolean)[],
  note: "",
});

onMounted(async () => {
  if (!expiryState.loaded) {
    await loadExpiry();
  }
  if (!isEdit.value || !id.value) {
    return;
  }
  const item = getItem(id.value);
  if (!item) {
    ElMessage.error("记录不存在");
    void router.replace({ name: "expiry-list" });
    return;
  }
  form.name = item.name;
  form.category = item.category;
  form.expireAt = item.expireAt;
  form.quantity = item.quantity;
  form.remindDays = [...item.remindDays];
  form.note = item.note;
});
const preview = computed(() =>
  isValidISODate(form.expireAt) ? describeRemaining(form.expireAt) : "",
);

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning("请填写物品名称");
    return;
  }
  if (!isValidISODate(form.expireAt)) {
    ElMessage.warning("请选择有效的到期日期");
    return;
  }

  const payload = {
    name: form.name.trim(),
    category: form.category,
    expireAt: form.expireAt,
    quantity: form.quantity,
    remindDays: form.remindDays.map(Number).sort((a, b) => b - a),
    note: form.note.trim(),
  };

  const targetId = id.value;
  if (targetId) {
    await updateItem(targetId, payload);
  } else {
    await createItem(payload);
  }

  ElMessage.success("已保存");
  void router.replace({ name: "expiry-list" });
}

async function remove() {
  const targetId = id.value;
  if (!targetId) {
    return;
  }
  try {
    await ElMessageBox.confirm("删除后无法恢复，确定删除这条记录？", "删除物品", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await removeItem(targetId);
  ElMessage.success("已删除");
  void router.replace({ name: "expiry-list" });
}
</script>

<template>
  <div class="page">
    <el-form label-position="top" class="form">
      <el-form-item label="物品名称">
        <el-input
          v-model="form.name"
          placeholder="如：维生素 C、护照、牛奶"
          maxlength="40"
          clearable
        />
      </el-form-item>

      <el-form-item label="分类">
        <el-select v-model="form.category" class="full">
          <el-option
            v-for="option in CATEGORY_OPTIONS"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="到期日期">
        <el-date-picker
          v-model="form.expireAt"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          class="full"
        />
        <p v-if="preview" class="preview">{{ preview }}</p>
      </el-form-item>

      <el-form-item label="数量">
        <el-input-number v-model="form.quantity" :min="1" :max="9999" />
      </el-form-item>

      <el-form-item label="提前提醒">
        <el-checkbox-group v-model="form.remindDays" class="remind">
          <el-checkbox-button
            v-for="day in REMIND_DAY_OPTIONS"
            :key="day"
            :value="day"
          >
            {{ day === 0 ? "当天" : `${day} 天前` }}
          </el-checkbox-button>
        </el-checkbox-group>
      </el-form-item>

      <el-form-item label="备注">
        <el-input
          v-model="form.note"
          type="textarea"
          :rows="3"
          maxlength="200"
          show-word-limit
          placeholder="存放位置、开封日期等（选填）"
        />
      </el-form-item>
    </el-form>

    <div class="actions">
      <el-button type="primary" size="large" class="save" @click="save">
        保存
      </el-button>
      <el-button v-if="isEdit" type="danger" plain size="large" @click="remove">
        删除
      </el-button>
    </div>

    <p class="hint">
      提醒依赖应用运行时的检查；关闭到期通知后将不再推送。
    </p>
  </div>
</template>

<style scoped>
.page {
  padding-bottom: 8px;
}

.form {
  padding: 14px 16px 4px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
}

.full {
  width: 100%;
}

.preview {
  margin: 6px 0 0;
  font-size: 0.72rem;
  color: var(--el-color-warning);
}

.remind {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.save {
  flex: 1;
}

.hint {
  margin: 12px 4px 0;
  font-size: 0.7rem;
  line-height: 1.6;
  color: var(--el-text-color-placeholder);
}
</style>
