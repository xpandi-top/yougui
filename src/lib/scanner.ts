// 摄像头扫码：HTTPS + 用户授权下 getUserMedia；优先原生 BarcodeDetector，否则按需加载 ZXing（独立 chunk）。
// 识别结果去抖：同一码在镜头内持续出现只触发一次，离开 1.5 秒后重新进入才再次触发。

export type CameraErrorCode = 'insecure' | 'unsupported' | 'denied' | 'notFound' | 'busy' | 'other'

export class CameraError extends Error {
  readonly code: CameraErrorCode
  constructor(code: CameraErrorCode, message: string = code) {
    super(message)
    this.code = code
  }
}

interface Decoder {
  name: 'native' | 'zxing'
  decode(video: HTMLVideoElement): Promise<string[]>
}

const WANTED = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e']

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}
interface NativeDetectorCtor {
  new (opts: { formats: string[] }): NativeDetector
  getSupportedFormats(): Promise<string[]>
}

async function nativeDecoder(): Promise<Decoder | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector
  if (!Ctor) return null
  try {
    const supported = await Ctor.getSupportedFormats()
    const formats = WANTED.filter((f) => supported.includes(f))
    if (!formats.includes('qr_code') || !formats.includes('ean_13')) return null
    const det = new Ctor({ formats })
    return { name: 'native', decode: async (video) => (await det.detect(video)).map((r) => r.rawValue) }
  } catch {
    return null
  }
}

async function zxingDecoder(): Promise<Decoder> {
  const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])
  const hints = new Map<unknown, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
    [DecodeHintType.TRY_HARDER, true],
  ])
  const reader = new BrowserMultiFormatReader(hints as never)
  const canvas = document.createElement('canvas')
  return {
    name: 'zxing',
    decode: async (video) => {
      const w = video.videoWidth
      const h = video.videoHeight
      if (!w || !h) return []
      const scale = Math.min(1, 960 / Math.max(w, h))
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      canvas.getContext('2d', { willReadFrequently: true })?.drawImage(video, 0, 0, canvas.width, canvas.height)
      try {
        return [reader.decodeFromCanvas(canvas).getText()]
      } catch {
        return []
      }
    },
  }
}

let decoderPromise: Promise<Decoder> | null = null
function getDecoder(): Promise<Decoder> {
  decoderPromise ??= nativeDecoder().then((d) => d ?? zxingDecoder())
  return decoderPromise
}

export interface ScannerHandle {
  stop(): void
  setPaused(paused: boolean): void
  decoderName: 'native' | 'zxing'
}

export const DEBOUNCE_MS = 1500

export async function startScanner(video: HTMLVideoElement, onCode: (text: string) => void): Promise<ScannerHandle> {
  if (!window.isSecureContext) throw new CameraError('insecure')
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    })
  } catch (err) {
    const name = (err as DOMException)?.name
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraError('denied')
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraError('notFound')
    if (name === 'NotReadableError' || name === 'AbortError') throw new CameraError('busy')
    throw new CameraError('other', String(err))
  }
  video.setAttribute('playsinline', 'true')
  video.muted = true
  video.srcObject = stream
  try {
    await video.play()
  } catch {
    /* iOS 偶发：用户手势后会继续播放 */
  }
  const decoder = await getDecoder()
  let stopped = false
  let paused = false
  let timer: number | undefined
  const seen = new Map<string, number>()

  const tick = async () => {
    if (stopped) return
    if (!paused && video.readyState >= 2) {
      try {
        const codes = await decoder.decode(video)
        const now = performance.now()
        for (const c of codes) {
          const last = seen.get(c)
          seen.set(c, now)
          if (last === undefined || now - last > DEBOUNCE_MS) onCode(c)
        }
      } catch {
        /* 单帧失败忽略 */
      }
    }
    if (!stopped) timer = window.setTimeout(tick, decoder.name === 'native' ? 120 : 220)
  }
  void tick()

  return {
    decoderName: decoder.name,
    setPaused(p) {
      paused = p
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      for (const t of stream.getTracks()) t.stop()
      video.srcObject = null
    },
  }
}

/** 可选提示音（视觉反馈始终存在，不依赖振动）。 */
export function beep(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = 880
    g.gain.value = 0.08
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.09)
    o.onended = () => void ctx.close()
  } catch {
    /* ignore */
  }
}
