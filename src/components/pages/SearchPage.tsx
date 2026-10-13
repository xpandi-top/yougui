import { Box, Button, Chip, IconButton, InputAdornment, List, Stack, TextField, Typography } from '@mui/material'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { search, type Entity } from '../../core/index.ts'
import { useT } from '../../context/i18n.tsx'
import { useSnap } from '../../context/store.tsx'
import { goBack, navigate, q, useRoute } from '../../hooks/useRoute.ts'
import { EntityRow } from '../ui/EntityBits.tsx'
import { Icon } from '../ui/Icon.tsx'
import { Card, EmptyState } from '../ui/Layout.tsx'
import { ItemQuickActions } from './EntityPage.tsx'

type KindFilter = 'all' | 'item' | 'location'

export function SearchPage() {
  const t = useT()
  const snap = useSnap()
  const { query: params } = useRoute()
  const [text, setText] = useState(params.get('q') ?? '')
  const [scope, setScope] = useState<string | null>(params.get('scope'))
  const [kind, setKind] = useState<KindFilter>('all')
  const deferred = useDeferredValue(text)
  // 外部改了 URL（如从其他页面跳来带 ?q=）时同步输入框；自己输入写回的 URL 不触发
  const urlQ = params.get('q') ?? ''
  const urlScope = params.get('scope')
  const written = useRef(urlQ)
  useEffect(() => {
    if (urlQ !== written.current) {
      written.current = urlQ
      setText(urlQ)
    }
    setScope(urlScope)
  }, [urlQ, urlScope])
  const scopeEntity = scope ? snap.entities[scope] : null

  const hits = useMemo(
    () => search(snap, deferred, { scopeId: scope, kinds: kind === 'all' ? undefined : [kind as Entity['kind']] }),
    [snap, deferred, scope, kind],
  )

  const sync = (v: string) => {
    written.current = v
    setText(v)
    navigate(`/search${q({ q: v, scope })}`, { replace: true })
  }

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, px: 1, pt: 'calc(env(safe-area-inset-top) + 8px)', pb: 1, position: 'sticky', top: 0, bgcolor: 'background.default', zIndex: 5, borderBottom: 1, borderColor: 'divider' }}>
        <IconButton aria-label={t('common.back')} onClick={() => goBack('/')}>
          <Icon name="back" />
        </IconButton>
        <TextField
          autoFocus
          size="small"
          value={text}
          onChange={(e) => sync(e.target.value)}
          placeholder={t('search.placeholder')}
          slotProps={{
            htmlInput: { 'aria-label': t('search.placeholder'), enterKeyHint: 'search', autoCapitalize: 'off' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Icon name="search" size={18} />
                </InputAdornment>
              ),
              endAdornment: text ? (
                <IconButton size="small" aria-label={t('search.clear')} onClick={() => sync('')}>
                  <Icon name="close" size={16} />
                </IconButton>
              ) : undefined,
            },
          }}
        />
      </Stack>
      <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', px: 2, py: 1.25 }}>
        {(['all', 'item', 'location'] as const).map((k) => (
          <Chip key={k} size="small" label={t(`search.kind.${k}`)} color={kind === k ? 'primary' : 'default'} onClick={() => setKind(k)} />
        ))}
        {scopeEntity && <Chip size="small" color="secondary" variant="outlined" label={t('search.scope', { name: scopeEntity.name })} onDelete={() => setScope(null)} />}
      </Stack>

      {!text.trim() ? (
        <EmptyState icon="search" title={t('search.hintTitle')} body={t('search.hintBody')} />
      ) : hits.length ? (
        <Box sx={{ px: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {t('search.count', { count: hits.length })}
          </Typography>
          <Card>
            <List disablePadding>
              {hits.map((h) => (
                <Box key={h.entity.id} sx={{ borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                  <EntityRow snap={snap} entity={h.entity} />
                  {h.entity.kind === 'item' && (
                    <Box sx={{ px: 2, pb: 1, pl: 9 }}>
                      <ItemQuickActions entity={h.entity} />
                    </Box>
                  )}
                </Box>
              ))}
            </List>
          </Card>
        </Box>
      ) : (
        <EmptyState
          icon="search"
          title={t('search.emptyTitle', { q: text })}
          body={scopeEntity ? t('search.emptyScoped') : t('search.emptyBody')}
          action={
            <Stack direction="row" spacing={1}>
              {(scopeEntity || kind !== 'all') && (
                <Button
                  onClick={() => {
                    setScope(null)
                    setKind('all')
                  }}
                >
                  {t('search.clearFilters')}
                </Button>
              )}
              <Button variant="contained" onClick={() => navigate(`/add${q({ name: text.trim(), parent: scope })}`)}>
                {t('search.createNamed', { name: text.trim() })}
              </Button>
            </Stack>
          }
        />
      )}
    </Box>
  )
}
