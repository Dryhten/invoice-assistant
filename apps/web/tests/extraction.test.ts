import { describe, expect, it } from 'vitest'
import { summarizeAmountFromText } from '../src/extraction'

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
