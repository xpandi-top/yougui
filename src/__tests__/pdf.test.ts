// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { a4Grid } from '../lib/labelExport.ts'
import { buildPdf } from '../lib/pdf.ts'

const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])

describe('PDF 写入器', () => {
  it('每页一张图，页面按毫米换算为点；xref 偏移指向各对象', () => {
    const pdf = buildPdf([
      { jpeg: fakeJpeg, pxW: 472, pxH: 354, mmW: 40, mmH: 30 },
      { jpeg: fakeJpeg, pxW: 472, pxH: 354, mmW: 40, mmH: 30 },
    ])
    const text = new TextDecoder('latin1').decode(pdf)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Count 2')
    expect(text).toContain('/MediaBox [0 0 113.39 85.04]') // 40×30 mm
    expect(text.match(/\/Filter \/DCTDecode/g)).toHaveLength(2)
    const startxref = Number(text.match(/startxref\n(\d+)/)![1])
    expect(text.slice(startxref, startxref + 4)).toBe('xref')
    const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    offsets.forEach((off, i) => expect(text.slice(off).startsWith(`${i + 1} 0 obj\n`)).toBe(true))
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('A4 排版列行数', () => {
    expect(a4Grid({ w: 40, h: 30 })).toEqual({ cols: 4, rows: 8 })
    expect(a4Grid({ w: 62, h: 29 })).toEqual({ cols: 2, rows: 8 }) // 3×62+2×3 = 192 > 190 可用宽度
  })
})
