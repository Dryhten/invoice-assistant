import type { ExtractAmountResponse } from './types'

export async function requestInvoiceAmount(file: File): Promise<ExtractAmountResponse> {
  const formData = new FormData()
  formData.append('file', file, file.name)

  let response: Response
  try {
    response = await fetch('/api/invoices/extract-amount', {
      method: 'POST',
      body: formData,
    })
  } catch {
    throw new Error('后端服务尚未启动完成，请等待 server 输出监听地址后重试。')
  }

  if (!response.ok) {
    let message =
      response.status >= 500
        ? '后端 PDF 文本提取暂不可用，请确认 server 已启动完成后重试。'
        : `PDF 文本提取请求失败（${response.status}）`
    try {
      const payload = (await response.json()) as { detail?: string }
      if (payload.detail) {
        message = payload.detail
      }
    } catch {
      // Keep the generic status message.
    }
    throw new Error(message)
  }

  return (await response.json()) as ExtractAmountResponse
}
