// 标签导出为实际尺寸 PDF（300 dpi）：每张一页（标签机）或 A4 排版。
import { formatLabelCode, labelUrl, type Label } from '../core/index.ts'
import { buildPdf, type PdfPage } from './pdf.ts'

export const DPI = 300
const px = (mm: number) => Math.round((mm / 25.4) * DPI)

export interface LabelContent {
  label: Label
  name?: string
  path?: string
}

export interface ExportOptions {
  appUrl: string
  size: { w: number; h: number }
  layout: 'roll' | 'a4'
}

const FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
const MONO = "ui-monospace, Menlo, 'SF Mono', monospace"

async function qrCanvas(text: string, sizePx: number): Promise<HTMLCanvasElement> {
  const QR = (await import('qrcode')).default
  const c = document.createElement('canvas')
  // 四模块静区、M 级纠错，黑白高反差
  await QR.toCanvas(c, text, { errorCorrectionLevel: 'M', margin: 4, width: sizePx, color: { dark: '#000000', light: '#ffffff' } })
  return c
}

/** 按宽度折行（中文无空格，逐字测量），最多 maxLines 行，超出加省略号。 */
function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const ch of [...text]) {
    if (g.measureText(cur + ch).width > maxW && cur) {
      lines.push(cur)
      cur = ch
      if (lines.length === maxLines) break
    } else {
      cur += ch
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur)
  const used = lines.join('').length
  if (used < [...text].length && lines.length) {
    let last = lines[lines.length - 1]
    while (last && g.measureText(last + '…').width > maxW) last = last.slice(0, -1)
    lines[lines.length - 1] = last + '…'
  }
  return lines
}

/** 在 (x, y) 处画一张标签，尺寸 w×h 毫米。与打印预览的版式一致。 */
async function drawLabel(g: CanvasRenderingContext2D, x: number, y: number, item: LabelContent, opts: ExportOptions, border: boolean) {
  const W = px(opts.size.w)
  const H = px(opts.size.h)
  const pad = px(2)
  const qrMm = Math.min(opts.size.h - 4, Math.round(opts.size.w * 0.55))
  const tiny = opts.size.w - qrMm < 20
  const q = px(qrMm)
  g.fillStyle = '#ffffff'
  g.fillRect(x, y, W, H)
  if (border) {
    g.save()
    g.strokeStyle = '#b0b0b0'
    g.lineWidth = 2
    g.setLineDash([12, 10])
    g.strokeRect(x + 1, y + 1, W - 2, H - 2)
    g.restore()
  }
  const qr = await qrCanvas(labelUrl(opts.appUrl, item.label.token), q)
  g.imageSmoothingEnabled = false
  g.drawImage(qr, x + pad, y + (H - q) / 2, q, q)
  const tx = x + pad + q + px(1.5)
  const tw = x + W - pad - tx
  g.fillStyle = '#000000'
  g.textBaseline = 'top'
  let ty = y + pad + px(0.5)
  if (item.name) {
    const fs = px(tiny ? 2.4 : 3)
    g.font = `700 ${fs}px ${FONT}`
    for (const line of wrap(g, item.name, tw, 2)) {
      g.fillText(line, tx, ty)
      ty += fs * 1.15
    }
  }
  if (item.path) {
    const fs = px(2.2)
    g.font = `400 ${fs}px ${FONT}`
    g.fillStyle = '#333333'
    for (const line of wrap(g, item.path, tw, 2)) {
      g.fillText(line, tx, ty + px(0.6))
      ty += fs * 1.2
    }
    g.fillStyle = '#000000'
  }
  const cs = px(tiny ? 2.6 : 3.2)
  g.font = `700 ${cs}px ${MONO}`
  g.textBaseline = 'bottom'
  const bottom = y + H - pad - px(0.5)
  if (tiny) {
    g.fillText(item.label.code.slice(3), tx, bottom)
    g.fillText(item.label.code.slice(0, 3), tx, bottom - cs * 1.1)
  } else {
    g.fillText(formatLabelCode(item.label.code), tx, bottom)
  }
}

async function pageFromCanvas(c: HTMLCanvasElement, mmW: number, mmH: number): Promise<PdfPage> {
  const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.95))
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), pxW: c.width, pxH: c.height, mmW, mmH }
}

export const A4 = { w: 210, h: 297, margin: 10, gap: 3 }

/** A4 每页能排多少列/行 */
export function a4Grid(size: { w: number; h: number }): { cols: number; rows: number } {
  const cols = Math.max(1, Math.floor((A4.w - 2 * A4.margin + A4.gap) / (size.w + A4.gap)))
  const rows = Math.max(1, Math.floor((A4.h - 2 * A4.margin + A4.gap) / (size.h + A4.gap)))
  return { cols, rows }
}

export async function exportLabelsPdf(items: LabelContent[], opts: ExportOptions): Promise<Blob> {
  const pages: PdfPage[] = []
  if (opts.layout === 'roll') {
    for (const item of items) {
      const c = document.createElement('canvas')
      c.width = px(opts.size.w)
      c.height = px(opts.size.h)
      await drawLabel(c.getContext('2d')!, 0, 0, item, opts, false)
      pages.push(await pageFromCanvas(c, opts.size.w, opts.size.h))
    }
  } else {
    const { cols, rows } = a4Grid(opts.size)
    const per = cols * rows
    for (let start = 0; start < items.length; start += per) {
      const c = document.createElement('canvas')
      c.width = px(A4.w)
      c.height = px(A4.h)
      const g = c.getContext('2d')!
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, c.width, c.height)
      const chunk = items.slice(start, start + per)
      for (let i = 0; i < chunk.length; i++) {
        const col = i % cols
        const row = Math.floor(i / cols)
        await drawLabel(g, px(A4.margin + col * (opts.size.w + A4.gap)), px(A4.margin + row * (opts.size.h + A4.gap)), chunk[i], opts, true)
      }
      pages.push(await pageFromCanvas(c, A4.w, A4.h))
    }
  }
  return new Blob([buildPdf(pages) as BlobPart], { type: 'application/pdf' })
}

/** 有系统分享（iPhone/Android）就用分享面板，否则下载文件。返回实际使用的方式。 */
export async function shareOrDownload(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename })
      return 'shared'
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return 'cancelled'
    }
  }
  const { downloadBlob } = await import('./files.ts')
  downloadBlob(blob, filename)
  return 'downloaded'
}

/** iOS 主屏幕应用（独立窗口）里 window.print() 无效 */
export function printUnsupported(): boolean {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return standalone && ios
}
