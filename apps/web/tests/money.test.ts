import { describe, expect, it } from 'vitest'
import { amountToCents, amountToChineseUppercase, centsToAmount, tryFormatAmount } from '../src/utils/money'

describe('money helpers', () => {
  it('formats normal amounts through cents', () => {
    expect(amountToCents('85.86')).toBe(8586)
    expect(centsToAmount(8586)).toBe('85.86')
  })

  it('converts number amounts to Chinese uppercase', () => {
    expect(amountToChineseUppercase('10.70')).toBe('壹拾圆零柒角整')
    expect(amountToChineseUppercase('23.57')).toBe('贰拾叁圆伍角柒分')
    expect(amountToChineseUppercase('85.86')).toBe('捌拾伍圆捌角陆分')
    expect(amountToChineseUppercase('102.00')).toBe('壹佰零贰圆整')
  })

  it('normalizes manual amount input and rejects invalid values', () => {
    expect(tryFormatAmount('85.8')).toBe('85.80')
    expect(tryFormatAmount('85.888')).toBeNull()
    expect(tryFormatAmount('abc')).toBeNull()
  })
})
