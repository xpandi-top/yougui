import { Box, Chip, ListItemButton, Stack, Typography, type SxProps, type Theme } from '@mui/material'
import type { ReactNode } from 'react'
import { DEFAULT_ITEM_ICON, LOCATION_ICON, iconById } from '../../catalog.ts'
import { isEffectivelyOut, pathNames, PATH_SEP, type Entity, type Snapshot } from '../../core/index.ts'
import { useT } from '../../context/i18n.tsx'
import { useFileUrl } from '../../hooks/useFileUrl.ts'
import { navigate } from '../../hooks/useRoute.ts'
import { ExpiryChip } from './Fields.tsx'
import { Icon } from './Icon.tsx'

/** 物品显示优先级：有效封面照片 → 自选图标 → 默认收纳盒（位置用房间图标）。 */
export function EntityAvatar({ entity, size = 44 }: { entity: Entity; size?: number }) {
  const { url } = useFileUrl(entity.coverId)
  const icon = iconById(entity.iconKey)?.id ?? (entity.kind === 'location' ? LOCATION_ICON : DEFAULT_ITEM_ICON)
  return (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        bgcolor: entity.kind === 'location' ? 'paper.soft' : 'background.paper',
        color: entity.canContain && entity.kind === 'item' ? 'secondary.main' : 'primary.main',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
      }}
    >
      {url ? (
        <Box component="img" src={url} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Icon name={icon} size={Math.round(size * 0.6)} />
      )}
    </Box>
  )
}

export function QtyText({ entity }: { entity: Entity }) {
  const t = useT()
  if (entity.kind === 'location') return null
  if (entity.quantity === null) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
        {t('qty.untracked')}
      </Typography>
    )
  }
  return (
    <Typography
      variant="body2"
      sx={{ fontWeight: 600, whiteSpace: 'nowrap', color: entity.quantity === 0 ? 'warning.main' : 'text.primary' }}
    >
      {entity.quantity}
      {entity.unit ? ` ${entity.unit}` : ''}
    </Typography>
  )
}

/** 完整路径：长路径换行，不截断重要位置。 */
export function PathLine({ snap, entity, sx }: { snap: Snapshot; entity: Entity; sx?: SxProps<Theme> }) {
  const t = useT()
  const names = pathNames(snap.entities, entity.id)
  const out = entity.kind === 'item' && isEffectivelyOut(snap.entities, entity.id)
  let text: string
  if (!names.length) text = entity.kind === 'location' ? t('path.room') : t('path.unassigned')
  else text = names.join(PATH_SEP)
  return (
    <Typography variant="caption" color="text.secondary" sx={[{ display: 'block', wordBreak: 'break-word', lineHeight: 1.4 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {out ? `${t('state.out')} · ${t('path.was', { path: text })}` : text}
    </Typography>
  )
}

export function StateChips({ entity }: { entity: Entity }) {
  const t = useT()
  return (
    <>
      {entity.kind === 'item' && entity.canContain && <Chip size="small" variant="outlined" label={t('entity.container')} sx={{ height: 20, fontSize: 11 }} />}
      {entity.state === 'out' && <Chip size="small" color="warning" variant="outlined" label={t('state.out')} sx={{ height: 20, fontSize: 11 }} />}
      {entity.state === 'in' && entity.quantity !== 0 && <ExpiryChip entity={entity} />}
    </>
  )
}

interface RowProps {
  snap: Snapshot
  entity: Entity
  showPath?: boolean
  onClick?: () => void
  trailing?: ReactNode
  dense?: boolean
  selected?: boolean
  disabled?: boolean
}

export function EntityRow({ snap, entity, showPath = true, onClick, trailing, dense, selected, disabled }: RowProps) {
  return (
    <ListItemButton
      onClick={onClick ?? (() => navigate(`/e/${entity.id}`))}
      selected={selected}
      disabled={disabled}
      sx={{ gap: 1.5, py: dense ? 0.75 : 1.25, px: 2, alignItems: 'center' }}
    >
      <EntityAvatar entity={entity} size={dense ? 36 : 44} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 600, wordBreak: 'break-word' }}>{entity.name}</Typography>
          <StateChips entity={entity} />
        </Stack>
        {showPath && <PathLine snap={snap} entity={entity} />}
      </Box>
      {trailing ?? <QtyText entity={entity} />}
    </ListItemButton>
  )
}
