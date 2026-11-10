<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox, type InputInstance } from "element-plus";
import { Camera, Close, Picture } from "@element-plus/icons-vue";
import {
  addDays,
  daysUntil,
  describeRemaining,
  isValidISODate,
  todayISO,
} from "../../../core/date";
import { compressImage } from "../../../core/image";
import { uid } from "../../../core/id";
import {
  readImageSrc,
  releaseImageUrl,
  removeImages,
  saveImage,
} from "../images";
import {
  categoryColorOf,
  categoryOptions,
  computeExpireAt,
  createItem,
  expiryState,
  getItem,
  loadExpiry,
  removeItem,
  updateItem,
} from "../store";
import {
  MAX_IMAGES,
  REMIND_DAY_OPTIONS,
  SHELF_LIFE_UNITS,
  remindDayLabel,
  type ExpiryImage,
  type ShelfLifeUnit,
} from "../types";

const route = useRoute();
const router = useRouter();

const id = computed(() => {
  const raw = route.params.id;
  return Array.isArray(raw) ? raw[0] : raw;
});
const isEdit = computed(() => typeof id.value === "string" && id.value.length > 0);

/**
 * 编辑期的图片：比 `ExpiryImage` 多一个 `src` 用于预览。
 * 新加的图先拿压缩后的 data URL 预览、`path` 留空，保存时才写进模块目录。
 */
interface FormImage {
  id: string;
  path: string;
  data?: string;
  addedAt: string;
  src: string;
  /** 正在从文件读取预览地址，此时不渲染 img，避免闪现「丢失」占位 */
  pending?: boolean;
}

const form = reactive({
  name: "",
  category: "food",
  quantity: 1,
  productionDate: "",
  shelfLife: undefined as number | undefined,
  shelfLifeUnit: "month" as ShelfLifeUnit,
  expireAt: addDays(todayISO(), 30),
  remindDays: [7, 1, 0] as number[],
  note: "",
  images: [] as FormImage[],
});

/** 打开编辑页时该物品已有的图片路径，保存后用来清理被移除的文件 */
const originalPaths = ref<string[]>([]);

/** 每次载入 / 重置自增：异步读图回来时用它判断结果是否已经过期 */
let hydrateToken = 0;

/** Blob URL 不主动释放会一直占内存，切换记录 / 离开页面时统一回收 */
function releaseFormImageUrls() {
  form.images.forEach((image) => releaseImageUrl(image.src));
}

/**
 * 新增时的默认分类：主页带过来的 `?category=`（主页筛选了分类时会透传），
 * 校验不存在则退回内置的「食品」。
 */
function defaultCategory(): string {
  const raw = route.query.category;
  const wanted = Array.isArray(raw) ? raw[0] : raw;
  if (
    typeof wanted === "string" &&
    wanted !== "" &&
    categoryOptions.value.some((option) => option.id === wanted)
  ) {
    return wanted;
  }
  return "food";
}

/**
 * 新增页打开即聚焦名称，省一次点击。编辑页不抢焦点——否则一进页就弹键盘，
 * 盖住半屏内容还看不出自己改的是哪条记录。
 */
const nameInput = ref<InputInstance | null>(null);

function focusName() {
  // 等本帧渲染完再调 `el-input` 暴露的 focus()，直接拿原生 input 拿不到
  void nextTick(() => {
    nameInput.value?.focus();
  });
}

function resetForm() {
  hydrateToken += 1;
  form.name = "";
  form.category = defaultCategory();
  form.quantity = 1;
  form.productionDate = "";
  form.shelfLife = undefined;
  form.shelfLifeUnit = "month";
  form.expireAt = addDays(todayISO(), 30);
  form.remindDays = [7, 1, 0];
  form.note = "";
  releaseFormImageUrls();
  form.images = [];
  originalPaths.value = [];
  manualExpire.value = false;
}

/** true 表示到期日由用户手动指定，不再跟着有效期走 */
const manualExpire = ref(false);

const computedExpireAt = computed(() =>
  computeExpireAt(form.productionDate, form.shelfLife ?? 0, form.shelfLifeUnit),
);

/** 填入生产日期 + 有效期后自动进入计算模式 */
const autoExpire = computed(
  () => !manualExpire.value && computedExpireAt.value !== "",
);

const effectiveExpireAt = computed(() =>
  autoExpire.value ? computedExpireAt.value : form.expireAt,
);

watch(computedExpireAt, (value) => {
  if (autoExpire.value && value) {
    form.expireAt = value;
  }
});

const preview = computed(() => {
  const value = effectiveExpireAt.value;
  if (!isValidISODate(value)) {
    return null;
  }
  const days = daysUntil(value);
  const color =
    days < 0
      ? "var(--el-color-danger)"
      : days <= 7
        ? "var(--el-color-warning)"
        : "var(--el-text-color-secondary)";
  return { text: describeRemaining(value), color };
});

function useManual() {
  manualExpire.value = true;
  if (!isValidISODate(form.expireAt) && computedExpireAt.value) {
    form.expireAt = computedExpireAt.value;
  }
}

function useAuto() {
  manualExpire.value = false;
  if (computedExpireAt.value) {
    form.expireAt = computedExpireAt.value;
  }
}

async function hydrate(): Promise<void> {
  const token = ++hydrateToken;
  if (!expiryState.loaded) {
    await loadExpiry();
  }
  const targetId = id.value;
  if (!targetId) {
    // 新增页复用同一个组件实例，从编辑页切过来时要清干净
    resetForm();
    focusName();
    return;
  }
  const item = getItem(targetId);
  if (!item) {
    ElMessage.error("记录不存在");
    void router.replace({ name: "expiry-list" });
    return;
  }
  form.name = item.name;
  form.category = item.category;
  form.quantity = item.quantity;
  form.productionDate = item.productionDate;
  form.shelfLife = item.shelfLife > 0 ? item.shelfLife : undefined;
  form.shelfLifeUnit = item.shelfLifeUnit;
  form.expireAt = item.expireAt;
  form.remindDays = [...item.remindDays];
  form.note = item.note;
  // 图片：JSON 里只有相对路径，展示地址要按路径去文件系统取。
  // 先铺一批 pending 占位，读文件期间不渲染 img，避免闪一下破图。
  releaseFormImageUrls();
  originalPaths.value = item.images
    .map((image) => image.path)
    .filter((path) => path !== "");
  form.images = item.images.map((image) => ({
    id: image.id,
    path: image.path,
    addedAt: image.addedAt,
    src: "",
    pending: true,
  }));
  const loaded = await Promise.all(
    item.images.map(async (image) => ({
      id: image.id,
      path: image.path,
      addedAt: image.addedAt,
      src: (await readImageSrc(image.path).catch(() => null)) ?? "",
    })),
  );
  // 期间用户可能已经切到别的记录或回到新增页，过期结果直接丢掉
  if (token === hydrateToken) {
    form.images = loaded;
  } else {
    loaded.forEach((image) => releaseImageUrl(image.src));
  }
  // 旧记录到期日可能被手动改过：与推算值不一致时保留手动结果
  const guessed = computeExpireAt(
    item.productionDate,
    item.shelfLife,
    item.shelfLifeUnit,
  );
  manualExpire.value = guessed !== "" && guessed !== item.expireAt;
}

// 监听而非 onMounted：新增页与编辑页复用同一个组件实例
watch(id, () => void hydrate(), { immediate: true });

/* ---------------- 图片（拍摄 / 相册，最多 MAX_IMAGES 张） ---------------- */

const albumInput = ref<HTMLInputElement | null>(null);
const cameraInput = ref<HTMLInputElement | null>(null);
const sheetOpen = ref(false);
const compressing = ref(false);

/** 大图预览的来源列表，与缩略图同序 */
const imageSrcList = computed(() => form.images.map((image) => image.src));

function openPicker() {
  if (form.images.length >= MAX_IMAGES) {
    ElMessage.warning(`最多 ${MAX_IMAGES} 张图片`);
    return;
  }
  sheetOpen.value = true;
}

function pick(source: "camera" | "album") {
  sheetOpen.value = false;
  const input = source === "camera" ? cameraInput.value : albumInput.value;
  input?.click();
}

function dropImage(targetId: string) {
  const target = form.images.find((image) => image.id === targetId);
  if (target) {
    releaseImageUrl(target.src);
  }
  form.images = form.images.filter((image) => image.id !== targetId);
}

async function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  // 清空 value，否则连续选同一张图不会再触发 change
  input.value = "";
  if (files.length === 0) {
    return;
  }

  const room = MAX_IMAGES - form.images.length;
  if (room <= 0) {
    ElMessage.warning(`最多 ${MAX_IMAGES} 张图片`);
    return;
  }
  const accepted = files.slice(0, room);
  if (files.length > room) {
    ElMessage.warning(`最多 ${MAX_IMAGES} 张，已加入前 ${room} 张`);
  }

  compressing.value = true;
  try {
    for (const file of accepted) {
      try {
        const shot = await compressImage(file);
        form.images.push({
          id: `img_${uid()}`,
          path: "",
          data: shot.data,
          addedAt: new Date().toISOString(),
          src: shot.data,
        });
      } catch {
        ElMessage.error("这张图片读不出来，换一张试试（HEIC 请先转成 JPG）");
      }
    }
  } finally {
    compressing.value = false;
  }
}

/**
 * 把新加的图片写进模块目录，返回只含相对路径的列表（落进 JSON 的就是它）。
 * 已有图片直接沿用原路径，不重复写文件。
 */
async function materializeImages(): Promise<ExpiryImage[]> {
  const result: ExpiryImage[] = [];
  for (const image of form.images) {
    if (image.path) {
      result.push({ id: image.id, path: image.path, addedAt: image.addedAt });
      continue;
    }
    if (!image.data) {
      continue;
    }
    const path = await saveImage(image.data, image.id);
    image.path = path;
    // 已落盘，后续不必再留着 data URL
    image.data = undefined;
    result.push({ id: image.id, path, addedAt: image.addedAt });
  }
  return result;
}

/** 保存成功后删掉本次编辑中被移除的图片文件 */
async function dropOrphanImages(saved: ExpiryImage[]): Promise<void> {
  const keep = new Set(saved.map((image) => image.path));
  const orphans = originalPaths.value.filter((path) => !keep.has(path));
  originalPaths.value = [...keep];
  if (orphans.length > 0) {
    await removeImages(orphans);
  }
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning("请填写物品名称");
    return;
  }
  const expireAt = effectiveExpireAt.value;
  if (!isValidISODate(expireAt)) {
    ElMessage.warning(
      autoExpire.value
        ? "有效期计算出错，请检查生产日期与有效期"
        : "请选择有效的到期日期",
    );
    return;
  }

  let images: ExpiryImage[];
  try {
    images = await materializeImages();
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? `图片保存失败：${error.message}` : "图片保存失败",
    );
    return;
  }

  const payload = {
    name: form.name.trim(),
    category: form.category,
    productionDate: form.productionDate,
    shelfLife: form.shelfLife ?? 0,
    shelfLifeUnit: form.shelfLifeUnit,
    expireAt,
    quantity: form.quantity,
    remindDays: [...form.remindDays].sort((a, b) => b - a),
    note: form.note.trim(),
    images,
  };

  const targetId = id.value;
  try {
    if (targetId) {
      await updateItem(targetId, payload);
    } else {
      await createItem(payload);
    }
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? `保存失败：${error.message}` : "保存失败",
    );
    return;
  }

  // JSON 已经指向新图片，这时删旧文件才安全
  await dropOrphanImages(images);

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
      // MessageBox 默认不吃 ESC（closeOnPressEscape: false），系统返回键靠它关浮层
      closeOnPressEscape: true,
    });
  } catch {
    return;
  }
  await removeItem(targetId);
  ElMessage.success("已删除");
  void router.replace({ name: "expiry-list" });
}

// 离开页面时回收图片的 Blob URL，避免来回切页面把内存越占越多
onBeforeUnmount(releaseFormImageUrls);
</script>

<template>
  <div class="page">
    <div class="body">
      <div class="card">
        <div class="field">
          <span class="lbl">物品名称</span>
          <el-input
            ref="nameInput"
            v-model="form.name"
            placeholder="如：维生素 C、护照、牛奶"
            maxlength="40"
            clearable
          />
        </div>

        <div class="row">
          <div class="field grow">
            <span class="lbl">分类</span>
            <el-select v-model="form.category" placeholder="选择分类">
              <!--
                选中项只用 label 文本会丢掉颜色，这里自己渲染：色点跟分类色走。
                内置分类的颜色可能被用户在分类管理里改过，所以取 categoryColorOf 而不是静态表。
              -->
              <template #label="{ label, value }">
                <span class="option">
                  <i :style="{ background: categoryColorOf(String(value)) }" />
                  <span>{{ label }}</span>
                </span>
              </template>
              <el-option
                v-for="option in categoryOptions"
                :key="option.id"
                :label="option.label"
                :value="option.id"
              >
                <span class="option">
                  <i :style="{ background: option.color }" />
                  <span>{{ option.label }}</span>
                </span>
              </el-option>
            </el-select>
          </div>
          <div class="field qty">
            <span class="lbl">数量</span>
            <el-input-number
              v-model="form.quantity"
              :min="1"
              :max="9999"
              controls-position="right"
            />
          </div>
        </div>

        <section class="shelf">
          <header class="shelf-head">
            <span>有效期</span>
            <small v-if="autoExpire">已按生产日期自动计算</small>
          </header>

          <div class="row">
            <div class="field grow">
              <span class="lbl">生产日期<em>选填</em></span>
              <el-date-picker
                v-model="form.productionDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="选择日期"
                popper-class="expiry-date-popper"
              />
            </div>
            <div class="field life">
              <span class="lbl">有效期</span>
              <el-input-number
                v-model="form.shelfLife"
                :min="1"
                :max="9999"
                :controls="false"
                placeholder="选填"
              />
            </div>
            <div class="field unit">
              <span class="lbl">单位</span>
              <el-select v-model="form.shelfLifeUnit">
                <el-option
                  v-for="unit in SHELF_LIFE_UNITS"
                  :key="unit.value"
                  :label="unit.label"
                  :value="unit.value"
                />
              </el-select>
            </div>
          </div>

          <div class="expire">
            <span class="lbl">到期日期</span>
            <el-date-picker
              v-if="!autoExpire"
              v-model="form.expireAt"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="选择日期"
              popper-class="expiry-date-popper"
              class="full"
            />
            <div v-else class="expire-auto">
              <strong>{{ effectiveExpireAt }}</strong>
              <span class="tag">自动</span>
            </div>
            <div class="expire-foot">
              <span v-if="preview" class="preview" :style="{ color: preview.color }">
                {{ preview.text }}
              </span>
              <button
                v-if="autoExpire"
                type="button"
                class="link"
                @click="useManual"
              >
                手动指定
              </button>
              <button
                v-else-if="computedExpireAt"
                type="button"
                class="link"
                @click="useAuto"
              >
                按有效期计算
              </button>
              <span v-else-if="form.shelfLife" class="tip">
                填入生产日期即可自动计算
              </span>
            </div>
          </div>
        </section>

        <div class="field">
          <span class="lbl">提前提醒</span>
          <el-select
            v-model="form.remindDays"
            multiple
            collapse-tags
            collapse-tags-tooltip
            :max-collapse-tags="3"
            placeholder="选择提醒时间"
          >
            <el-option
              v-for="day in REMIND_DAY_OPTIONS"
              :key="day"
              :label="remindDayLabel(day)"
              :value="day"
            />
          </el-select>
        </div>

        <div class="field">
          <span class="lbl">备注<em>选填</em></span>
          <el-input
            v-model="form.note"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="存放位置、开封日期等"
          />
        </div>

        <div class="field">
          <span class="lbl">
            图片<em>选填</em>
            <span class="counter">{{ form.images.length }}/{{ MAX_IMAGES }}</span>
          </span>
          <div class="shots">
            <div v-for="(image, index) in form.images" :key="image.id" class="shot">
              <div v-if="image.pending" class="shot-loading" />
              <el-image
                v-else
                :src="image.src"
                fit="cover"
                :preview-src-list="imageSrcList"
                :initial-index="index"
                preview-teleported
                hide-on-click-modal
                class="shot-img"
              >
                <template #error>
                  <div class="shot-broken" title="图片文件已丢失">
                    <el-icon :size="14"><Picture /></el-icon>
                    <span>丢失</span>
                  </div>
                </template>
              </el-image>
              <button
                type="button"
                class="shot-del"
                aria-label="删除图片"
                @click="dropImage(image.id)"
              >
                <el-icon :size="10"><Close /></el-icon>
              </button>
            </div>

            <button
              v-if="form.images.length < MAX_IMAGES"
              type="button"
              class="shot-add"
              :disabled="compressing"
              @click="openPicker"
            >
              <el-icon :size="18"><Camera /></el-icon>
              <span>{{ compressing ? "处理中" : "添加" }}</span>
            </button>
          </div>
        </div>
      </div>

      <p class="hint">
        提醒依赖应用运行时的检查；关闭到期通知后将不再推送。
      </p>
    </div>

    <div class="actions">
      <el-button type="primary" size="large" class="save" @click="save">
        保存
      </el-button>
      <el-button v-if="isEdit" type="danger" plain size="large" @click="remove">
        删除
      </el-button>
    </div>

    <!-- 拍摄 / 相册：WebView 的 file input 只能由一个真实控件触发，所以藏两个 -->
    <input
      ref="albumInput"
      type="file"
      accept="image/*"
      multiple
      class="hidden-input"
      @change="onFilesPicked"
    />
    <input
      ref="cameraInput"
      type="file"
      accept="image/*"
      capture="environment"
      class="hidden-input"
      @change="onFilesPicked"
    />

    <!--
      用 el-drawer 而不是自造浮层：它带 .el-overlay，系统返回键（core/back.ts）与 ESC
      都能先关闭它，避免拍照面板开着按返回直接退出应用。
    -->
    <el-drawer
      v-model="sheetOpen"
      direction="btt"
      size="200px"
      :with-header="false"
      class="shot-sheet"
    >
      <button type="button" class="sheet-item" @click="pick('camera')">
        <el-icon :size="18"><Camera /></el-icon>
        <span>拍照</span>
      </button>
      <button type="button" class="sheet-item" @click="pick('album')">
        <el-icon :size="18"><Picture /></el-icon>
        <span>从相册选择</span>
      </button>
      <button
        type="button"
        class="sheet-item cancel"
        @click="sheetOpen = false"
      >
        取消
      </button>
    </el-drawer>
  </div>
</template>
<style scoped>
/*
 * 两段式布局：页面撑满壳层给的高度，上部 `.body` 吃满剩余空间并在内部滚动，
 * 下部 `.actions` 固定在底栏之上、不随内容滚动。壳层由路由 meta.layout="fill"
 * 关掉了自己的滚动与内边距（见 AppShell 的 `.content.fill`），所以这里的 padding
 * 就是整页唯一的边距来源。
 */
.page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.body {
  flex: 1;
  min-height: 0;
  padding: 14px calc(var(--safe-right) + 16px) 12px
    calc(var(--safe-left) + 16px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.card {
  padding: 14px 14px 2px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
}

.card :deep(.el-select),
.card :deep(.el-date-editor),
.card :deep(.el-input-number) {
  width: 100%;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  margin-bottom: 12px;
}

.lbl {
  display: flex;
  gap: 4px;
  align-items: baseline;
  font-size: 0.72rem;
  color: var(--el-text-color-secondary);
  letter-spacing: 0.2px;
}

.lbl em {
  font-size: 0.64rem;
  font-style: normal;
  color: var(--el-text-color-placeholder);
}

.row {
  display: flex;
  gap: 8px;
}

.grow {
  flex: 1;
}

.qty {
  flex: none;
  width: 110px;
}

.life {
  flex: none;
  width: 62px;
}

.life :deep(.el-input__inner) {
  padding: 0;
  text-align: center;
}

.unit {
  flex: none;
  width: 50px;
}

/* 单位只有「天 / 月 / 年」，压到最窄也要保证箭头露出来 */
.unit :deep(.el-select__wrapper) {
  gap: 2px;
  padding: 0 6px;
}

.unit :deep(.el-select__suffix) {
  margin-left: 0;
}

.option {
  display: flex;
  gap: 8px;
  align-items: center;
}

.option i {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  /* 浅色分类压在浅底上也要有边界，深色模式下同样成立 */
  box-shadow: 0 0 0 1px rgb(0 0 0 / 12%);
}

/* ---- 有效期分区 ---- */

.shelf {
  padding: 10px 10px 0;
  margin-bottom: 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 12px;
}

.shelf-head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 8px;
}

.shelf-head span {
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.shelf-head small {
  font-size: 0.64rem;
  color: var(--el-color-primary);
}

.shelf .field {
  margin-bottom: 10px;
}

.expire {
  margin-bottom: 10px;
}

.expire .lbl {
  margin-bottom: 6px;
}

.expire-auto {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 32px;
  padding: 0 11px;
  background: var(--el-bg-color);
  border: 1px dashed var(--el-color-primary-light-5);
  border-radius: 8px;
}

.expire-auto strong {
  font-size: 0.88rem;
  font-weight: 600;
  letter-spacing: 0.4px;
}

.tag {
  padding: 1px 6px;
  font-size: 0.62rem;
  line-height: 1.5;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-radius: 4px;
}

.expire-foot {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  min-height: 18px;
  margin-top: 5px;
}

.preview {
  font-size: 0.7rem;
}

.link {
  padding: 0;
  margin-left: auto;
  font-size: 0.7rem;
  color: var(--el-color-primary);
  background: none;
  border: none;
  cursor: pointer;
}

.tip {
  margin-left: auto;
  font-size: 0.68rem;
  color: var(--el-text-color-placeholder);
}

/* ---- 图片 ---- */

.counter {
  margin-left: auto;
  font-size: 0.64rem;
  color: var(--el-text-color-placeholder);
}

.shots {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.shot {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  background: var(--el-fill-color-light);
  border-radius: 10px;
}

.shot-img {
  display: block;
  width: 100%;
  height: 100%;
}

/* 图片文件丢失（例如手动删了模块目录里的文件）时的占位 */
.shot-broken {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 0.6rem;
  color: var(--el-text-color-placeholder);
}

/* 读图期间的静默占位，避免破图图标闪一下 */
.shot-loading {
  width: 100%;
  height: 100%;
  background: linear-gradient(
    100deg,
    var(--el-fill-color-light) 30%,
    var(--el-fill-color) 50%,
    var(--el-fill-color-light) 70%
  );
  background-size: 200% 100%;
  animation: shot-shimmer 1.2s linear infinite;
}

@keyframes shot-shimmer {
  from {
    background-position: 150% 0;
  }
  to {
    background-position: -50% 0;
  }
}

.shot-del {
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  color: #fff;
  background: rgb(0 0 0 / 55%);
  border: none;
  border-radius: 50%;
  cursor: pointer;
}

.shot-add {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  padding: 0;
  font-size: 0.64rem;
  color: var(--el-text-color-secondary);
  background: none;
  border: 1px dashed var(--el-border-color);
  border-radius: 10px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.shot-add:active,
.shot-add:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-5);
}

.shot-add:disabled {
  cursor: default;
  opacity: 0.6;
}

.hidden-input {
  display: none;
}

/* 按钮栏：两段式布局的下半段，不参与滚动，直接坐在底栏上方 */
.actions {
  display: flex;
  flex: none;
  gap: 10px;
  padding: 8px calc(var(--safe-right) + 16px);
  background: var(--el-bg-color-page);
  border-top: 1px solid var(--el-border-color-lighter);
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

<style>
/*
 * 日期面板默认 322×约 330，手机上几乎占满一屏。
 * 浮层被 teleport 到 body，scoped 样式够不到，所以用 popper-class 限定作用域后全局压缩：
 * 面板宽 322 → 244，单元格 32×30 → 30×28，头部与内边距同步收紧。
 */
.expiry-date-popper .el-date-picker {
  width: 244px;
}

.expiry-date-popper .el-date-picker .el-picker-panel__content {
  width: 220px;
  margin: 8px;
}

.expiry-date-popper .el-date-table td {
  width: 30px;
  height: 30px;
  padding: 1px 0;
}

.expiry-date-popper .el-date-table th {
  padding: 2px 0;
  font-size: 0.68rem;
}

.expiry-date-popper .el-date-table td .el-date-table-cell {
  height: 28px;
  padding: 2px 0;
}

.expiry-date-popper .el-date-table-cell__text {
  width: 24px;
  height: 24px;
  font-size: 0.75rem;
  line-height: 24px;
}

.expiry-date-popper .el-date-picker__header {
  padding: 8px 8px 0;
}

.expiry-date-popper .el-date-picker__header-label {
  font-size: 0.88rem;
  line-height: 20px;
}

.expiry-date-popper .el-picker-panel__icon-btn {
  margin-top: 3px;
  padding: 1px 4px;
}

/*
 * 拍摄 / 相册选择面板（el-drawer 同样 teleport 到 body，scoped 够不到），
 * 用 class 限定在 `.shot-sheet` 内，不影响其他抽屉。
 */
.shot-sheet .el-drawer__body {
  padding: 8px calc(var(--safe-right) + 12px)
    calc(var(--safe-bottom) + 12px) calc(var(--safe-left) + 12px);
}

.shot-sheet .sheet-item {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 13px;
  font-size: 0.86rem;
  color: var(--el-text-color-regular);
  background: none;
  border: none;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
}

.shot-sheet .sheet-item.cancel {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  border-bottom: none;
}
</style>
