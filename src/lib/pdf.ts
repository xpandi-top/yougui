// 极简 PDF 写入器：每页一张 JPEG 铺满（DCTDecode），页面尺寸按毫米给出。
// 用于标签导出：iPhone 主屏幕应用不支持 window.print()，改为分享 PDF 走 AirPrint / 存到文件 / 标签机 App。

export interface PdfPage {
  jpeg: Uint8Array
  /** 图片像素尺寸 */
  pxW: number
  pxH: number
  /** 页面尺寸（毫米） */
  mmW: number
  mmH: number
}

const MM_TO_PT = 72 / 25.4

export function buildPdf(pages: PdfPage[]): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (c: Uint8Array | string) => {
    const b = typeof c === 'string' ? enc.encode(c) : c
    chunks.push(b)
    length += b.length
  }
  const obj = (n: number, body: () => void) => {
    offsets[n] = length
    push(`${n} 0 obj\n`)
    body()
    push('\nendobj\n')
  }

  push('%PDF-1.4\n%âãÏÓ\n')
  // 对象编号：1 目录、2 页面树、之后每页 3 个（页、图、内容）
  const pageNum = (i: number) => 3 + i * 3
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'))
  obj(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageNum(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`))
  pages.forEach((p, i) => {
    const n = pageNum(i)
    const w = (p.mmW * MM_TO_PT).toFixed(2)
    const h = (p.mmH * MM_TO_PT).toFixed(2)
    obj(n, () =>
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`),
    )
    obj(n + 1, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`)
      push(p.jpeg)
      push('\nendstream')
    })
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`
    obj(n + 2, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`))
  })
  const total = 3 + pages.length * 3
  const xref = length
  push(`xref\n0 ${total}\n0000000000 65535 f \n`)
  for (let i = 1; i < total; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}
