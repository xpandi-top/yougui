// 条码与标签编码：UPC/EAN 校验与规范化，标签 token / 短编号，扫码内容分类。

/** GTIN 校验位（适用于 EAN-8 / UPC-A / EAN-13）。 */
export function gtinCheckValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  const body = digits.slice(0, -1)
  const check = Number(digits.at(-1))
  let sum = 0
  // 从右往左（不含校验位），奇数位 ×3
  for (let i = body.length - 1, pos = 0; i >= 0; i--, pos++) {
    sum += Number(body[i]) * (pos % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10 === check
}

export type ProductFormat = 'ean13' | 'upca' | 'ean8'

export interface ProductCode {
  /** 规范化后：UPC-A 补前导 0 成 EAN-13，其余保持原样（保留前导零） */
  normalized: string
  raw: string
  format: ProductFormat
}

export function parseProductCode(raw: string): ProductCode | null {
  const s = raw.trim().replace(/[\s-]/g, '')
  if (!/^\d+$/.test(s)) return null
  if (s.length === 13 && gtinCheckValid(s)) return { normalized: s, raw: s, format: 'ean13' }
  if (s.length === 12 && gtinCheckValid(s)) return { normalized: '0' + s, raw: s, format: 'upca' }
  if (s.length === 8 && gtinCheckValid(s)) return { normalized: s, raw: s, format: 'ean8' }
  return null
}

/** 显示用：前导 0 的 EAN-13 就是 UPC-A，按包装上印的 12 位显示。 */
export function displayProductCode(normalized: string): string {
  return normalized.length === 13 && normalized.startsWith('0') ? `${normalized.slice(1)} · UPC-A` : normalized
}

/**
 * 手输纠错：UPC-A 首末两位印在条外、字号小，常被漏掉。
 * 11 位时给出「补末位校验位」与「补前导 0」中校验通过的候选；不自动采用，由用户确认。
 */
export function productCodeSuggestions(raw: string): string[] {
  const s = raw.trim().replace(/[\s-]/g, '')
  if (!/^\d{11}$/.test(s)) return []
  const out: string[] = []
  for (let c = 0; c <= 9; c++) if (gtinCheckValid(s + c)) out.push(s + c)
  if (gtinCheckValid('0' + s)) out.push('0' + s)
  return out
}

/** 去掉易混字符（0/O、1/I/L）的短编号字母表。 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
export const CODE_LENGTH = 6
export const TOKEN_LENGTH = 16

/** 用注入的随机字节生成字符串（拒绝采样，避免取模偏差）。 */
export function randomString(alphabet: string, length: number, randomBytes: (n: number) => Uint8Array): string {
  const max = Math.floor(256 / alphabet.length) * alphabet.length
  let out = ''
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < max) out += alphabet[b % alphabet.length]
      if (out.length === length) break
    }
  }
  return out
}

export function isLabelCode(input: string): boolean {
  const s = input.toUpperCase().replace(/[\s-]/g, '')
  return s.length === CODE_LENGTH && [...s].every((c) => CODE_ALPHABET.includes(c))
}

export function formatLabelCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code
}

/** 标签深链接：<应用地址>#/l/<token> */
export function labelUrl(appUrl: string, token: string): string {
  const base = appUrl.split('#')[0]
  return `${base}#/l/${token}`
}

export type ScanResult =
  | { kind: 'label'; token: string }
  | { kind: 'code'; code: string }
  | { kind: 'product'; product: ProductCode }
  | { kind: 'invalidProduct'; raw: string; suggestions: string[] }
  | { kind: 'unknown'; text: string }

/** 识别扫码/手输内容。只识别本应用格式；外部二维码一律 unknown，不自动打开。 */
export function classifyScan(text: string): ScanResult {
  const s = text.trim()
  const m = s.match(/#\/l\/([a-z0-9]{8,64})\b/i) ?? s.match(/^YG:([a-z0-9]{8,64})$/i)
  if (m) return { kind: 'label', token: m[1].toLowerCase() }
  if (isLabelCode(s)) return { kind: 'code', code: s.toUpperCase().replace(/[\s-]/g, '') }
  const digits = s.replace(/[\s-]/g, '')
  if (/^\d{8,14}$/.test(digits)) {
    const p = parseProductCode(digits)
    return p ? { kind: 'product', product: p } : { kind: 'invalidProduct', raw: digits, suggestions: productCodeSuggestions(digits) }
  }
  return { kind: 'unknown', text: s }
}
