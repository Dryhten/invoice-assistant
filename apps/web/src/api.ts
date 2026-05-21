import type { ExtractAmountResponse } from './types'

export interface UploadProgress {
  loaded: number
  total: number | null
  done: boolean
}

function extractErrorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object' && 'detail' in payload && typeof payload.detail === 'string') {
    return payload.detail
  }
  if (status >= 500) {
    return '后端 PDF 文本提取暂不可用，请确认 server 已启动完成后重试。'
  }
  return `PDF 文本提取请求失败（${status}）`
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
      reject(new Error('后端服务尚未启动完成，请等待 server 输出监听地址后重试。'))
    }

    request.onload = () => {
      const payload = request.response
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(extractErrorMessage(request.status, payload)))
        return
      }
      resolve(payload as ExtractAmountResponse)
    }

    request.send(formData)
  })
}
