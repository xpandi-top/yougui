import { Box, Button, Chip, List, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { compareEntities, isEffectivelyOut, type Entity } from '../../core/index.ts'
import { useT } from '../../context/i18n.tsx'
import { useSnap } from '../../context/store.tsx'
import { navigate, q, useRoute } from '../../hooks/useRoute.ts'
import { EntityRow } from '../ui/EntityBits.tsx'
import { Icon } from '../ui/Icon.tsx'
import { Card, EmptyState, Page, PageHeader } from '../ui/Layout.tsx'

const FILTERS = ['all', 'unassigned', 'out', 'tracked', 'empty', 'containers'] as const
type Filter = (typeof FILTERS)[number]

const PAGE = 100

export function ItemsPage() {
  const t = useT()
  const snap = useSnap()
  const { query } = useRoute()
  const f = (FILTERS as readonly string[]).includes(query.get('f') ?? '') ? (query.get('f') as Filter) : 'all'
  const [sort, setSort] = useState<'recent' | 'name'>('recent')
  const [limit, setLimit] = useState(PAGE)

  const list = useMemo(() => {
    const items = Object.values(snap.entities).filter((e) => !e.deletedAt && e.kind === 'item')
    const pred: Record<Filter, (e: Entity) => boolean> = {
      all: () => true,
      unassigned: (e) => e.parentId === null && e.state === 'in',
      out: (e) => isEffectivelyOut(snap.entities, e.id),
      tracked: (e) => e.quantity !== null,
      empty: (e) => e.quantity === 0,
      containers: (e) => e.canContain,
    }
    const out = items.filter(pred[f])
    return sort === 'name' ? out.sort(compareEntities) : out.sort((a, b) => b.updatedAt - a.updatedAt)
  }, [snap, f, sort])

  return (
    <>
      <PageHeader
        title={t('nav.items')}
        actions={
          <Button startIcon={<Icon name="add" size={18} />} onClick={() => navigate('/add')}>
            {t('common.add')}
          </Button>
        }
      />
      <Page>
        <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap' }}>
          {FILTERS.map((k) => (
            <Chip key={k} label={t(`items.f.${k}`)} color={f === k ? 'primary' : 'default'} onClick={() => navigate(`/items${q({ f: k === 'all' ? null : k })}`, { replace: true })} />
          ))}
        </Stack>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">
            {t('items.count', { count: list.length })}
          </Typography>
          <ToggleButtonGroup size="small" exclusive value={sort} onChange={(_, v) => v && setSort(v)}>
            <ToggleButton value="recent" sx={{ py: 0.25 }}>
              {t('items.sortRecent')}
            </ToggleButton>
            <ToggleButton value="name" sx={{ py: 0.25 }}>
              {t('items.sortName')}
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        {list.length ? (
          <Card>
            <List disablePadding>
              {list.slice(0, limit).map((e) => (
                <Box key={e.id} sx={{ borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                  <EntityRow snap={snap} entity={e} />
                </Box>
              ))}
            </List>
          </Card>
        ) : (
          <EmptyState
            icon="items"
            title={f === 'all' ? t('items.emptyAll') : t('items.emptyFilter')}
            action={
              <Button variant="contained" onClick={() => navigate('/add')}>
                {t('home.addItem')}
              </Button>
            }
          />
        )}
        {list.length > limit && (
          <Button onClick={() => setLimit((l) => l + PAGE)}>{t('items.more', { count: list.length - limit })}</Button>
        )}
      </Page>
    </>
  )
}
