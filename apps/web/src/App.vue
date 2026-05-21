<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-vue-next'
import { requestInvoiceAmount, requestInvoiceStats, type UploadProgress } from './api'
import { buildMergedInvoicePdf } from './pdf'
import type { AmountCandidate, InvoiceItem, InvoiceStatsResponse } from './types'
import { amountToCents, amountToChineseUppercase, centsToAmount, tryFormatAmount } from './utils/money'

interface TrackedUpload {
  loaded: number
  total: number
  done: boolean
}

const MIN_UPLOAD_OVERLAY_MS = 1000
const UPLOAD_OVERLAY_CLOSE_MS = 260
const UPLOAD_RING_CIRCUMFERENCE = 339.292

const invoices = ref<InvoiceItem[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const dragActive = ref(false)
const pdfUrl = ref<string | null>(null)
const pdfBusy = ref(false)
const previewError = ref<string | null>(null)
const extractQueueRunning = ref(false)
let pdfRefreshVersion = 0
let uploadSessionId = 0
let uploadOverlayStartedAt = 0
let uploadProgressTimer: number | null = null
let uploadHideTimer: number | null = null
let uppercaseCopyTimer: number | null = null
const uploadTrackedFiles = new Map<string, TrackedUpload>()

const acceptedTypes = '.pdf'
const uploadOverlayVisible = ref(false)
const uploadDisplayProgress = ref(0)
const uploadRealProgress = ref(0)
const uploadFileTotal = ref(0)
const uploadCompletedFiles = ref(0)
const uploadBatchName = ref('')
const hoveredUppercaseKey = ref<string | null>(null)
const copiedUppercaseKey = ref<string | null>(null)
const copyFailedUppercaseKey = ref<string | null>(null)
const lifetimeProcessedInvoices = ref<number | null>(null)

const recognizedCount = computed(() => invoices.value.filter((item) => item.amount).length)
const totalCents = computed(() =>
  invoices.value.reduce((sum, item) => {
    if (!item.amount) {
      return sum
    }
    return sum + amountToCents(item.amount)
  }, 0),
)
const totalAmount = computed(() => centsToAmount(totalCents.value))
const totalAmountUppercase = computed(() => amountToChineseUppercase(totalAmount.value))
const hasInvoices = computed(() => invoices.value.length > 0)
const reviewCount = computed(() => invoices.value.filter((item) => item.status === 'needs_review').length)
const failedCount = computed(() => invoices.value.filter((item) => item.status === 'failed').length)
const pendingCount = computed(() => invoices.value.length - recognizedCount.value)
const lifetimeProcessedLabel = computed(() =>
  lifetimeProcessedInvoices.value === null ? '--' : lifetimeProcessedInvoices.value.toLocaleString('zh-CN'),
)
const uploadProgressLabel = computed(() => `${Math.round(uploadDisplayProgress.value)}%`)
const uploadRealProgressLabel = computed(() => `${Math.round(uploadRealProgress.value)}%`)
const uploadRingStyle = computed(() => ({
  strokeDasharray: `${UPLOAD_RING_CIRCUMFERENCE}`,
  strokeDashoffset: `${UPLOAD_RING_CIRCUMFERENCE - (uploadDisplayProgress.value / 100) * UPLOAD_RING_CIRCUMFERENCE}`,
}))
const uploadOverlayTitle = computed(() => (uploadRealProgress.value >= 100 ? '上传完成' : '正在上传发票'))
const uploadOverlayDetail = computed(() => {
  if (uploadRealProgress.value >= 100) {
    return '正在整理预览和识别结果'
  }
  if (uploadFileTotal.value > 1) {
    return `已上传 ${uploadCompletedFiles.value}/${uploadFileTotal.value} 个文件，上传进度 ${uploadRealProgressLabel.value}`
  }
  return `${uploadBatchName.value || '发票文件'} 上传进度 ${uploadRealProgressLabel.value}`
})

function createInvoice(file: File): InvoiceItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    name: file.name,
    status: 'queued',
    amount: null,
    amountUppercase: null,
    amountText: null,
    manualAmount: '',
    manualError: null,
    candidates: [],
    rawText: '',
    source: null,
    elapsedMs: null,
    error: null,
  }
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function getInvoiceUppercase(item: InvoiceItem): string {
  return item.amountUppercase ?? (item.amount ? amountToChineseUppercase(item.amount) : '')
}

function getCandidateUppercaseKey(item: InvoiceItem, candidate: AmountCandidate): string {
  return `${item.id}-${candidate.amount}-${candidate.text}`
}

function nowMs(): number {
  return Date.now()
}

function clearUploadTimers() {
  if (uploadProgressTimer !== null) {
    window.clearTimeout(uploadProgressTimer)
    uploadProgressTimer = null
  }
  if (uploadHideTimer !== null) {
    window.clearTimeout(uploadHideTimer)
    uploadHideTimer = null
  }
}

function refreshUploadProgress() {
  const trackedFiles = Array.from(uploadTrackedFiles.values())
  if (trackedFiles.length === 0) {
    uploadRealProgress.value = 100
    uploadCompletedFiles.value = 0
    return
  }
  const loaded = trackedFiles.reduce((sum, item) => sum + item.loaded, 0)
  const total = trackedFiles.reduce((sum, item) => sum + item.total, 0)
  uploadCompletedFiles.value = trackedFiles.filter((item) => item.done).length
  uploadRealProgress.value = Math.min(100, total > 0 ? (loaded / total) * 100 : 100)
}

function scheduleUploadProgressTick(sessionId: number) {
  if (uploadProgressTimer !== null) {
    return
  }
  uploadProgressTimer = window.setTimeout(() => {
    uploadProgressTimer = null
    updateUploadDisplayProgress(sessionId)
  }, 34)
}

function updateUploadDisplayProgress(sessionId: number) {
  if (sessionId !== uploadSessionId || !uploadOverlayVisible.value) {
    return
  }
  const elapsed = nowMs() - uploadOverlayStartedAt
  const fakeProgress = Math.min(100, (elapsed / MIN_UPLOAD_OVERLAY_MS) * 100)
  if (uploadRealProgress.value >= 100) {
    uploadDisplayProgress.value = Math.min(100, fakeProgress)
  } else {
    uploadDisplayProgress.value = Math.min(
      96,
      Math.max(uploadDisplayProgress.value, uploadRealProgress.value, fakeProgress * 0.92),
    )
  }

  if (uploadRealProgress.value >= 100 && elapsed >= MIN_UPLOAD_OVERLAY_MS) {
    uploadDisplayProgress.value = 100
    uploadHideTimer = window.setTimeout(() => {
      if (sessionId !== uploadSessionId) {
        return
      }
      uploadOverlayVisible.value = false
      uploadTrackedFiles.clear()
    }, UPLOAD_OVERLAY_CLOSE_MS)
    return
  }

  scheduleUploadProgressTick(sessionId)
}

function startUploadOverlay(items: InvoiceItem[]) {
  uploadSessionId += 1
  const sessionId = uploadSessionId
  clearUploadTimers()
  uploadTrackedFiles.clear()
  for (const item of items) {
    uploadTrackedFiles.set(item.id, {
      loaded: 0,
      total: Math.max(item.file.size, 1),
      done: false,
    })
  }
  uploadOverlayStartedAt = nowMs()
  uploadOverlayVisible.value = true
  uploadDisplayProgress.value = 0
  uploadRealProgress.value = 0
  uploadCompletedFiles.value = 0
  uploadFileTotal.value = items.length
  uploadBatchName.value = items[0]?.name ?? ''
  scheduleUploadProgressTick(sessionId)
}

function stopUploadOverlay() {
  uploadSessionId += 1
  clearUploadTimers()
  uploadTrackedFiles.clear()
  uploadOverlayVisible.value = false
  uploadDisplayProgress.value = 0
  uploadRealProgress.value = 0
  uploadCompletedFiles.value = 0
  uploadFileTotal.value = 0
  uploadBatchName.value = ''
}

function showUppercasePreview(key: string) {
  hoveredUppercaseKey.value = key
}

function hideUppercasePreview(key: string) {
  if (hoveredUppercaseKey.value === key) {
    hoveredUppercaseKey.value = null
  }
}

function clearUppercaseCopyTimer() {
  if (uppercaseCopyTimer !== null) {
    window.clearTimeout(uppercaseCopyTimer)
    uppercaseCopyTimer = null
  }
}

function fallbackCopyText(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  document.body.append(textarea)
  textarea.focus({ preventScroll: true })
  textarea.select()
  textarea.setSelectionRange(0, text.length)
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}

async function writeTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall back to the legacy copy command below.
    }
  }
  if (!fallbackCopyText(text)) {
    throw new Error('copy failed')
  }
}

async function copyUppercaseAmount(key: string, value: string | null) {
  const text = value?.trim()
  if (!text) {
    return
  }
  try {
    await writeTextToClipboard(text)
    copiedUppercaseKey.value = key
    copyFailedUppercaseKey.value = null
  } catch {
    copiedUppercaseKey.value = null
    copyFailedUppercaseKey.value = key
  }
  clearUppercaseCopyTimer()
  uppercaseCopyTimer = window.setTimeout(() => {
    if (copiedUppercaseKey.value === key) {
      copiedUppercaseKey.value = null
    }
    if (copyFailedUppercaseKey.value === key) {
      copyFailedUppercaseKey.value = null
    }
  }, 1400)
}

function updateTrackedUpload(itemId: string, progress: UploadProgress) {
  const tracked = uploadTrackedFiles.get(itemId)
  if (!tracked) {
    return
  }
  const total = Math.max(progress.total ?? tracked.total, tracked.total, progress.loaded, 1)
  tracked.total = total
  tracked.loaded = progress.done ? total : Math.min(total, Math.max(tracked.loaded, progress.loaded))
  tracked.done = progress.done || tracked.loaded >= total
  refreshUploadProgress()
}

function finishTrackedUpload(itemId: string) {
  const tracked = uploadTrackedFiles.get(itemId)
  if (!tracked) {
    return
  }
  tracked.loaded = tracked.total
  tracked.done = true
  refreshUploadProgress()
}

function applyInvoiceStats(stats: InvoiceStatsResponse | null | undefined) {
  if (!stats || !Number.isInteger(stats.processedInvoices) || stats.processedInvoices < 0) {
    return
  }
  lifetimeProcessedInvoices.value =
    lifetimeProcessedInvoices.value === null
      ? stats.processedInvoices
      : Math.max(lifetimeProcessedInvoices.value, stats.processedInvoices)
}

async function loadInvoiceStats() {
  try {
    applyInvoiceStats(await requestInvoiceStats())
  } catch {
    // Keep the title usable when the backend is still starting; extraction errors are shown separately.
  }
}

function openPicker() {
  fileInput.value?.click()
}

async function handleFiles(fileList: FileList | File[]) {
  const files = Array.from(fileList)
  if (files.length === 0) {
    return
  }
  const newItems = files.map((file) => {
    const item = createInvoice(file)
    if (!isPdfFile(file)) {
      item.status = 'failed'
      item.error = '仅支持 PDF 文件，请选择带文本层的发票 PDF。'
    }
    return item
  })
  const validItems = newItems.filter((item) => isPdfFile(item.file))
  if (validItems.length > 0) {
    startUploadOverlay(validItems)
  }
  invoices.value.push(...newItems)
  if (validItems.length > 0) {
    void refreshMergedPdf()
    void runExtractQueue()
  }
}

async function extractInvoice(item: InvoiceItem) {
  if (!invoices.value.some((invoice) => invoice.id === item.id)) {
    return
  }
  item.status = 'processing'
  item.amount = null
  item.amountUppercase = null
  item.amountText = null
  item.manualAmount = ''
  item.manualError = null
  item.candidates = []
  item.rawText = ''
  item.source = null
  item.elapsedMs = null
  item.error = null
  try {
    const result = await requestInvoiceAmount(item.file, (progress) => updateTrackedUpload(item.id, progress))
    item.status = result.status
    item.amount = result.amount
    item.amountUppercase = result.amountUppercase
    item.amountText = result.amountText
    item.manualAmount = result.amount ?? result.candidates[0]?.amount ?? ''
    item.manualError = null
    item.candidates = result.candidates
    item.rawText = result.rawText
    item.source = result.source
    item.elapsedMs = result.elapsedMs
    applyInvoiceStats(result.stats)
  } catch (error) {
    item.status = 'failed'
    item.error = error instanceof Error ? error.message : 'PDF 文本提取失败'
  } finally {
    finishTrackedUpload(item.id)
  }
}

function confirmAmount(item: InvoiceItem, amount: string, amountText: string | null = '人工确认') {
  const formatted = tryFormatAmount(amount)
  if (!formatted) {
    item.manualError = '请输入有效金额，最多保留两位小数。'
    return
  }
  item.amount = formatted
  item.amountUppercase = amountToChineseUppercase(formatted)
  item.amountText = amountText
  item.manualAmount = formatted
  item.manualError = null
  item.error = null
  item.status = 'recognized'
}

function chooseCandidate(item: InvoiceItem, candidate: AmountCandidate) {
  confirmAmount(item, candidate.amount, candidate.text)
}

function confirmManualAmount(item: InvoiceItem) {
  confirmAmount(item, item.manualAmount)
}

function retryExtraction(item: InvoiceItem) {
  if (!isPdfFile(item.file)) {
    return
  }
  item.status = 'queued'
  item.error = null
  item.manualError = null
  void runExtractQueue()
}

async function runExtractQueue() {
  if (extractQueueRunning.value) {
    return
  }
  extractQueueRunning.value = true
  try {
    while (true) {
      const next = invoices.value.find((item) => item.status === 'queued')
      if (!next) {
        break
      }
      await extractInvoice(next)
    }
  } finally {
    extractQueueRunning.value = false
  }
}

async function refreshMergedPdf() {
  const version = ++pdfRefreshVersion
  const files = invoices.value.map((item) => item.file)
  pdfBusy.value = true
  previewError.value = null
  try {
    const blob = await buildMergedInvoicePdf(files)
    if (version !== pdfRefreshVersion) {
      return
    }
    if (pdfUrl.value) {
      URL.revokeObjectURL(pdfUrl.value)
      pdfUrl.value = null
    }
    if (blob) {
      pdfUrl.value = URL.createObjectURL(blob)
    }
  } catch (error) {
    if (version === pdfRefreshVersion) {
      previewError.value = error instanceof Error ? error.message : '合并预览生成失败'
    }
  } finally {
    if (version === pdfRefreshVersion) {
      pdfBusy.value = false
    }
  }
}

async function removeInvoice(item: InvoiceItem) {
  invoices.value = invoices.value.filter((invoice) => invoice.id !== item.id)
  await refreshMergedPdf()
}

function clearAll() {
  pdfRefreshVersion += 1
  stopUploadOverlay()
  invoices.value = []
  previewError.value = null
  pdfBusy.value = false
  if (pdfUrl.value) {
    URL.revokeObjectURL(pdfUrl.value)
    pdfUrl.value = null
  }
}

function downloadPdf() {
  if (!pdfUrl.value) {
    return
  }
  const link = document.createElement('a')
  link.href = pdfUrl.value
  link.download = `发票合并-${new Date().toISOString().slice(0, 10)}.pdf`
  link.click()
}

async function printPdf() {
  if (!pdfUrl.value) {
    return
  }
  await nextTick()
  const popup = window.open(pdfUrl.value, '_blank')
  popup?.addEventListener('load', () => popup.print(), { once: true })
}

function onInputChange(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files) {
    void handleFiles(target.files)
  }
  target.value = ''
}

function onDrop(event: DragEvent) {
  dragActive.value = false
  if (event.dataTransfer?.files) {
    void handleFiles(event.dataTransfer.files)
  }
}

onBeforeUnmount(() => {
  stopUploadOverlay()
  clearUppercaseCopyTimer()
  if (pdfUrl.value) {
    URL.revokeObjectURL(pdfUrl.value)
  }
})

onMounted(() => {
  void loadInvoiceStats()
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-icon">
          <FileText :size="26" />
        </div>
        <div>
          <div class="brand-heading">
            <h1>发票打印助手</h1>
            <span class="lifetime-stat" aria-label="本站运行累积处理发票数量">
              <BarChart3 :size="15" />
              本站运行累积处理 {{ lifetimeProcessedLabel }} 张
            </span>
          </div>
          <p>已导入 {{ invoices.length }} 张，已确认 {{ recognizedCount }} 张，待处理 {{ pendingCount }} 张</p>
        </div>
      </div>

      <section class="summary-card" aria-label="发票统计">
        <div class="summary-item">
          <span>发票数</span>
          <strong>{{ invoices.length }}</strong>
        </div>
        <div class="summary-item">
          <span>待确认</span>
          <strong>{{ reviewCount + failedCount }}</strong>
        </div>
        <div class="summary-item amount">
          <span>总金额</span>
          <strong>¥{{ totalAmount }}</strong>
          <button
            class="uppercase-copy summary-uppercase"
            type="button"
            :aria-label="`复制总金额中文大写：${totalAmountUppercase}`"
            @mouseenter="showUppercasePreview('total')"
            @mouseleave="hideUppercasePreview('total')"
            @focus="showUppercasePreview('total')"
            @blur="hideUppercasePreview('total')"
            @click="copyUppercaseAmount('total', totalAmountUppercase)"
          >
            <em>{{ totalAmountUppercase }}</em>
            <span v-if="hoveredUppercaseKey === 'total'" class="uppercase-popover" role="tooltip">
              <span class="uppercase-popover-text">{{ totalAmountUppercase }}</span>
              <span class="uppercase-popover-hint">点击复制</span>
            </span>
            <span v-if="copiedUppercaseKey === 'total'" class="uppercase-copy-state">已复制</span>
            <span v-if="copyFailedUppercaseKey === 'total'" class="uppercase-copy-state failed">复制失败</span>
          </button>
        </div>
      </section>

      <div class="actions">
        <button class="primary-button" type="button" @click="openPicker">
          <Upload :size="20" />
          {{ hasInvoices ? '继续添加' : '选择发票' }}
        </button>
        <button class="ghost-button" type="button" :disabled="!hasInvoices" @click="clearAll">
          <Trash2 :size="19" />
          清空
        </button>
      </div>

      <input ref="fileInput" type="file" multiple :accept="acceptedTypes" hidden @change="onInputChange" />
    </header>

    <section
      v-if="!hasInvoices"
      class="dropzone"
      :class="{ active: dragActive }"
      @click="openPicker"
      @dragenter.prevent="dragActive = true"
      @dragover.prevent="dragActive = true"
      @dragleave.prevent="dragActive = false"
      @drop.prevent="onDrop"
    >
      <div class="dropzone-panel">
        <div class="dropzone-icon">
          <Upload :size="34" />
        </div>
        <h2>拖拽或选择 PDF 发票</h2>
        <p>使用电子发票原件 PDF，扫描件需要人工确认金额。</p>
      </div>
    </section>

    <section v-else class="workspace">
      <section class="preview-pane">
        <div class="pane-toolbar">
          <div>
            <h2>合并预览</h2>
            <p>{{ hasInvoices ? '按导入顺序合并，每页排布两张发票。' : '等待导入发票。' }}</p>
          </div>
          <div class="toolbar-actions">
            <button class="icon-button" type="button" :disabled="!pdfUrl" title="下载 PDF" @click="downloadPdf">
              <Download :size="19" />
              <span>下载</span>
            </button>
            <button class="icon-button" type="button" :disabled="!pdfUrl" title="打印 PDF" @click="printPdf">
              <Printer :size="19" />
              <span>打印</span>
            </button>
          </div>
        </div>

        <div class="pdf-frame">
          <div v-if="pdfBusy" class="pdf-state">
            <Loader2 class="spin" :size="28" />
          </div>
          <iframe v-else-if="pdfUrl" :src="pdfUrl" title="合并发票预览" />
          <div v-else class="pdf-state">{{ previewError || '暂无可预览文件' }}</div>
        </div>
      </section>

      <aside class="details-pane">
        <div class="details-header">
          <div>
            <h2>发票明细</h2>
            <p>逐张确认金额后再下载或打印。</p>
          </div>
        </div>

        <article v-for="(item, index) in invoices" :key="item.id" class="invoice-card" :class="item.status">
          <div class="invoice-head">
            <div class="invoice-title">
              <span class="index">#{{ index + 1 }}</span>
              <h3>{{ item.name }}</h3>
            </div>
            <span class="status" :class="item.status">
              <Loader2 v-if="item.status === 'processing'" class="spin" :size="16" />
              <CheckCircle2 v-else-if="item.status === 'recognized'" :size="16" />
              <AlertTriangle v-else :size="16" />
              {{
                item.status === 'queued'
                  ? '排队中'
                  : item.status === 'processing'
                    ? '提取中'
                    : item.status === 'recognized'
                      ? '已确认'
                      : item.status === 'failed'
                        ? '失败'
                        : '待确认'
              }}
            </span>
          </div>

          <div v-if="item.amount" class="amount-block">
            <strong>¥{{ item.amount }}</strong>
            <button
              class="uppercase-copy invoice-uppercase"
              type="button"
              :aria-label="`复制发票金额中文大写：${getInvoiceUppercase(item)}`"
              @mouseenter="showUppercasePreview(item.id)"
              @mouseleave="hideUppercasePreview(item.id)"
              @focus="showUppercasePreview(item.id)"
              @blur="hideUppercasePreview(item.id)"
              @click="copyUppercaseAmount(item.id, getInvoiceUppercase(item))"
            >
              <span>{{ getInvoiceUppercase(item) }}</span>
              <span v-if="hoveredUppercaseKey === item.id" class="uppercase-popover" role="tooltip">
                <span class="uppercase-popover-text">{{ getInvoiceUppercase(item) }}</span>
                <span class="uppercase-popover-hint">点击复制</span>
              </span>
              <span v-if="copiedUppercaseKey === item.id" class="uppercase-copy-state">已复制</span>
              <span v-if="copyFailedUppercaseKey === item.id" class="uppercase-copy-state failed">复制失败</span>
            </button>
          </div>

          <p v-if="item.error" class="error-text">{{ item.error }}</p>
          <div v-if="item.status === 'needs_review' && item.candidates.length" class="candidate-list">
            <span>候选金额</span>
            <button
              v-for="candidate in item.candidates"
              :key="`${item.id}-${candidate.text}`"
              type="button"
              @click="chooseCandidate(item, candidate)"
            >
              <strong>¥{{ candidate.amount }}</strong>
              <em
                class="uppercase-copy candidate-uppercase"
                role="button"
                tabindex="0"
                :aria-label="`复制候选金额中文大写：${candidate.amount_uppercase}`"
                @click.stop="copyUppercaseAmount(getCandidateUppercaseKey(item, candidate), candidate.amount_uppercase)"
                @keydown.enter.stop.prevent="
                  copyUppercaseAmount(getCandidateUppercaseKey(item, candidate), candidate.amount_uppercase)
                "
                @keydown.space.stop.prevent="
                  copyUppercaseAmount(getCandidateUppercaseKey(item, candidate), candidate.amount_uppercase)
                "
                @mouseenter="showUppercasePreview(getCandidateUppercaseKey(item, candidate))"
                @mouseleave="hideUppercasePreview(getCandidateUppercaseKey(item, candidate))"
                @focus="showUppercasePreview(getCandidateUppercaseKey(item, candidate))"
                @blur="hideUppercasePreview(getCandidateUppercaseKey(item, candidate))"
              >
                <span>{{ candidate.amount_uppercase }}</span>
                <span
                  v-if="hoveredUppercaseKey === getCandidateUppercaseKey(item, candidate)"
                  class="uppercase-popover"
                  role="tooltip"
                >
                  <span class="uppercase-popover-text">{{ candidate.amount_uppercase }}</span>
                  <span class="uppercase-popover-hint">点击复制</span>
                </span>
                <span
                  v-if="copiedUppercaseKey === getCandidateUppercaseKey(item, candidate)"
                  class="uppercase-copy-state"
                >
                  已复制
                </span>
                <span
                  v-if="copyFailedUppercaseKey === getCandidateUppercaseKey(item, candidate)"
                  class="uppercase-copy-state failed"
                >
                  复制失败
                </span>
              </em>
            </button>
          </div>

          <form
            v-if="isPdfFile(item.file) && (item.status === 'needs_review' || item.status === 'failed')"
            class="manual-row"
            @submit.prevent="confirmManualAmount(item)"
          >
            <input
              v-model.trim="item.manualAmount"
              aria-label="手动输入金额"
              inputmode="decimal"
              placeholder="手动输入金额，如 85.86"
            />
            <button type="submit">确认金额</button>
          </form>
          <p v-if="item.manualError" class="error-text">{{ item.manualError }}</p>

          <div class="card-actions">
            <button
              v-if="(item.status === 'failed' || item.status === 'needs_review') && isPdfFile(item.file)"
              type="button"
              @click="retryExtraction(item)"
            >
              <RefreshCw :size="15" />
              重试识别
            </button>
            <button type="button" @click="removeInvoice(item)">
              <Trash2 :size="15" />
              移除
            </button>
          </div>
        </article>
      </aside>
    </section>

    <Transition name="upload-overlay">
      <div v-if="uploadOverlayVisible" class="upload-overlay" role="status" aria-live="polite">
        <section class="upload-dialog" aria-label="发票上传进度">
          <div class="upload-ring-wrap">
            <svg class="upload-ring" viewBox="0 0 128 128" aria-hidden="true">
              <circle class="upload-ring-track" cx="64" cy="64" r="54" />
              <circle class="upload-ring-value" cx="64" cy="64" r="54" :style="uploadRingStyle" />
            </svg>
            <div class="upload-ring-label">
              <strong>{{ uploadProgressLabel }}</strong>
              <span>{{ uploadRealProgress < 100 ? '上传中' : '完成' }}</span>
            </div>
          </div>
          <div class="upload-copy">
            <h2>{{ uploadOverlayTitle }}</h2>
            <p>{{ uploadOverlayDetail }}</p>
          </div>
        </section>
      </div>
    </Transition>
  </main>
</template>
