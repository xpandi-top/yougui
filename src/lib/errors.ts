// 错误捕获：内存中保留最近 5 条，反馈与设置页展示。
export interface CapturedError {
  at: number
  message: string
}

const recent: CapturedError[] = []

export function recordError(err: unknown): void {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  recent.unshift({ at: Date.now(), message: message.slice(0, 500) })
  recent.length = Math.min(recent.length, 5)
}

export function recentErrors(): CapturedError[] {
  return [...recent]
}

export function captureErrors(): void {
  window.addEventListener('error', (e) => recordError(e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => recordError(e.reason))
}
