// 文件处理：照片优化、校验和、对象 URL、下载。
export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const PHOTO_MAX_EDGE = 1600
export const ALLOWED_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/i
const BLOCKED_EXT = /\.(svg|html?|xhtml|js|mjs|exe|bat|cmd|sh|app|dmg|apk|msi)$/i

export type FileCheck = { ok: true; mime: string } | { ok: false; reason: 'tooLarge' | 'type' }

/** 文件类型检查：MIME 与扩展名双重判断，拒绝 SVG/HTML/可执行文件。 */
export function checkFile(file: File): FileCheck {
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: 'tooLarge' }
  if (BLOCKED_EXT.test(file.name)) return { ok: false, reason: 'type' }
  let mime = file.type
  if (!mime) {
    if (/\.pdf$/i.test(file.name)) mime = 'application/pdf'
    else if (/\.(heic|heif)$/i.test(file.name)) mime = 'image/heic'
    else if (/\.jpe?g$/i.test(file.name)) mime = 'image/jpeg'
    else if (/\.png$/i.test(file.name)) mime = 'image/png'
  }
  if (!ALLOWED_MIME.test(mime)) return { ok: false, reason: 'type' }
  return { ok: true, mime }
}

/** 读文件头确认真实类型（防 MIME 伪装）。 */
export async function sniffMime(blob: Blob): Promise<string | null> {
  const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  if (hex.startsWith('ffd8ff')) return 'image/jpeg'
  if (hex.startsWith('89504e47')) return 'image/png'
  if (hex.startsWith('25504446')) return 'application/pdf'
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return 'image/webp'
  if (hex.slice(8, 16) === '66747970') return 'image/heic'
  return null
}

export async function sha256(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export interface OptimizedPhoto {
  blob: Blob
  width: number
  height: number
}

/**
 * 照片优化：按 EXIF 方向修正，长边 ≤1600，输出 JPEG（不保留原图 EXIF）。小图不放大。
 * 浏览器无法解码（如部分 HEIC）时抛错，调用方提示改为文档保存原件。
 */
export async function optimizePhoto(file: Blob): Promise<OptimizedPhoto> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bmp.width, bmp.height))
    const width = Math.max(1, Math.round(bmp.width * scale))
    const height = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const g = canvas.getContext('2d')
    if (!g) throw new Error('canvas')
    g.drawImage(bmp, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.85),
    )
    return { blob, width, height }
  } finally {
    bmp.close()
  }
}

export async function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const s = { width: bmp.width, height: bmp.height }
    bmp.close()
    return s
  } catch {
    return null
  }
}

const urls = new Map<string, string>()

/** 每个附件一个对象 URL，删除时释放。 */
export function objectUrlFor(id: string, blob: Blob): string {
  let u = urls.get(id)
  if (!u) {
    u = URL.createObjectURL(blob)
    urls.set(id, u)
  }
  return u
}

export function revokeObjectUrl(id: string): void {
  const u = urls.get(id)
  if (u) {
    URL.revokeObjectURL(u)
    urls.delete(id)
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a')
  const u = URL.createObjectURL(blob)
  a.href = u
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(u), 10_000)
}

export function extFor(mime: string | undefined): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/heic':
    case 'image/heif':
      return 'heic'
    case 'application/pdf':
      return 'pdf'
    default:
      return 'bin'
  }
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// 相机/系统生成的无意义文件名：image.jpg、IMG_1234.HEIC、PXL_20261013_1203.jpg、photo (2).png、截屏2026…
const GENERIC_NAME = /^(image|img|photo|pic|picture|pxl|dsc|dscn|dcim|mvimg|screenshot|screen shot|scan|截屏|截图|照片|图片|相片)?[\s_\-.()\d]*$/i

export function baseFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim()
}

export function isGenericFileName(name: string): boolean {
  const base = baseFileName(name)
  return !base || GENERIC_NAME.test(base)
}

/**
 * 附件默认名称：照片或无意义文件名优先用所属物品/房间的名称；
 * 有意义的文件名（如 costco-receipt.pdf）保留；都没有时用「照片/文件 + 时间」。
 */
export function defaultAttachmentName(fileName: string, isImage: boolean, entityName: string | undefined, fallback: string): string {
  const generic = isGenericFileName(fileName)
  if (entityName && (isImage || generic)) return entityName.slice(0, 120)
  if (!generic) return baseFileName(fileName).slice(0, 120)
  return fallback
}
