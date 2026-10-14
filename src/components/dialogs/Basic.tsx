import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { GROUP_EN, ITEM_ICONS, ITEM_ICON_GROUPS, ROOM_ICONS, ROOM_ICON_GROUPS, iconById, iconLabel, type IconDef, type IconKind } from '../../catalog.ts'
import { normalize, search, type Entity } from '../../core/index.ts'
import { hasKey, useI18n, useT, type UiKey } from '../../context/i18n.tsx'
import { useSnap } from '../../context/store.tsx'
import { EntityRow } from '../ui/EntityBits.tsx'
import { Icon } from '../ui/Icon.tsx'

// ───────────────────────── 数量 ─────────────────────────

interface QtyProps {
  open: boolean
  title: string
  label?: string
  initial?: number
  min?: number
  max?: number
  helper?: ReactNode
  confirmText?: string
  onSubmit: (n: number) => void
  onClose: () => void
}

/** 非负整数输入；P0 单位不可小数。 */
export function QtyDialog({ open, title, label, initial = 1, min = 0, max, helper, confirmText, onSubmit, onClose }: QtyProps) {
  const t = useT()
  const [v, setV] = useState(String(initial))
  useEffect(() => {
    if (open) setV(String(initial))
  }, [open, initial])
  const n = Number(v)
  const err = v.trim() === '' || !Number.isInteger(n) ? t('qty.mustInt') : n < min ? t('qty.min', { min }) : max !== undefined && n > max ? t('qty.max', { max }) : ''
  const step = (d: number) => setV(String(Math.max(min, Math.min(max ?? Infinity, (Number.isInteger(n) ? n : 0) + d))))
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!err) onSubmit(n)
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', pt: 1 }}>
            <IconButton aria-label="-1" onClick={() => step(-1)} sx={{ border: 1, borderColor: 'divider', mt: 0.5 }}>
              <Typography sx={{ fontSize: 22, lineHeight: 1 }}>−</Typography>
            </IconButton>
            <TextField
              autoFocus
              label={label ?? t('qty.label')}
              value={v}
              onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ''))}
              error={!!err}
              helperText={err || helper}
              slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*', 'aria-label': label ?? t('qty.label') } }}
            />
            <IconButton aria-label="+1" onClick={() => step(1)} sx={{ border: 1, borderColor: 'divider', mt: 0.5 }}>
              <Icon name="add" size={20} />
            </IconButton>
          </Stack>
          {max !== undefined && max > 1 && (
            <Button size="small" sx={{ mt: 1 }} onClick={() => setV(String(max))}>
              {t('qty.all', { max })}
            </Button>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!!err}>
            {confirmText ?? t('common.confirm')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

// ───────────────────────── 文本 ─────────────────────────

interface TextProps {
  open: boolean
  title: string
  label: string
  initial?: string
  multiline?: boolean
  required?: boolean
  helper?: ReactNode
  confirmText?: string
  onSubmit: (v: string) => void
  onClose: () => void
}

export function TextDialog({ open, title, label, initial = '', multiline, required = true, helper, confirmText, onSubmit, onClose }: TextProps) {
  const t = useT()
  const [v, setV] = useState(initial)
  useEffect(() => {
    if (open) setV(initial)
  }, [open, initial])
  const disabled = required && !v.trim()
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!disabled) onSubmit(v)
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label={label}
            value={v}
            multiline={multiline}
            minRows={multiline ? 3 : undefined}
            onChange={(e) => setV(e.target.value)}
            helperText={helper}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={disabled}>
            {confirmText ?? t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

// ───────────────────────── 图标 ─────────────────────────

interface IconPickerProps {
  open: boolean
  value: string | null | undefined
  /** 可选的图标集：物品只用 items；位置先房间、再物品（柜子、抽屉、收纳盒等） */
  sets?: Array<Extract<IconKind, 'items' | 'rooms'>>
  title?: string
  /** 提供时显示「拍照作封面」：在选图标时直接改用照片 */
  onPhoto?: () => void
  onPick: (iconKey: string | null) => void
  onClose: () => void
}

const SET_ICONS = { items: ITEM_ICONS, rooms: ROOM_ICONS }
const SET_GROUPS = { items: ITEM_ICON_GROUPS, rooms: ROOM_ICON_GROUPS }

/** 图标选择：名称/类别检索；分组不等于分类，也不会开启容器。 */
export function IconPicker({ open, value, sets = ['items'], title, onPhoto, onPick, onClose }: IconPickerProps) {
  const t = useT()
  const { lang } = useI18n()
  const valueSet = iconById(value)?.kind
  const initialSet = sets.find((k) => k === valueSet) ?? sets[0]
  const [set, setSet] = useState(initialSet)
  const [group, setGroup] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<string | null>(value ?? null)
  useEffect(() => {
    if (open) {
      setSel(value ?? null)
      setSet(initialSet)
      setGroup(null)
      setQuery('')
    }
  }, [open, value]) // eslint-disable-line react-hooks/exhaustive-deps
  const roomName = (key: string) => (hasKey(`room.${key}`) ? t(`room.${key}` as UiKey) : key)
  const label = (i: IconDef) => iconLabel(i, lang, roomName)
  const q = normalize(query)
  // 有搜索词时跨所有可选图标集查找
  const pool = q ? sets.flatMap((k) => SET_ICONS[k]) : SET_ICONS[set]
  const list = pool.filter((i) => (q || !group || i.group === group) && (!q || normalize(`${i.name}${i.key}${i.group}${label(i)}`).includes(q)))
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle sx={{ pb: sets.length > 1 ? 0 : undefined }}>{title ?? t('icon.pick')}</DialogTitle>
      {sets.length > 1 && (
        <Tabs
          value={set}
          onChange={(_, v: typeof set) => {
            setSet(v)
            setGroup(null)
          }}
          sx={{ px: 2 }}
        >
          {sets.map((k) => (
            <Tab key={k} value={k} label={t(`icon.set.${k}`)} />
          ))}
        </Tabs>
      )}
      <Box sx={{ px: 3, pb: 1, pt: sets.length > 1 ? 1 : 0 }}>
        <TextField
          size="small"
          placeholder={t('icon.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Icon name="search" size={18} /></InputAdornment> } }}
        />
        {!q && (
          <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
            <Chip label={t('common.all')} size="small" color={group ? 'default' : 'primary'} onClick={() => setGroup(null)} />
            {SET_GROUPS[set].map((g) => (
              <Chip key={g} size="small" label={lang === 'zh' ? g : (GROUP_EN[g] ?? g)} color={group === g ? 'primary' : 'default'} onClick={() => setGroup(g)} />
            ))}
          </Stack>
        )}
      </Box>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 1 }}>
          {list.map((i) => (
            <Box
              key={i.id}
              component="button"
              type="button"
              aria-pressed={sel === i.id}
              aria-label={label(i)}
              onClick={() => setSel(i.id)}
              sx={{
                all: 'unset',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 0.5,
                p: 1,
                minHeight: 44,
                borderRadius: 1,
                border: 2,
                borderColor: sel === i.id ? 'secondary.main' : 'transparent',
                color: sel === i.id ? 'secondary.main' : 'primary.main',
                bgcolor: sel === i.id ? 'paper.warn' : 'transparent',
                '&:focus-visible': { outline: '3px solid', outlineColor: 'warning.main' },
              }}
            >
              <Icon name={i.id} size={i.kind === 'rooms' ? 30 : 27} />
              <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center', lineHeight: 1.2 }}>
                {label(i)}
              </Typography>
            </Box>
          ))}
        </Box>
        {!list.length && <Typography color="text.secondary">{t('picker.noMatch')}</Typography>}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        {onPhoto && (
          <Button variant="outlined" startIcon={<Icon name="camera" size={16} />} onClick={onPhoto}>
            {t('cover.add')}
          </Button>
        )}
        <Button onClick={() => onPick(null)}>{t('icon.useDefault')}</Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => onPick(sel)}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ───────────────────────── 实体选择 ─────────────────────────

interface EntityPickerProps {
  open: boolean
  title: string
  filter?: (e: Entity) => boolean
  multiple?: boolean
  initial?: string[]
  onPick: (ids: string[]) => void
  onClose: () => void
  footer?: ReactNode
}

/** 搜索选择已有物品/位置（绑定标签、关联附件）。 */
export function EntityPicker({ open, title, filter, multiple, initial = [], onPick, onClose, footer }: EntityPickerProps) {
  const t = useT()
  const snap = useSnap()
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<string[]>(initial)
  useEffect(() => {
    if (open) {
      setSel(initial)
      setQuery('')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    const base = query.trim()
      ? search(snap, query, { limit: 80 }).map((h) => h.entity)
      : Object.values(snap.entities)
          .filter((e) => !e.deletedAt)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 40)
    return filter ? base.filter(filter) : base
  }, [snap, query, filter])
  const toggle = (id: string) => {
    if (!multiple) return onPick([id])
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle sx={{ pb: 1 }}>{title}</DialogTitle>
      <Box sx={{ px: 3, pb: 1 }}>
        <TextField
          size="small"
          autoFocus
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Icon name="search" size={18} /></InputAdornment> } }}
        />
        {!query && (
          <Typography variant="caption" color="text.secondary">
            {t('picker.recent')}
          </Typography>
        )}
      </Box>
      <DialogContent dividers sx={{ p: 0, minHeight: 240 }}>
        <List disablePadding>
          {list.map((e) => (
            <EntityRow
              key={e.id}
              snap={snap}
              entity={e}
              dense
              selected={sel.includes(e.id)}
              onClick={() => toggle(e.id)}
              trailing={multiple ? <Icon name={sel.includes(e.id) ? 'check' : 'add'} size={20} /> : undefined}
            />
          ))}
          {!list.length && <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>{t('picker.noMatch')}</Typography>}
        </List>
      </DialogContent>
      <DialogActions>
        {footer}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        {multiple && (
          <Button variant="contained" onClick={() => onPick(sel)}>
            {t('common.saveCount', { count: sel.length })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
