<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-vue-next'
import { requestInvoiceAmount } from './api'
import { buildMergedInvoicePdf } from './pdf'
import type { AmountCandidate, InvoiceItem } from './types'
import { amountToCents, amountToChineseUppercase, centsToAmount, tryFormatAmount } from './utils/money'

const invoices = ref<InvoiceItem[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const dragActive = ref(false)
const pdfUrl = ref<string | null>(null)
const pdfBusy = ref(false)
const previewError = ref<string | null>(null)
const extractQueueRunning = ref(false)
let pdfRefreshVersion = 0

const acceptedTypes = '.pdf'

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
  invoices.value.push(...newItems)
  if (newItems.some((item) => isPdfFile(item.file))) {
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
    const result = await requestInvoiceAmount(item.file)
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
  } catch (error) {
    item.status = 'failed'
    item.error = error instanceof Error ? error.message : 'PDF 文本提取失败'
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
  if (pdfUrl.value) {
    URL.revokeObjectURL(pdfUrl.value)
  }
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
          <h1>发票打印助手</h1>
          <p>已导入 {{ invoices.length }} 张，已确认 {{ recognizedCount }} 张</p>
        </div>
      </div>

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

      <section class="summary-card" aria-label="发票统计">
        <div class="summary-item">
          <span>数量</span>
          <strong>{{ invoices.length }}</strong>
        </div>
        <div class="summary-divider" />
        <div class="summary-item amount">
          <span>总金额</span>
          <strong>¥{{ totalAmount }}</strong>
          <em>{{ totalAmountUppercase }}</em>
        </div>
      </section>

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
      <Upload :size="34" />
      <h2>拖拽或选择发票文件</h2>
      <p>暂不支持扫描件，请用电子发票原件PDF</p>
    </section>

    <section v-else class="workspace">
      <section class="preview-pane">
        <div class="pane-toolbar">
          <div>
            <h2>合并预览</h2>
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
          <h2>发票明细</h2>
        </div>

        <article v-for="(item, index) in invoices" :key="item.id" class="invoice-card" :class="item.status">
          <div class="invoice-head">
            <span class="index">#{{ index + 1 }}</span>
            <span class="status">
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

          <h3>{{ item.name }}</h3>

          <div v-if="item.amount" class="amount-block">
            <strong>¥{{ item.amount }}</strong>
            <span>{{ item.amountUppercase }}</span>
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
              <em>{{ candidate.amount_uppercase }}</em>
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
  </main>
</template>
