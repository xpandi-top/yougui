import { Box, Button, Chip, List, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { bindLabel, createEntity, disableLabel, formatLabelCode, labelUrl, type Entity, type EntityKind } from '../../core/index.ts'
import { useT } from '../../context/i18n.tsx'
import { useFeedback } from '../../context/feedback.tsx'
import { useSnap } from '../../context/store.tsx'
import { useCommit } from '../../hooks/useCommit.ts'
import { navigate, q } from '../../hooks/useRoute.ts'
import { qrSvg } from '../../lib/qr.ts'
import { appUrl } from '../../lib/settings.ts'
import { EntityPicker, TextDialog } from '../dialogs/Basic.tsx'
import { PlacePicker } from '../dialogs/PlacePicker.tsx'
import { EntityRow } from '../ui/EntityBits.tsx'
import { Icon } from '../ui/Icon.tsx'
import { Card, EmptyState, Page, PageHeader } from '../ui/Layout.tsx'
import { statusColor } from './LabelsPage.tsx'

export function QrBox({ text, size = 180 }: { text: string; size?: number }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let alive = true
    void qrSvg(text).then((s) => alive && setSvg(s))
    return () => {
      alive = false
    }
  }, [text])
  return <Box sx={{ width: size, height: size, bgcolor: '#fff', '& svg': { width: '100%', height: '100%', display: 'block' } }} dangerouslySetInnerHTML={{ __html: svg }} />
}

export default function LabelPage({ id }: { id: string }) {
  const t = useT()
  const snap = useSnap()
  const { commit } = useCommit()
  const { confirm } = useFeedback()
  const [picking, setPicking] = useState(false)
  const [creating, setCreating] = useState<EntityKind | null>(null)
  const [newName, setNewName] = useState<EntityKind | null>(null)
  const [pendingName, setPendingName] = useState('')
  const l = snap.labels[id]

  if (!l || l.deletedAt) {
    return (
      <>
        <PageHeader title={t('label.title')} back="/labels" />
        <EmptyState icon="qr" title={t('label.notFound')} body={t('label.notFoundBody')} />
      </>
    )
  }
  const e = l.entityId ? snap.entities[l.entityId] : null
  const live = e && !e.deletedAt ? e : null

  async function bindTo(entityId: string) {
    let force = false
    if (l.status === 'bound' && live && live.id !== entityId) {
      force = await confirm({ title: t('label.rebindTitle'), body: t('label.rebindBody', { code: formatLabelCode(l.code), name: live.name }), danger: true })
      if (!force) return
    } else if (l.status === 'disabled') {
      force = true
    }
    const r = await commit('labelBind', { entityId, entityName: snap.entities[entityId]?.name, text: l.code }, (tx) => bindLabel(tx, l.id, entityId, force), {
      success: t('label.bound', { code: formatLabelCode(l.code) }),
    })
    if (r.ok) setPicking(false)
  }

  return (
    <>
      <PageHeader title={formatLabelCode(l.code)} eyebrow={t('label.title')} back="/labels" />
      <Page>
        <Card sx={{ p: 2 }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <QrBox text={labelUrl(appUrl(), l.token)} size={132} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 24, fontWeight: 700, letterSpacing: '0.1em' }}>{formatLabelCode(l.code)}</Typography>
              <Chip size="small" variant="outlined" color={statusColor(l.status)} label={t(`labels.f.${l.status}`)} sx={{ mt: 1 }} />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {t('label.codeNote')}
              </Typography>
            </Box>
          </Stack>
        </Card>

        {live && (
          <Card>
            <List disablePadding>
              <EntityRow snap={snap} entity={live} />
            </List>
          </Card>
        )}
        {l.status === 'disabled' && <Typography color="warning.main">{t('label.disabledNote')}</Typography>}

        <Stack spacing={1}>
          {l.status !== 'bound' && (
            <>
              <Button variant="contained" color="secondary" startIcon={<Icon name="link" size={18} />} onClick={() => setPicking(true)}>
                {l.status === 'disabled' ? t('label.reactivate') : t('bind.existing')}
              </Button>
              <Stack direction="row" spacing={1}>
                <Button fullWidth variant="outlined" onClick={() => setNewName('item')}>
                  {t('bind.newItem')}
                </Button>
                <Button fullWidth variant="outlined" onClick={() => setNewName('location')}>
                  {t('bind.newLocation')}
                </Button>
              </Stack>
            </>
          )}
          {l.status === 'bound' && (
            <>
              <Button variant="outlined" startIcon={<Icon name="link" size={18} />} onClick={() => setPicking(true)}>
                {t('label.rebind')}
              </Button>
              <Button
                color="error"
                onClick={async () => {
                  if (await confirm({ title: t('label.disableTitle'), body: t('label.disableBody'), danger: true })) {
                    await commit('labelDisable', { entityId: live?.id, entityName: live?.name, text: l.code }, (tx) => disableLabel(tx, l.id), { success: t('toast.saved') })
                  }
                }}
              >
                {t('label.disable')}
              </Button>
            </>
          )}
          <Button startIcon={<Icon name="print" size={18} />} onClick={() => navigate(`/print${q({ ids: l.id })}`)}>
            {t('label.print')}
          </Button>
        </Stack>
      </Page>
      <EntityPicker open={picking} title={t('bind.existing')} onClose={() => setPicking(false)} onPick={([eid]) => eid && void bindTo(eid)} />
      <TextDialog
        open={newName !== null}
        title={newName === 'location' ? t('bind.newLocation') : t('bind.newItem')}
        label={t('field.name')}
        confirmText={t('common.next')}
        onClose={() => setNewName(null)}
        onSubmit={(v) => {
          setPendingName(v)
          setCreating(newName)
          setNewName(null)
        }}
      />
      <PlacePicker
        open={creating !== null}
        title={t('bind.where')}
        locationsOnly={creating === 'location'}
        onClose={() => setCreating(null)}
        onPick={async (parentId) => {
          const kind = creating!
          const name = pendingName
          setCreating(null)
          const r = await commit<Entity>(
            'labelBind',
            (ent: Entity) => ({ entityId: ent.id, entityName: ent.name, text: l.code }),
            (tx) => {
              const ent = createEntity(tx, { kind, name, parentId })
              bindLabel(tx, l.id, ent.id, l.status === 'disabled')
              return ent
            },
            { success: (ent) => t('toast.created', { name: ent.name }) },
          )
          if (r.ok) navigate(`/e/${r.out.id}`, { replace: true })
        }}
      />
    </>
  )
}
