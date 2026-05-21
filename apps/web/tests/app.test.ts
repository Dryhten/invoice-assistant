import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import { requestInvoiceAmount } from '../src/api'
import { buildMergedInvoicePdf } from '../src/pdf'
import type { ExtractAmountResponse } from '../src/types'

vi.mock('../src/api', () => ({
  requestInvoiceAmount: vi.fn(),
}))

vi.mock('../src/pdf', () => ({
  buildMergedInvoicePdf: vi.fn(),
}))

const mockedRequestInvoiceAmount = vi.mocked(requestInvoiceAmount)
const mockedBuildMergedInvoicePdf = vi.mocked(buildMergedInvoicePdf)
const createObjectURL = vi.fn(() => 'blob:merged')
const revokeObjectURL = vi.fn()

const recognizedResponse: ExtractAmountResponse = {
  status: 'recognized',
  amount: '85.86',
  amountText: '捌拾伍圆捌角陆分',
  amountUppercase: '捌拾伍元捌角陆分',
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
      amount_uppercase: '捌拾伍元捌角陆分',
      score: 20,
    },
    {
      text: '壹佰元整',
      amount: '100.00',
      amount_uppercase: '壹佰元整',
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
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  })
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL,
  })
  mockedBuildMergedInvoicePdf.mockResolvedValue(new Blob(['merged pdf'], { type: 'application/pdf' }))
  mockedRequestInvoiceAmount.mockResolvedValue(recognizedResponse)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App invoice workflow', () => {
  it('lets the user confirm a candidate when extraction needs review', async () => {
    mockedRequestInvoiceAmount.mockResolvedValueOnce(reviewResponse)
    const wrapper = mount(App)

    await uploadFiles(wrapper, [pdfFile()])

    expect(mockedRequestInvoiceAmount).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('待确认')
    const candidateButton = wrapper.findAll('button').find((button) => button.text().includes('¥85.86'))
    expect(candidateButton).toBeTruthy()

    await candidateButton!.trigger('click')

    expect(wrapper.text()).toContain('已确认')
    expect(wrapper.text()).toContain('¥85.86')
    expect(wrapper.text()).toContain('捌拾伍元捌角陆分')
  })

  it('rejects non-PDF files before calling extraction or preview generation', async () => {
    const wrapper = mount(App)

    await uploadFiles(wrapper, [new File(['not a pdf'], 'invoice.txt', { type: 'text/plain' })])

    expect(mockedRequestInvoiceAmount).not.toHaveBeenCalled()
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
    expect(wrapper.text()).toContain('拖拽或选择发票文件')
  })
})
