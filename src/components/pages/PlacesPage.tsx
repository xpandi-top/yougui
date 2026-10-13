import { Box, Button, Collapse, IconButton, List, ListItemButton, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { childrenOf, countItems, createEntity, rooms, unassigned, type Entity, type Snapshot } from '../../core/index.ts'
import { useT } from '../../context/i18n.tsx'
import { useSnap } from '../../context/store.tsx'
import { useCommit } from '../../hooks/useCommit.ts'
import { navigate } from '../../hooks/useRoute.ts'
import { NewPlaceDialog } from '../dialogs/NewPlaceDialog.tsx'
import { EntityAvatar } from '../ui/EntityBits.tsx'
import { Icon } from '../ui/Icon.tsx'
import { Card, EmptyState, Page, PageHeader } from '../ui/Layout.tsx'

function holders(snap: Snapshot, id: string): Entity[] {
  return childrenOf(snap, id).filter((e) => e.kind === 'location' || e.canContain)
}

function TreeNode({ snap, entity, depth }: { snap: Snapshot; entity: Entity; depth: number }) {
  const t = useT()
  const kids = holders(snap, entity.id)
  const [open, setOpen] = useState(depth === 0 && kids.length <= 6)
  return (
    <>
      <ListItemButton onClick={() => navigate(`/e/${entity.id}`)} sx={{ pl: 1 + depth * 2.25, gap: 1.25, py: 0.75 }}>
        <EntityAvatar entity={entity} size={depth === 0 ? 40 : 34} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: depth === 0 ? 700 : 500, wordBreak: 'break-word' }}>{entity.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('home.roomCount', { count: countItems(snap, entity.id) })}
          </Typography>
        </Box>
        {kids.length > 0 && (
          <IconButton
            aria-label={open ? t('places.collapse') : t('places.expand')}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation()
              setOpen((o) => !o)
            }}
          >
            <Icon name="next" size={18} sx={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
          </IconButton>
        )}
      </ListItemButton>
      {kids.length > 0 && (
        <Collapse in={open} unmountOnExit>
          {kids.map((k) => (
            <TreeNode key={k.id} snap={snap} entity={k} depth={depth + 1} />
          ))}
        </Collapse>
      )}
    </>
  )
}

export function PlacesPage() {
  const t = useT()
  const snap = useSnap()
  const { commit } = useCommit()
  const [adding, setAdding] = useState(false)
  const list = rooms(snap)
  const loose = unassigned(snap)

  return (
    <>
      <PageHeader
        title={t('nav.places')}
        actions={
          <Button startIcon={<Icon name="add" size={18} />} onClick={() => setAdding(true)}>
            {t('places.addRoom')}
          </Button>
        }
      />
      <Page>
        {list.length ? (
          <Card>
            <List disablePadding>
              {list.map((r) => (
                <TreeNode key={r.id} snap={snap} entity={r} depth={0} />
              ))}
            </List>
          </Card>
        ) : (
          <EmptyState icon="room" title={t('places.empty')} action={<Button variant="contained" onClick={() => setAdding(true)}>{t('places.addRoom')}</Button>} />
        )}
        <Stack direction="row" spacing={1}>
          <Button fullWidth variant="outlined" onClick={() => navigate('/items?f=unassigned')}>
            {t('places.unassigned', { count: loose.length })}
          </Button>
          <Button fullWidth variant="outlined" onClick={() => navigate('/items?f=out')}>
            {t('places.withdrawn')}
          </Button>
        </Stack>
      </Page>
      <NewPlaceDialog
        open={adding}
        title={t('places.addRoom')}
        label={t('places.roomName')}
        onClose={() => setAdding(false)}
        onSubmit={async (name, iconKey) => {
          const r = await commit<Entity>('create', (e: Entity) => ({ entityId: e.id, entityName: e.name }), (tx) => createEntity(tx, { kind: 'location', name, iconKey }), {
            success: (e) => t('toast.created', { name: e.name }),
          })
          if (r.ok) setAdding(false)
        }}
      />
    </>
  )
}
