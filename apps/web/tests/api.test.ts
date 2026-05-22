import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestInvoiceAmount, requestInvoiceStats } from '../src/api'

class MockXMLHttpRequest {
  status = 0
  response: unknown = null
  responseText = ''
  responseType = ''
  upload = {
    onprogress: null as ((event: ProgressEvent) => void) | null,
    onload: null as (() => void) | null,
  }
  onerror: (() => void) | null = null
  onload: (() => void) | null = null
  onabort: (() => void) | null = null
  ontimeout: (() => void) | null = null
  open = vi.fn()
  send = vi.fn()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('api error messages', () => {
  it('does not label every XHR connection failure as backend startup failure', async () => {
    const request = new MockXMLHttpRequest()
    vi.stubGlobal('XMLHttpRequest', vi.fn(() => request))

    const promise = requestInvoiceAmount(new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' }))
    request.onerror?.()

    await expect(promise).rejects.toThrow('无法连接后端服务，或请求连接已中断')
  })

  it('preserves backend detail messages for failed extraction responses', async () => {
    const request = new MockXMLHttpRequest()
    request.status = 502
    request.response = { detail: 'PDF 文本提取失败：cannot open broken document' }
    vi.stubGlobal('XMLHttpRequest', vi.fn(() => request))

    const promise = requestInvoiceAmount(new File(['%PDF-1.4'], 'broken.pdf', { type: 'application/pdf' }))
    request.onload?.()

    await expect(promise).rejects.toThrow('PDF 文本提取失败：cannot open broken document')
  })

  it('uses a processing error for server 500 responses without JSON detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))

    await expect(requestInvoiceStats()).rejects.toThrow('后端处理发票时发生错误（500）')
  })
})
