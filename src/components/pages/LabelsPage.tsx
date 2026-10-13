import { Box, Button, Chip, List, ListItemButton, ListItemText, Stack, TextField, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { createLabels, formatLabelCode, LABEL_BATCH_MAX, type Label, type LabelStatus } from '../../core/index.ts'
import { useI18n, useT } from '../../context/i18n.tsx'
import { useSnap } from '../../context/store.tsx'
import { useCommit } from '../../hooks/useCommit.ts'
import { navigate, q } from '../../hooks/useRoute.ts'
import { newId } from '../../lib/store.ts'
import { Icon } from '../ui/Icon.tsx'
import { Card, EmptyState, Page, PageHeader, Section } from '../ui/Layout.tsx'
import { formatTime } from '../ui/opText.ts'
import { newLabelGen } from './EntityPage.tsx'

export function statusColor(s: LabelStatus): 'default' | 'success' | 'warning' {
  return s === 'bound' ? 'success' : s === 'disabled' ? 'warning' : 'default'
}

export default function LabelsPage() {
  const t = useT()
  const { lang } = useI18n()
  const snap = useSnap()
  const { commit } = useCommit()
  const [count, setCount] = useState('12')
  const [filter, setFilter] = useState<LabelStatus | 'all'>('all')
  const n = Number(count)
  const countErr = !Number.isInteger(n) || n < 1 || n > LABEL_BATCH_MAX

  const labels = useMemo(() => Object.values(snap.labels).filter((l) => !l.deletedAt).sort((a, b) => b.createdAt - a.createdAt), [snap])
  const batches = useMemo(() => {
    const m = new Map<string, Label[]>()
    for (const l of labels) {
      const k = l.batchId ?? 'none'
      if (!k.startsWith('single-')) m.set(k, [...(m.get(k) ?? []), l])
    }
    return [...m.entries()].slice(0, 10)
  }, [labels])
  const shown = labels.filter((l) => filter === 'all' || l.status === filter)

  async function generate() {
    const batchId = newId()
    const r = await commit('labelCreate', { count: n }, (tx) => createLabels(tx, n, newLabelGen(), batchId), {
      success: t('labels.generated', { count: n }),
    })
    if (r.ok) navigate(`/print${q({ batch: batchId })}`)
  }

  return (
    <>
      <PageHeader title={t('more.labels')} back="/more" />
      <Page>
        <Section title={t('labels.generate')}>
          <Card sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('labels.generateHelp')}
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                label={t('labels.count')}
                value={count}
                onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ''))}
                error={countErr}
                helperText={countErr ? t('err.label.count', { max: LABEL_BATCH_MAX }) : ' '}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                sx={{ maxWidth: 140 }}
              />
              <Button variant="contained" color="secondary" disabled={countErr} onClick={() => void generate()} sx={{ alignSelf: 'flex-start' }}>
                {t('labels.generateBtn')}
              </Button>
            </Stack>
          </Card>
        </Section>

        {batches.length > 0 && (
          <Section title={t('labels.batches')}>
            <Card>
              <List disablePadding>
                {batches.map(([id, ls]) => {
                  const bound = ls.filter((l) => l.status === 'bound').length
                  return (
                    <ListItemButton key={id} divider onClick={() => navigate(`/print${q({ batch: id })}`)}>
                      <ListItemText
                        primary={t('labels.batchLine', { count: ls.length, bound })}
                        secondary={formatTime(Math.min(...ls.map((l) => l.createdAt)), lang)}
                      />
                      <Icon name="print" size={20} />
                    </ListItemButton>
                  )
                })}
              </List>
            </Card>
          </Section>
        )}

        <Section title={t('labels.all')}>
          <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
            {(['all', 'blank', 'bound', 'disabled'] as const).map((k) => (
              <Chip key={k} size="small" label={t(`labels.f.${k}`)} color={filter === k ? 'primary' : 'default'} onClick={() => setFilter(k)} />
            ))}
            {filter === 'blank' && shown.length > 0 && (
              <Button size="small" startIcon={<Icon name="print" size={16} />} onClick={() => navigate(`/print${q({ status: 'blank' })}`)}>
                {t('labels.printBlank')}
              </Button>
            )}
          </Stack>
          {shown.length ? (
            <Card>
              <List disablePadding>
                {shown.slice(0, 200).map((l) => {
                  const e = l.entityId ? snap.entities[l.entityId] : null
                  return (
                    <ListItemButton key={l.id} divider onClick={() => navigate(`/label/${l.id}`)}>
                      <Box sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 700, mr: 2, letterSpacing: '0.08em' }}>{formatLabelCode(l.code)}</Box>
                      <ListItemText primary={e && !e.deletedAt ? e.name : '—'} />
                      <Chip size="small" variant="outlined" color={statusColor(l.status)} label={t(`labels.f.${l.status}`)} />
                    </ListItemButton>
                  )
                })}
              </List>
            </Card>
          ) : (
            <EmptyState icon="qr" title={t('labels.empty')} />
          )}
        </Section>
      </Page>
    </>
  )
}
