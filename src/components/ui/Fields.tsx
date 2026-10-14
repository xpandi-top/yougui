import { Autocomplete, Box, Chip, Stack, TextField, type SxProps, type Theme } from '@mui/material'
import { useMemo } from 'react'
import { daysUntil, expiryStatus, type Entity } from '../../core/index.ts'
import { useT, type TFn } from '../../context/i18n.tsx'
import { useSnap } from '../../context/store.tsx'
import { addToToday, todayLocal } from '../../lib/dates.ts'

/** 分类：从已有分类里选，也可直接输入新分类（按使用次数排序）。 */
export function CategoryField({ value, onChange, size }: { value: string; onChange: (v: string) => void; size?: 'small' | 'medium' }) {
  const t = useT()
  const snap = useSnap()
  const options = useMemo(() => {
    const count = new Map<string, number>()
    for (const e of Object.values(snap.entities)) {
      if (e.deletedAt || !e.category) continue
      count.set(e.category, (count.get(e.category) ?? 0) + 1)
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN')).map(([c]) => c)
  }, [snap.entities])
  return (
    <Autocomplete
      freeSolo
      options={options}
      value={value}
      inputValue={value}
      onInputChange={(_, v) => onChange(v)}
      onChange={(_, v) => onChange(typeof v === 'string' ? v : '')}
      renderInput={(params) => <TextField {...params} size={size} label={t('field.category')} helperText={options.length ? t('field.categoryHelp') : undefined} />}
    />
  )
}

const QUICK: Array<{ key: 'w1' | 'm1' | 'm3' | 'm6' | 'y1' | 'y2'; days: number; months: number }> = [
  { key: 'w1', days: 7, months: 0 },
  { key: 'm1', days: 0, months: 1 },
  { key: 'm3', days: 0, months: 3 },
  { key: 'm6', days: 0, months: 6 },
  { key: 'y1', days: 0, months: 12 },
  { key: 'y2', days: 0, months: 24 },
]

/** 有效期：日期选择 + 常用时长快捷按钮。空 = 不设。 */
export function ExpiryField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT()
  return (
    <Box>
      <TextField
        type="date"
        label={t('expiry.label')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        helperText={value ? expiryText(t, value) : t('expiry.help')}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
        {QUICK.map((q) => (
          <Chip key={q.key} size="small" variant="outlined" label={t(`expiry.quick.${q.key}`)} onClick={() => onChange(addToToday(q.days, q.months))} />
        ))}
        {value && <Chip size="small" label={t('expiry.clear')} onClick={() => onChange('')} />}
      </Stack>
    </Box>
  )
}

/** 「还剩 19 天」「今天到期」「已过期 3 天」 */
export function expiryText(t: TFn, expiresAt: string): string {
  const d = daysUntil(expiresAt, todayLocal())
  if (d < 0) return t('expiry.expiredDays', { days: -d })
  if (d === 0) return t('expiry.today')
  return t('expiry.leftDays', { days: d })
}

/** 列表里的临期标记：只在已过期 / 今天 / 30 天内显示。 */
export function ExpiryChip({ entity, always, sx }: { entity: Entity; always?: boolean; sx?: SxProps<Theme> }) {
  const t = useT()
  const s = expiryStatus(entity, todayLocal())
  if (!s || (s === 'ok' && !always)) return null
  const color = s === 'expired' ? 'error' : s === 'ok' ? 'default' : 'warning'
  return (
    <Chip
      size="small"
      color={color}
      variant={s === 'expired' ? 'filled' : 'outlined'}
      label={expiryText(t, entity.expiresAt!)}
      sx={[{ height: 20, fontSize: 11 }, ...(Array.isArray(sx) ? sx : [sx])]}
    />
  )
}
