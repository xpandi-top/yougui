import type { Operation } from '../../core/index.ts'
import { hasKey, type TFn, type UiKey } from '../../context/i18n.tsx'

/**
 * 日志一行描述：「移动 HDMI 线：书房 → 车库」。
 * 变体：有数量时用 op.<type>Qty，只有计数没有对象名时用 op.<type>Many。
 */
export function describeOp(t: TFn, op: Operation): string {
  const s = op.summary
  const vars = {
    name: s.entityName ?? '',
    from: s.fromName ?? t('path.unassigned'),
    to: s.toName ?? t('path.unassigned'),
    qty: s.qty ?? '',
    before: s.qtyBefore ?? t('qty.untracked'),
    after: s.qtyAfter ?? t('qty.untracked'),
    count: s.count ?? 0,
    text: s.text ?? '',
    opname: s.text && hasKey(`scan.op.${s.text}`) ? t(`scan.op.${s.text}` as UiKey) : '',
  }
  if (op.type === 'undo') {
    const inner = s.text && hasKey(`op.${s.text}`) ? t(`op.${s.text}` as UiKey, vars) : ''
    return t('op.undo', { what: inner })
  }
  let key = `op.${op.type}`
  if (s.qty !== null && s.qty !== undefined && hasKey(`${key}Qty`)) key = `${key}Qty`
  else if (!s.entityName && s.count !== undefined && hasKey(`${key}Many`)) key = `${key}Many`
  return hasKey(key) ? t(key, vars) : op.type
}

export function formatTime(ts: number, lang: 'zh' | 'en'): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const loc = lang === 'zh' ? 'zh-CN' : 'en'
  return sameDay
    ? d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(loc, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
