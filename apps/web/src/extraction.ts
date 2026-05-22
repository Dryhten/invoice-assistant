import jsQR from 'jsqr'
import type { ExtractAmountResponse, InvoiceStatsResponse } from './types'
import { amountToChineseUppercase, centsToAmount } from './utils/money'

export interface LoadProgress {
  loaded: number
  total: number | null
  done: boolean
}

type PdfJsModule = typeof import('pdfjs-dist')
type PdfDocumentProxy = Awaited<ReturnType<PdfJsModule['getDocument']>['promise']>
type PdfPageProxy = Awaited<ReturnType<PdfDocumentProxy['getPage']>>

const KEYWORD_WEIGHT: Record<string, number> = {
  价税合计: 8,
  價稅合計: 8,
  大写: 6,
  大寫: 6,
  合计: 4,
  合計: 4,
  人民币: 3,
  人民幣: 3,
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  '〇': 0,
  壹: 1,
  一: 1,
  贰: 2,
  貳: 2,
  二: 2,
  两: 2,
  兩: 2,
  叁: 3,
  參: 3,
  三: 3,
  肆: 4,
  四: 4,
  伍: 5,
  五: 5,
  陆: 6,
  陸: 6,
  六: 6,
  柒: 7,
  七: 7,
  捌: 8,
  八: 8,
  玖: 9,
  九: 9,
}
const SMALL_UNITS: Record<string, number> = { 拾: 10, 十: 10, 佰: 100, 百: 100, 仟: 1000, 千: 1000 }
const SECTION_UNITS: Record<string, number> = { 万: 10000, 萬: 10000, 亿: 100000000, 億: 100000000 }
const AMOUNT_CHARS = '零〇壹一贰貳二两兩叁參三肆四伍五陆陸六柒七捌八玖九拾十佰百仟千万萬亿億元圆角分整正'
const amountSegmentPattern = new RegExp(
  `(?:人民币|人民幣)?[${AMOUNT_CHARS}]{2,}(?:元|圆)?[${AMOUNT_CHARS}]*(?:整|正|角|分)?`,
  'gu',
)

let pdfLoader: Promise<PdfJsModule> | null = null
let processedInvoices = 0

function loadPdfJs() {
  if (!pdfLoader) {
    pdfLoader = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.mjs?url')]).then(
      ([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        return pdfjs
      },
    )
  }
  return pdfLoader
}

function cleanAmountText(text: string): string {
  return text
    .trim()
    .replaceAll('人民币', '')
    .replaceAll('（', '')
    .replaceAll('）', '')
    .replaceAll('(', '')
    .replaceAll(')', '')
    .replaceAll('：', '')
    .replaceAll(':', '')
    .replaceAll(' ', '')
    .replaceAll('\u3000', '')
    .replaceAll('圓', '圆')
    .replaceAll('圜', '圆')
    .replaceAll('块', '元')
}

function parseIntegerSection(section: string): number {
  let total = 0
  let number = 0
  for (const char of section) {
    if (char in CN_DIGITS) {
      number = CN_DIGITS[char]
    } else if (char in SMALL_UNITS) {
      total += (number || 1) * SMALL_UNITS[char]
      number = 0
    } else if (char === '零' || char === '〇') {
      number = 0
    }
  }
  return total + number
}

function parseChineseInteger(text: string): number {
  let total = 0
  let section = ''
  for (const char of text) {
    if (char in SECTION_UNITS) {
      total += parseIntegerSection(section) * SECTION_UNITS[char]
      section = ''
    } else {
      section += char
    }
  }
  return total + parseIntegerSection(section)
}

function chineseAmountToCents(text: string): number {
  const value = cleanAmountText(text)
  if (!value) {
    throw new Error('empty amount text')
  }

  const yuanMatch = value.match(/[元圆]/u)
  let integerPart = ''
  let fractionPart = ''
  if (yuanMatch?.index !== undefined) {
    integerPart = value.slice(0, yuanMatch.index)
    fractionPart = value.slice(yuanMatch.index + yuanMatch[0].length)
  } else {
    const jiaoIndex = value.indexOf('角')
    const fenIndex = value.indexOf('分')
    const splitAt = [jiaoIndex, fenIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? value.length
    integerPart = value.slice(0, splitAt)
    fractionPart = value.slice(splitAt)
  }

  const integer = integerPart ? parseChineseInteger(integerPart) : 0
  const jiaoMatch = fractionPart.match(new RegExp(`([${AMOUNT_CHARS}])角`, 'u'))
  const fenMatch = fractionPart.match(new RegExp(`([${AMOUNT_CHARS}])分`, 'u'))
  const jiao = jiaoMatch ? (CN_DIGITS[jiaoMatch[1]] ?? 0) : 0
  const fen = fenMatch ? (CN_DIGITS[fenMatch[1]] ?? 0) : 0
  return integer * 100 + jiao * 10 + fen
}

function candidateScore(text: string): number {
  let score = 0
  for (const [keyword, weight] of Object.entries(KEYWORD_WEIGHT)) {
    if (text.includes(keyword)) {
      score += weight
    }
  }
  score += Math.min(Array.from(text.matchAll(new RegExp(`[${AMOUNT_CHARS}]`, 'gu'))).length, 18)
  return score
}

export function summarizeAmountFromText(rawText: string): Omit<ExtractAmountResponse, 'source' | 'elapsedMs' | 'stats'> {
  const texts = rawText
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
  const searchUnits = [...texts, texts.join('\n')]
  const candidates = new Map<string, { text: string; amount: string; amount_uppercase: string; score: number }>()

  for (const unit of searchUnits) {
    if (!new RegExp(`[${AMOUNT_CHARS}]`, 'u').test(unit)) {
      continue
    }
    const compact = unit.replace(/\s+/gu, '')
    const baseScore = candidateScore(unit)
    for (const match of compact.matchAll(amountSegmentPattern)) {
      const segment = match[0]
      let cents = 0
      try {
        cents = chineseAmountToCents(segment)
      } catch {
        continue
      }
      if (cents === 0) {
        continue
      }
      const amount = centsToAmount(cents)
      const candidate = {
        text: segment,
        amount,
        amount_uppercase: amountToChineseUppercase(amount),
        score: baseScore + candidateScore(segment),
      }
      const previous = candidates.get(segment)
      if (!previous || candidate.score > previous.score) {
        candidates.set(segment, candidate)
      }
    }
  }

  const orderedCandidates = Array.from(candidates.values()).sort((a, b) => b.score - a.score)
  const uniqueAmounts = new Set(orderedCandidates.map((candidate) => candidate.amount))
  if (uniqueAmounts.size === 1 && orderedCandidates.length > 0) {
    const best = orderedCandidates[0]
    return {
      status: 'recognized',
      amount: best.amount,
      amountText: best.text,
      amountUppercase: best.amount_uppercase,
      candidates: orderedCandidates,
      rawText: texts.join('\n'),
    }
  }

  return {
    status: 'needs_review',
    amount: null,
    amountText: orderedCandidates[0]?.text ?? null,
    amountUppercase: null,
    candidates: orderedCandidates,
    rawText: texts.join('\n'),
  }
}

function parseInvoiceQrAmount(payload: string): { text: string; amount: string; amount_uppercase: string; score: number } | null {
  const parts = payload.split(',').map((part) => part.trim())
  if (parts.length < 6) {
    return null
  }
  const amountText = parts[4]
  if (!/^\d+(?:\.\d{1,2})?$/u.test(amountText)) {
    return null
  }
  const cents = Math.round(Number(amountText) * 100)
  if (!Number.isFinite(cents) || cents <= 0) {
    return null
  }
  const amount = centsToAmount(cents)
  return {
    text: payload.trim(),
    amount,
    amount_uppercase: amountToChineseUppercase(amount),
    score: 100,
  }
}

function summarizeQrPayloads(payloads: string[]): Omit<ExtractAmountResponse, 'source' | 'elapsedMs' | 'stats'> | null {
  const candidatesByText = new Map<string, { text: string; amount: string; amount_uppercase: string; score: number }>()
  for (const payload of payloads) {
    const candidate = parseInvoiceQrAmount(payload)
    if (candidate) {
      candidatesByText.set(candidate.text, candidate)
    }
  }
  const candidates = Array.from(candidatesByText.values())
  const uniqueAmounts = new Set(candidates.map((candidate) => candidate.amount))
  if (uniqueAmounts.size !== 1 || candidates.length === 0) {
    return null
  }
  const best = candidates[0]
  return {
    status: 'recognized',
    amount: best.amount,
    amountText: best.text,
    amountUppercase: best.amount_uppercase,
    candidates,
    rawText: payloads.join('\n'),
  }
}

async function decodeQrPayloadFromPage(page: PdfPageProxy): Promise<string | null> {
  if (typeof document === 'undefined') {
    return null
  }
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = Math.min(3, Math.max(1.5, 1400 / baseViewport.width))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    return null
  }
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvas, canvasContext: context, viewport }).promise
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' })?.data ?? null
}

async function extractPdfSignals(
  file: File,
  onLoadProgress?: (progress: LoadProgress) => void,
): Promise<{ rawText: string; qrPayloads: string[] }> {
  const pdfjs = await loadPdfJs()
  const data = new Uint8Array(await file.arrayBuffer())
  onLoadProgress?.({ loaded: file.size, total: file.size || null, done: false })
  const loadingTask = pdfjs.getDocument({ data })
  const document = await loadingTask.promise
  const pages: string[] = []
  const qrPayloads: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const qrPayload = await decodeQrPayloadFromPage(page)
      if (qrPayload) {
        qrPayloads.push(qrPayload)
      }
      const content = await page.getTextContent()
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean)
        .join(' ')
      pages.push(pageText)
    }
  } finally {
    await document.destroy()
  }
  onLoadProgress?.({ loaded: file.size, total: file.size || null, done: true })
  return { rawText: pages.join('\n'), qrPayloads }
}

export async function extractInvoiceAmount(
  file: File,
  onLoadProgress?: (progress: LoadProgress) => void,
): Promise<ExtractAmountResponse> {
  const startedAt = performance.now()
  try {
    const { rawText, qrPayloads } = await extractPdfSignals(file, onLoadProgress)
    const qrSummary = summarizeQrPayloads(qrPayloads)
    const summary = qrSummary ?? summarizeAmountFromText(rawText)
    processedInvoices += 1
    const stats: InvoiceStatsResponse = {
      processedInvoices,
      updatedAt: new Date().toISOString(),
    }
    return {
      ...summary,
      source: qrSummary ? 'qr_code' : 'pdf_text',
      elapsedMs: Math.round(performance.now() - startedAt),
      stats,
    }
  } catch (error) {
    throw new Error(error instanceof Error ? `PDF 文本提取失败：${error.message}` : 'PDF 文本提取失败')
  }
}

export function getLocalInvoiceStats(): InvoiceStatsResponse {
  return {
    processedInvoices,
    updatedAt: processedInvoices > 0 ? new Date().toISOString() : null,
  }
}
