import { Button, Chip, List, ListItem, ListItemText, Stack } from '@mui/material'
import { useState } from 'react'
import { useI18n, useT } from '../../context/i18n.tsx'
import { useAppState } from '../../context/store.tsx'
import { useCommit } from '../../hooks/useCommit.ts'
import { navigate } from '../../hooks/useRoute.ts'
import { Card, EmptyState, Page, PageHeader } from '../ui/Layout.tsx'
import { describeOp, formatTime } from '../ui/opText.ts'

const PAGE = 100

/** 操作日志：不可静默覆盖；撤销以反向操作记录。 */
export default function LogPage() {
  const t = useT()
  const { lang } = useI18n()
  const { ops, snap } = useAppState()
  const { undo } = useCommit()
  const [limit, setLimit] = useState(PAGE)
  return (
    <>
      <PageHeader title={t('more.log')} back="/more" />
      <Page>
        {ops.length ? (
          <Card>
            <List disablePadding>
              {ops.slice(0, limit).map((op) => {
                const canUndo = !op.undoneBy && op.type !== 'undo' && op.type !== 'import'
                const target = op.summary.entityId ? snap.entities[op.summary.entityId] : undefined
                return (
                  <ListItem key={op.id} divider sx={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
                    <ListItemText
                      primary={describeOp(t, op)}
                      secondary={formatTime(op.createdAt, lang)}
                      sx={{ flex: '1 1 200px', my: 0 }}
                      slotProps={{ primary: { sx: { textDecoration: op.undoneBy ? 'line-through' : 'none', wordBreak: 'break-word' } } }}
                    />
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                      {op.undoneBy && <Chip size="small" label={t('log.undone')} />}
                      {op.batchId && op.type === 'batch' && <Chip size="small" variant="outlined" label={t('log.batch', { count: op.summary.count ?? 0 })} />}
                      {target && !target.deletedAt && (
                        <Button size="small" onClick={() => navigate(`/e/${target.id}`)}>
                          {t('log.view')}
                        </Button>
                      )}
                      {canUndo && (
                        <Button size="small" onClick={() => void undo(op.id)}>
                          {t('common.undo')}
                        </Button>
                      )}
                    </Stack>
                  </ListItem>
                )
              })}
            </List>
          </Card>
        ) : (
          <EmptyState icon="archive" title={t('log.empty')} />
        )}
        {ops.length > limit && <Button onClick={() => setLimit((l) => l + PAGE)}>{t('items.more', { count: ops.length - limit })}</Button>}
      </Page>
    </>
  )
}
