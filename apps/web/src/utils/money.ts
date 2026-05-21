const UPPER_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const UPPER_UNITS = ['', '拾', '佰', '仟']
const UPPER_SECTIONS = ['', '万', '亿', '兆']

export function amountToCents(amount: string | number): number {
  const text = String(amount).trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new Error('金额格式应为数字，最多两位小数')
  }
  const [yuan, fraction = ''] = text.split('.')
  return Number(yuan) * 100 + Number(fraction.padEnd(2, '0'))
}

export function centsToAmount(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const yuan = Math.floor(absolute / 100)
  const fraction = String(absolute % 100).padStart(2, '0')
  return `${sign}${yuan}.${fraction}`
}

function sectionToUpper(section: number): string {
  let result = ''
  let zero = false
  const digits = [
    Math.floor(section / 1000),
    Math.floor(section / 100) % 10,
    Math.floor(section / 10) % 10,
    section % 10,
  ]

  digits.forEach((digit, index) => {
    const unitIndex = 3 - index
    if (digit === 0) {
      zero = result.length > 0
      return
    }
    if (zero) {
      result += '零'
      zero = false
    }
    result += UPPER_DIGITS[digit] + UPPER_UNITS[unitIndex]
  })

  return result
}

function integerToUpper(value: number): string {
  if (value === 0) {
    return '零'
  }

  const sections: number[] = []
  let remaining = value
  while (remaining > 0) {
    sections.push(remaining % 10000)
    remaining = Math.floor(remaining / 10000)
  }

  let result = ''
  let needZero = false
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const section = sections[index]
    if (section === 0) {
      needZero = true
      continue
    }
    if (needZero && result && !result.endsWith('零')) {
      result += '零'
    }
    result += sectionToUpper(section) + UPPER_SECTIONS[index]
    needZero = section < 1000
  }
  return result.replace(/零+$/u, '')
}

export function amountToChineseUppercase(amount: string | number): string {
  const cents = amountToCents(amount)
  if (cents < 0) {
    throw new Error('金额不能为负数')
  }

  const integer = Math.floor(cents / 100)
  const fraction = cents % 100
  const jiao = Math.floor(fraction / 10)
  const fen = fraction % 10

  let result = `${integerToUpper(integer)}圆`
  if (fraction === 0) {
    return `${result}整`
  }
  if (jiao > 0) {
    if (integer > 0 && integer % 10 === 0) {
      result += '零'
    }
    result += `${UPPER_DIGITS[jiao]}角`
    if (fen === 0) {
      result += '整'
    }
  } else if (integer > 0 && fen > 0) {
    result += '零'
  }
  if (fen > 0) {
    result += `${UPPER_DIGITS[fen]}分`
  }
  return result
}

export function tryFormatAmount(amount: string): string | null {
  try {
    return centsToAmount(amountToCents(amount))
  } catch {
    return null
  }
}
