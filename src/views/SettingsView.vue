<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { getModules } from "../core/module/registry";
import { settings, setTheme, updateSettings } from "../core/settings";
import { ensureNotifyPermission, notifyState } from "../core/notify";
import { storage } from "../core/storage/driver";
import {
  applyBackup,
  exportBackup,
  moduleDataKey,
  readBackup,
  type BackupPayload,
  type ImportMode,
} from "../core/backup";
import { isTauri } from "../core/runtime";
import { APP_VERSION } from "../core/version";

const modules = computed(() => getModules());

const theme = computed({
  get: () => settings.theme,
  set: (value) => setTheme(value),
});

const startup = computed({
  get: () => settings.startup,
  set: (value) => updateSettings({ startup: value }),
});

const notifyEnabled = computed({
  get: () => settings.notifyEnabled,
  set: (value) => updateSettings({ notifyEnabled: value }),
});

const notifyTime = computed({
  get: () => settings.notifyTime,
  set: (value) => updateSettings({ notifyTime: value }),
});

/** 「下一次提醒」的友好展示。 */
const nextReminder = computed(() => {
  if (!notifyState.nextAt) {
    return "";
  }
  const at = new Date(notifyState.nextAt);
  if (Number.isNaN(at.getTime())) {
    return "";
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getMonth() + 1} 月 ${at.getDate()} 日 ${pad(at.getHours())}:${pad(at.getMinutes())}`;
});

const startupOptions = computed(() => [
  { value: "home", label: "首页" },
  { value: "last", label: "上次使用的功能" },
  ...modules.value.map((module) => ({ value: module.id, label: module.name })),
]);

async function toggleNotify(value: boolean | string | number) {
  if (!value) {
    return;
  }
  const granted = await ensureNotifyPermission();
  if (!granted) {
    notifyEnabled.value = false;
    ElMessage.warning(
      isTauri ? "未获得通知权限，请在系统设置中允许" : "浏览器预览不支持系统通知",
    );
  }
}

const busy = ref(false);

async function exportAll() {
  busy.value = true;
  try {
    const ok = await exportBackup("all");
    if (ok) {
      ElMessage.success("备份已导出");
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "导出失败");
  } finally {
    busy.value = false;
  }
}

async function exportOne(moduleId: string) {
  busy.value = true;
  try {
    const ok = await exportBackup([moduleId]);
    if (ok) {
      ElMessage.success("模块数据已导出");
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "导出失败");
  } finally {
    busy.value = false;
  }
}

const importOpen = ref(false);
const pending = ref<BackupPayload | null>(null);

const pendingModules = computed(() => {
  if (!pending.value) {
    return "";
  }
  const ids = pending.value.manifest.modules;
  return (
    modules.value
      .filter((module) => ids.includes(module.id))
      .map((module) => module.name)
      .join("、") || "无"
  );
});

const pendingTime = computed(() => {
  if (!pending.value) {
    return "";
  }
  const date = new Date(pending.value.manifest.exportedAt);
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString("zh-CN");
});

async function startImport() {
  try {
    const payload = await readBackup();
    if (!payload) {
      return;
    }
    pending.value = payload;
    importOpen.value = true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "无法读取备份文件");
  }
}

async function doImport(mode: ImportMode) {
  if (!pending.value) {
    return;
  }
  busy.value = true;
  try {
    const result = await applyBackup(pending.value, mode);
    importOpen.value = false;
    pending.value = null;
    ElMessage.success(
      `导入完成：${result.modules.length} 个模块${result.settingsApplied ? "，含设置" : ""}`,
    );
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "导入失败");
  } finally {
    busy.value = false;
  }
}

async function clearAll() {
  try {
    await ElMessageBox.confirm(
      "将删除所有模块的数据，应用设置会保留。建议先导出备份。",
      "清空数据",
      { type: "warning", confirmButtonText: "清空", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }

  busy.value = true;
  try {
    for (const module of modules.value) {
      await storage.remove(moduleDataKey(module.id));
      await module.preload?.();
    }
    ElMessage.success("数据已清空");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "清空失败");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="settings">
    <section class="group">
      <h3>外观</h3>
      <div class="row">
        <span class="label">主题</span>
        <el-radio-group v-model="theme" size="small">
          <el-radio-button value="light">浅色</el-radio-button>
          <el-radio-button value="dark">深色</el-radio-button>
          <el-radio-button value="system">跟随系统</el-radio-button>
        </el-radio-group>
      </div>
    </section>

    <section class="group">
      <h3>启动</h3>
      <div class="row">
        <span class="label">打开软件时</span>
        <el-select v-model="startup" size="small" class="select">
          <el-option
            v-for="option in startupOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>
      <p class="hint">
        可以选择直接进入某个功能，或回到上次使用的页面。
      </p>
    </section>

    <section class="group">
      <h3>提醒</h3>
      <div class="row">
        <div class="text">
          <span class="label">到期通知</span>
          <small>按物品设定的提前天数推送系统通知</small>
        </div>
        <el-switch v-model="notifyEnabled" @change="toggleNotify" />
      </div>
      <div class="row">
        <div class="text">
          <span class="label">提醒时间</span>
          <small>每天在这个时间点推送</small>
        </div>
        <el-time-select
          v-model="notifyTime"
          class="select"
          size="small"
          start="06:00"
          step="00:30"
          end="23:30"
          :disabled="!settings.notifyEnabled"
          placeholder="09:00"
        />
      </div>
      <p v-if="!settings.notifyEnabled" class="hint">
        关闭后不会再推送任何提醒，系统里已排的闹钟会被清空。
      </p>
      <p v-else-if="!notifyState.canSchedule" class="hint">
        当前平台只能在应用运行时提醒；Android / iOS 会改为系统定时推送，关闭应用也会响。
      </p>
      <p v-else-if="notifyState.pending > 0" class="hint ok">
        已排入 {{ notifyState.pending }} 条系统提醒<template v-if="nextReminder">，下一次 {{ nextReminder }}</template>。关闭应用也会照常推送。
      </p>
      <p v-else class="hint">
        暂无可排的提醒，新增物品或检查通知权限后会自动重新排入。
      </p>
    </section>

    <section class="group">
      <h3>数据</h3>
      <div class="row">
        <div class="text">
          <span class="label">导出全部</span>
          <small>所有模块数据 + 应用设置</small>
        </div>
        <el-button size="small" :loading="busy" @click="exportAll">
          导出
        </el-button>
      </div>
      <div class="row">
        <div class="text">
          <span class="label">按模块导出</span>
          <small>只备份单个功能的数据</small>
        </div>
        <el-dropdown trigger="click" @command="exportOne">
          <el-button size="small" :loading="busy">选择模块</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="module in modules"
                :key="module.id"
                :command="module.id"
              >
                {{ module.name }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <div class="row">
        <div class="text">
          <span class="label">导入备份</span>
          <small>可选择覆盖或与现有数据合并</small>
        </div>
        <el-button size="small" :loading="busy" @click="startImport">
          导入
        </el-button>
      </div>
      <div class="row">
        <div class="text">
          <span class="label">清空数据</span>
          <small>只清除模块数据，保留设置</small>
        </div>
        <el-button size="small" type="danger" plain @click="clearAll">
          清空
        </el-button>
      </div>
    </section>

    <section class="group">
      <h3>关于</h3>
      <div class="row">
        <span class="label">版本</span>
        <small class="value">{{ APP_VERSION }}</small>
      </div>
      <div class="row">
        <span class="label">运行环境</span>
        <small class="value">{{ isTauri ? "Tauri 运行时" : "浏览器预览" }}</small>
      </div>
      <p class="hint">数据保存在本机应用目录，不上传任何服务器。</p>
    </section>

    <el-dialog v-model="importOpen" title="导入备份" width="88%">
      <div v-if="pending" class="preview">
        <p class="file">{{ pending.fileName }}</p>
        <p><span>导出时间</span>{{ pendingTime }}</p>
        <p><span>包含模块</span>{{ pendingModules }}</p>
        <p class="note">
          「覆盖」会用备份内容替换现有数据；「合并」会保留现有条目，按 id 更新同一条记录。
        </p>
      </div>
      <template #footer>
        <el-button @click="importOpen = false">取消</el-button>
        <el-button :loading="busy" @click="doImport('merge')">合并</el-button>
        <el-button type="primary" :loading="busy" @click="doImport('replace')">
          覆盖
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.group {
  padding: 14px 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
}

.group h3 {
  margin: 0 0 10px;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  letter-spacing: 1px;
}

.row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.row + .row {
  border-top: 1px solid var(--el-border-color-lighter);
}

.label {
  font-size: 0.86rem;
  color: var(--el-text-color-primary);
}

.text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.text small {
  font-size: 0.72rem;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
}

.value {
  font-size: 0.78rem;
  color: var(--el-text-color-secondary);
}

.select {
  width: 148px;
}

.hint {
  margin: 8px 0 0;
  font-size: 0.72rem;
  line-height: 1.6;
  color: var(--el-text-color-placeholder);
}

.hint.ok {
  color: var(--el-color-success);
}

.preview p {
  display: flex;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 0.82rem;
  color: var(--el-text-color-regular);
}

.preview p span {
  flex: none;
  color: var(--el-text-color-secondary);
}

.preview .file {
  font-weight: 600;
  word-break: break-all;
}

.preview .note {
  margin-top: 12px;
  font-size: 0.72rem;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
