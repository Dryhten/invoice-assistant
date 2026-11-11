import { describe, expect, it } from 'vitest'
import { summarizeAmountFromText, summarizeQrPayloads } from '../src/extraction'

// Synthetic identifiers only; never keep real invoice payloads in regression tests.
function fiscalQr(amount = '41.00', checksum = 'Ab12Cd') {
  return `CZ-EI-33,1.0.0,33000000,0000000001,${checksum},20260101,${amount}`
}

describe('invoice QR amount formats', () => {
  it('recognizes the total in a fiscal electronic toll receipt', () => {
    const summary = summarizeQrPayloads([fiscalQr()])

    expect(summary).toMatchObject({ status: 'recognized', amount: '41.00', amountUppercase: '肆拾壹圆整' })
  })

  it('does not treat a numeric fiscal check code as the amount', () => {
    expect(summarizeQrPayloads([fiscalQr('41.00', '123456')])?.amount).toBe('41.00')
  })

  it('accepts other fiscal regions and v1 revisions with the same seven-field layout', () => {
    const payload = fiscalQr('85.86').replace('CZ-EI-33,1.0.0', 'CZ-EI-00,1.1.0')

    expect(summarizeQrPayloads([payload])?.amount).toBe('85.86')
  })

  it('retains the existing VAT invoice QR format', () => {
    const payload = '01,10,012345678901,00000001,85.86,20260101,12345678901234567890,ABCD'

    expect(summarizeQrPayloads([payload])?.amount).toBe('85.86')
  })

  it('allows surrounding whitespace without changing the field positions', () => {
    const payload = `\n ${fiscalQr('41.00', '123456').split(',').join(' , ')} \n`

    expect(summarizeQrPayloads([payload])?.amount).toBe('41.00')
  })

  it.each([
    ['missing amount', fiscalQr('41.00', '123456').split(',').slice(0, 6).join(',')],
    ['extra field', `${fiscalQr('41.00', '123456')},12.00`],
    ['invalid region', fiscalQr('41.00', '123456').replace('CZ-EI-33', 'CZ-EI-X')],
    ['unknown fiscal label', fiscalQr('41.00', '123456').replace('CZ-EI-33', 'CZ-OTHER-33')],
    ['unknown major version', fiscalQr('41.00', '123456').replace('1.0.0', '2.0.0')],
    ['missing bill code', fiscalQr('41.00', '123456').replace('33000000', '')],
    ['invalid bill number', fiscalQr('41.00', '123456').replace('0000000001', 'not-a-number')],
    ['invalid date', fiscalQr('41.00', '123456').replace('20260101', 'not-a-date')],
    ['empty amount', fiscalQr('', '123456')],
    ['negative amount', fiscalQr('-41.00', '123456')],
    ['zero amount', fiscalQr('0.00', '123456')],
    ['fractional cents', fiscalQr('41.001', '123456')],
    ['non-numeric amount', fiscalQr('NaN', '123456')],
    ['unsafe amount', fiscalQr('999999999999999.99', '123456')],
  ])('rejects %s without falling back to the fiscal check code', (_reason, payload) => {
    expect(summarizeQrPayloads([payload])).toBeNull()
  })

  it('does not automatically choose between conflicting fiscal amounts', () => {
    expect(summarizeQrPayloads([fiscalQr('41.00'), fiscalQr('42.00')])).toBeNull()
  })
})

describe('browser invoice amount extraction rules', () => {
  it('recognizes a unique uppercase amount from PDF text', () => {
    const summary = summarizeAmountFromText('货物服务名称 金额 92.62\n价税合计（大写）捌拾伍圆捌角陆分 （小写）¥85.86')

    expect(summary.status).toBe('recognized')
    expect(summary.amount).toBe('85.86')
    expect(summary.amountUppercase).toBe('捌拾伍圆捌角陆分')
  })

  it('asks for review when multiple different amounts are present', () => {
    const summary = summarizeAmountFromText('价税合计（大写）捌拾伍圆捌角陆分\n人民币壹佰元整')

    expect(summary.status).toBe('needs_review')
    expect(summary.amount).toBeNull()
    expect(summary.candidates.map((candidate) => candidate.amount)).toEqual(['85.86', '100.00'])
  })

  it('asks for review when no amount can be extracted', () => {
    const summary = summarizeAmountFromText('普通发票 发票号码 123')

    expect(summary.status).toBe('needs_review')
    expect(summary.candidates).toEqual([])
  })
})
