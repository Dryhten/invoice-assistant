import type { ExtractAmountResponse, InvoiceStatsResponse } from './types'

export interface UploadProgress {
  loaded: number
  total: number | null
  done: boolean
}

function extractErrorMessage(status: number, payload: unknown, fallbackText = ''): string {
  if (payload && typeof payload === 'object' && 'detail' in payload && typeof payload.detail === 'string') {
    return payload.detail
  }
  const text = fallbackText.trim()
  if (text) {
    return text
  }
  if (status === 0) {
    return '无法连接后端服务，或请求连接已中断。请确认后端仍在运行后重试。'
  }
  if (status === 502 || status === 504) {
    return `后端处理发票超时或连接中断（${status}），请稍后重试；如果同一文件反复失败，可能是该 PDF 无法被当前规则解析。`
  }
  if (status >= 500) {
    return `后端处理发票时发生错误（${status}），请重试；如果同一文件反复失败，可能是该 PDF 无法被当前规则解析。`
  }
  return `PDF 文本提取请求失败（${status}）`
}

function getResponseText(request: XMLHttpRequest): string {
  try {
    return request.responseText
  } catch {
    return ''
  }
}

export async function requestInvoiceAmount(
  file: File,
  onUploadProgress?: (progress: UploadProgress) => void,
): Promise<ExtractAmountResponse> {
  const formData = new FormData()
  formData.append('file', file, file.name)

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()

    request.open('POST', '/api/invoices/extract-amount')
    request.responseType = 'json'

    request.upload.onprogress = (event) => {
      onUploadProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : file.size || null,
        done: false,
      })
    }

    request.upload.onload = () => {
      onUploadProgress?.({
        loaded: file.size,
        total: file.size || null,
        done: true,
      })
    }

    request.onerror = () => {
      reject(new Error(extractErrorMessage(request.status, request.response, getResponseText(request))))
    }

    request.onabort = () => {
      reject(new Error('识别请求已取消，请重新发起识别。'))
    }

    request.ontimeout = () => {
      reject(new Error('识别请求超时，请稍后重试；如果同一文件反复失败，可能是该 PDF 无法被当前规则解析。'))
    }

    request.onload = () => {
      const payload = request.response
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(extractErrorMessage(request.status, payload, getResponseText(request))))
        return
      }
      resolve(payload as ExtractAmountResponse)
    }

    request.send(formData)
  })
}

export async function requestInvoiceStats(): Promise<InvoiceStatsResponse> {
  const response = await fetch('/api/invoices/stats')
  const responseForText = response.clone()
  const payload = (await response.json().catch(() => null)) as unknown
  if (!response.ok) {
    const fallbackText = payload === null ? await responseForText.text().catch(() => '') : ''
    throw new Error(extractErrorMessage(response.status, payload, fallbackText))
  }
  return payload as InvoiceStatsResponse
}
