import {
  Box,
  Breadcrumbs,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  Link,
  List,
  ListItemButton,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { ancestors, checkMove, childrenOf, pathNames, PATH_SEP, searchHolders, type Entity } from '../../core/index.ts'
import { useT } from '../../context/i18n.tsx'
import { useSnap } from '../../context/store.tsx'
import { EntityAvatar } from '../ui/EntityBits.tsx'
import { Icon } from '../ui/Icon.tsx'

interface Props {
  open: boolean
  title: string
  /** 正在移动的实体：自身与后代不可选，非法目标置灰 */
  movingId?: string
  /** 只允许位置（创建子位置/移动位置） */
  locationsOnly?: boolean
  /** 显示「未分配 / 设为房间」根选项 */
  allowRoot?: boolean
  initialId?: string | null
  onPick: (id: string | null) => void
  onClose: () => void
}

/** 选择放置目标：逐层浏览 + 完整路径搜索。 */
export function PlacePicker({ open, title, movingId, locationsOnly, allowRoot = true, initialId = null, onPick, onClose }: Props) {
  const t = useT()
  const snap = useSnap()
  const [cur, setCur] = useState<string | null>(initialId)
  const [query, setQuery] = useState('')

  const holders = (list: Entity[]) => list.filter((e) => (locationsOnly ? e.kind === 'location' : e.kind === 'location' || e.canContain))
  const valid = (id: string | null) => !movingId || checkMove(snap, movingId, id).ok
  /** 自身/后代/非容器等非法目标置灰；「已在此处」仍可浏览进入 */
  const blocked = (id: string) => {
    if (!movingId) return false
    const r = checkMove(snap, movingId, id)
    return !r.ok && r.code !== 'move.same'
  }

  const list = useMemo(() => {
    if (query.trim()) return holders(searchHolders(snap, query))
    return holders(childrenOf(snap, cur))
  }, [snap, cur, query, locationsOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  const crumbs = cur ? [...ancestors(snap.entities, cur), snap.entities[cur]].filter(Boolean) : []
  const curEntity = cur ? snap.entities[cur] : null

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle sx={{ pb: 1 }}>{title}</DialogTitle>
      <Box sx={{ px: 3, pb: 1 }}>
        <TextField
          size="small"
          placeholder={t('picker.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Icon name="search" size={18} /></InputAdornment> } }}
        />
        {!query && (
          <Breadcrumbs sx={{ mt: 1, fontSize: 14 }} separator="›">
            <Link component="button" underline="hover" onClick={() => setCur(null)} sx={{ fontWeight: cur ? 400 : 700 }}>
              {t('picker.home')}
            </Link>
            {crumbs.map((c) => (
              <Link key={c.id} component="button" underline="hover" onClick={() => setCur(c.id)} sx={{ fontWeight: c.id === cur ? 700 : 400 }}>
                {c.name}
              </Link>
            ))}
          </Breadcrumbs>
        )}
      </Box>
      <DialogContent dividers sx={{ p: 0, minHeight: 240 }}>
        <List disablePadding>
          {list.map((e) => {
            const disabled = blocked(e.id)
            const hasKids = holders(childrenOf(snap, e.id)).length > 0
            return (
              <ListItemButton
                key={e.id}
                disabled={disabled}
                onClick={() => {
                  if (query) {
                    if (valid(e.id)) onPick(e.id)
                  } else {
                    setCur(e.id)
                  }
                }}
                sx={{ gap: 1.5 }}
              >
                <EntityAvatar entity={e} size={34} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }}>{e.name}</Typography>
                  {query && (
                    <Typography variant="caption" color="text.secondary">
                      {pathNames(snap.entities, e.id).join(PATH_SEP) || t('path.room')}
                    </Typography>
                  )}
                </Box>
                {!query && hasKids && <Icon name="next" size={18} />}
              </ListItemButton>
            )
          })}
          {!list.length && (
            <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
              {query ? t('picker.noMatch') : t('picker.noChildren')}
            </Typography>
          )}
        </List>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Box sx={{ flex: 1 }} />
        {cur === null && allowRoot && !query && (
          <Button variant="outlined" disabled={!valid(null)} onClick={() => onPick(null)}>
            {locationsOnly ? t('picker.asRoom') : t('picker.unassigned')}
          </Button>
        )}
        {curEntity && !query && (
          <Button variant="contained" disabled={!valid(curEntity.id)} onClick={() => onPick(curEntity.id)}>
            {t('picker.chooseHere', { name: curEntity.name })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
