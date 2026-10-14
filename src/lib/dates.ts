import { localDate } from '../core/index.ts'

/** 本地时区今天 YYYY-MM-DD */
export function todayLocal(): string {
  return localDate(Date.now(), new Date().getTimezoneOffset())
}

/** 今天往后加 n 天 / n 个月（月末自动收敛） */
export function addToToday(days: number, months = 0): string {
  const d = new Date()
  if (months) {
    const day = d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + months)
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    d.setDate(Math.min(day, last))
  }
  d.setDate(d.getDate() + days)
  return localDate(d.getTime(), d.getTimezoneOffset())
}

export function formatDateTime(ts: number, lang: 'zh' | 'en'): string {
  return new Date(ts).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
