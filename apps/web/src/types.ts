export type InvoiceStatus = 'queued' | 'processing' | 'recognized' | 'needs_review' | 'failed'

export interface AmountCandidate {
  text: string
  amount: string
  amount_uppercase: string
  score: number
}

export interface InvoiceStatsResponse {
  processedInvoices: number
  updatedAt: string | null
}

export interface ExtractAmountResponse {
  status: 'recognized' | 'needs_review' | 'failed'
  amount: string | null
  amountText: string | null
  amountUppercase: string | null
  candidates: AmountCandidate[]
  rawText: string
  source: 'pdf_text'
  elapsedMs: number
  stats?: InvoiceStatsResponse | null
}

export interface InvoiceItem {
  id: string
  file: File
  name: string
  status: InvoiceStatus
  amount: string | null
  amountUppercase: string | null
  amountText: string | null
  manualAmount: string
  manualError: string | null
  candidates: AmountCandidate[]
  rawText: string
  source: ExtractAmountResponse['source'] | null
  elapsedMs: number | null
  error: string | null
}
