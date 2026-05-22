import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import { extractInvoiceAmount, getLocalInvoiceStats } from '../src/extraction'
import { buildMergedInvoicePdf } from '../src/pdf'
import type { ExtractAmountResponse } from '../src/types'

vi.mock('../src/extraction', () => ({
  extractInvoiceAmount: vi.fn(),
  getLocalInvoiceStats: vi.fn(),
}))

vi.mock('../src/pdf', () => ({
  buildMergedInvoicePdf: vi.fn(),
}))

const mockedExtractInvoiceAmount = vi.mocked(extractInvoiceAmount)
const mockedGetLocalInvoiceStats = vi.mocked(getLocalInvoiceStats)
const mockedBuildMergedInvoicePdf = vi.mocked(buildMergedInvoicePdf)
const createObjectURL = vi.fn(() => 'blob:merged')
const revokeObjectURL = vi.fn()
const writeText = vi.fn()

const recognizedResponse: ExtractAmountResponse = {
  status: 'recognized',
  amount: '85.86',
  amountText: '捌拾伍圆捌角陆分',
  amountUppercase: '捌拾伍圆捌角陆分',
  candidates: [],
  rawText: '价税合计（大写）捌拾伍圆捌角陆分',
  source: 'pdf_text',
  elapsedMs: 5,
}

const reviewResponse: ExtractAmountResponse = {
  status: 'needs_review',
  amount: null,
  amountText: '捌拾伍圆捌角陆分',
  amountUppercase: null,
  candidates: [
    {
      text: '捌拾伍圆捌角陆分',
      amount: '85.86',
      amount_uppercase: '捌拾伍圆捌角陆分',
      score: 20,
    },
    {
      text: '壹佰元整',
      amount: '100.00',
      amount_uppercase: '壹佰圆整',
      score: 12,
    },
  ],
  rawText: '价税合计（大写）捌拾伍圆捌角陆分 人民币壹佰元整',
  source: 'pdf_text',
  elapsedMs: 6,
}

function pdfFile() {
  return new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' })
}

async function uploadFiles(wrapper: ReturnType<typeof mount>, files: File[]) {
  const input = wrapper.find<HTMLInputElement>('input[type="file"]')
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: files,
  })
  await input.trigger('change')
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText,
    },
  })
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  })
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL,
  })
  mockedBuildMergedInvoicePdf.mockResolvedValue(new Blob(['merged pdf'], { type: 'application/pdf' }))
  mockedExtractInvoiceAmount.mockResolvedValue(recognizedResponse)
  mockedGetLocalInvoiceStats.mockReturnValue({ processedInvoices: 0, updatedAt: null })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('App invoice workflow', () => {
  it('shows a minimum upload progress overlay before revealing the result surface', async () => {
    vi.useFakeTimers()
    const file = pdfFile()
    mockedExtractInvoiceAmount.mockImplementationOnce(
      (_file, onUploadProgress) =>
        new Promise((resolve) => {
          onUploadProgress?.({ loaded: file.size / 4, total: file.size, done: false })
          setTimeout(() => {
            onUploadProgress?.({ loaded: file.size, total: file.size, done: true })
            resolve(recognizedResponse)
          }, 10)
        }),
    )
    const wrapper = mount(App)

    await uploadFiles(wrapper, [file])

    expect(wrapper.find('.upload-overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('正在处理发票')
    expect(wrapper.text()).toContain('处理进度 25%')

    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(wrapper.find('.upload-overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('处理完成')

    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(340)
    await flushPromises()

    expect(wrapper.find('.upload-overlay').exists()).toBe(false)
    expect(wrapper.text()).toContain('已确认')
    wrapper.unmount()
  })

  it('lets the user confirm a candidate when extraction needs review', async () => {
    mockedExtractInvoiceAmount.mockResolvedValueOnce(reviewResponse)
    const wrapper = mount(App)

    await uploadFiles(wrapper, [pdfFile()])

    expect(mockedExtractInvoiceAmount).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('待确认')
    const candidateButton = wrapper.findAll('button').find((button) => button.text().includes('¥85.86'))
    expect(candidateButton).toBeTruthy()

    await candidateButton!.trigger('click')

    expect(wrapper.text()).toContain('已确认')
    expect(wrapper.text()).toContain('¥85.86')
    expect(wrapper.text()).toContain('捌拾伍圆捌角陆分')
  })

  it('loads and refreshes the local processed invoice count', async () => {
    mockedGetLocalInvoiceStats.mockReturnValueOnce({ processedInvoices: 12, updatedAt: '2026-05-21T00:00:00Z' })
    mockedExtractInvoiceAmount.mockResolvedValueOnce({
      ...recognizedResponse,
      stats: { processedInvoices: 13, updatedAt: '2026-05-21T00:01:00Z' },
    })
    const wrapper = mount(App)

    await flushPromises()

    expect(mockedGetLocalInvoiceStats).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('本次已处理 12 张')

    await uploadFiles(wrapper, [pdfFile()])

    expect(wrapper.text()).toContain('本次已处理 13 张')
  })

  it('enlarges and copies the uppercase invoice amount text', async () => {
    const wrapper = mount(App)

    await uploadFiles(wrapper, [pdfFile()])

    const uppercaseButton = wrapper.find<HTMLButtonElement>('.invoice-uppercase')
    expect(uppercaseButton.exists()).toBe(true)

    await uppercaseButton.trigger('mouseenter')

    const popover = wrapper.find('.uppercase-popover')
    expect(popover.exists()).toBe(true)
    expect(popover.text()).toContain('捌拾伍圆捌角陆分')
    expect(popover.text()).toContain('点击复制')

    await uppercaseButton.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('捌拾伍圆捌角陆分')
    expect(wrapper.find('.uppercase-copy-state').text()).toContain('已复制')

    await uppercaseButton.trigger('mouseleave')
    expect(wrapper.find('.uppercase-popover').exists()).toBe(false)
  })

  it('copies candidate uppercase text without selecting the candidate row', async () => {
    mockedExtractInvoiceAmount.mockResolvedValueOnce(reviewResponse)
    const wrapper = mount(App)

    await uploadFiles(wrapper, [pdfFile()])

    const candidateUppercase = wrapper.find<HTMLElement>('.candidate-uppercase')
    expect(candidateUppercase.exists()).toBe(true)

    await candidateUppercase.trigger('mouseenter')
    expect(wrapper.find('.uppercase-popover').text()).toContain('捌拾伍圆捌角陆分')
    expect(wrapper.find('.uppercase-popover').text()).toContain('点击复制')

    await candidateUppercase.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('捌拾伍圆捌角陆分')
    expect(wrapper.find('.invoice-card .status').text()).toContain('待确认')
    expect(wrapper.find('.amount-block').exists()).toBe(false)
  })

  it('rejects non-PDF files before calling extraction or preview generation', async () => {
    const wrapper = mount(App)

    await uploadFiles(wrapper, [new File(['not a pdf'], 'invoice.txt', { type: 'text/plain' })])

    expect(mockedExtractInvoiceAmount).not.toHaveBeenCalled()
    expect(mockedBuildMergedInvoicePdf).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('失败')
    expect(wrapper.text()).toContain('仅支持 PDF 文件')
  })

  it('does not apply stale preview results after clearing invoices', async () => {
    let resolveBuild!: (value: Blob | null) => void
    mockedBuildMergedInvoicePdf.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBuild = resolve
        }),
    )
    const wrapper = mount(App)

    await uploadFiles(wrapper, [pdfFile()])
    const clearButton = wrapper.findAll('button').find((button) => button.text().includes('清空'))
    expect(clearButton).toBeTruthy()

    await clearButton!.trigger('click')
    resolveBuild(new Blob(['old pdf'], { type: 'application/pdf' }))
    await flushPromises()

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('拖拽或选择 PDF 发票')
  })
})
