import { describe, expect, it } from 'vitest'
import { buildMergedInvoicePdf } from '../src/pdf'

describe('PDF merge helper', () => {
  it('returns null when there are no supported files', async () => {
    await expect(buildMergedInvoicePdf([])).resolves.toBeNull()
    await expect(buildMergedInvoicePdf([new File(['plain text'], 'notes.txt', { type: 'text/plain' })])).resolves.toBeNull()
  })
})
