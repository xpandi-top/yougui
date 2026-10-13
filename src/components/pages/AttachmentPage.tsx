import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import {
  ATTACHMENT_TYPES,
  deleteAttachment,
  linksOfAttachment,
  setCover,
  unlinkAttachment,
  updateAttachment,
  urlHost,
  type AttachmentTypeKey,
} from '../../core/index.ts'
import { useI18n, useT } from '../../context/i18n.tsx'
import { useFeedback } from '../../context/feedback.tsx'
import { useSnap, useStore } from '../../context/store.tsx'
import { useCommit } from '../../hooks/useCommit.ts'
import { useFileUrl } from '../../hooks/useFileUrl.ts'
import { goBack, navigate } from '../../hooks/useRoute.ts'
import { downloadBlob, extFor, formatBytes, revokeObjectUrl } from '../../lib/files.ts'
import { ensureLocalFile } from '../../lib/sync.ts'
import { LinkManager } from '../dialogs/AttachmentAdd.tsx'
import { EntityRow } from '../ui/EntityBits.tsx'
import { Icon } from '../ui/Icon.tsx'
import { Card, EmptyState, Page, PageHeader, Section } from '../ui/Layout.tsx'
import { formatTime } from '../ui/opText.ts'

function Meta({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 88 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
        {value}
      </Typography>
    </Stack>
  )
}

export default function AttachmentPage({ id }: { id: string }) {
  const t = useT()
  const { lang } = useI18n()
  const snap = useSnap()
  const store = useStore()
  const { commit } = useCommit()
  const { confirm, toast } = useFeedback()
  const a = snap.attachments[id]
  const { url, loading, missing } = useFileUrl(a && !a.deletedAt && a.provider === 'local' ? id : null)
  const [editing, setEditing] = useState(false)
  const [linking, setLinking] = useState(false)
  const [form, setForm] = useState({ name: '', typeKey: 'document' as AttachmentTypeKey, note: '', url: '' })

  if (!a || a.deletedAt) {
    return (
      <>
        <PageHeader title={t('att.detail')} back="/attachments" />
        <EmptyState icon="attachment" title={t('att.missing')} />
      </>
    )
  }

  const links = linksOfAttachment(snap, id).filter((l) => l.targetKind === 'entity' && snap.entities[l.targetId] && !snap.entities[l.targetId].deletedAt)
  const isImage = a.mime?.startsWith('image/') && !/hei[cf]/.test(a.mime)
  const isPdf = a.mime === 'application/pdf'

  async function download() {
    const f = await ensureLocalFile(store, id).catch(() => undefined)
    if (!f) return toast(t('att.fileMissing'), { severity: 'error' })
    downloadBlob(f.blob, `${a.name}.${extFor(f.mime)}`)
  }

  async function remove() {
    const names = links.map((l) => snap.entities[l.targetId]?.name).filter(Boolean)
    const ok = await confirm({
      title: t('att.deleteTitle', { name: a.name }),
      body: (
        <Box>
          <Typography color="text.secondary">{a.provider === 'external_url' ? t('att.deleteLinkBody') : t('att.deleteBody')}</Typography>
          {names.length > 0 && (
            <Typography sx={{ mt: 1 }}>
              {t('att.deleteAffects', { count: names.length })}
              {names.join('、')}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {t('att.deleteCopies')}
          </Typography>
        </Box>
      ),
      confirmText: t('att.deleteConfirm'),
      danger: true,
    })
    if (!ok) return
    const r = await commit('attachmentDelete', { entityName: a.name, count: names.length }, (tx) => deleteAttachment(tx, id), {
      success: t('att.deleted'),
      undoable: false,
    })
    if (r.ok) {
      revokeObjectUrl(id)
      await store.deleteFile(id)
      goBack('/attachments')
    }
  }

  return (
    <>
      <PageHeader title={a.name} eyebrow={t(`attType.${a.typeKey}`)} back="/attachments" />
      <Page>
        {a.provider === 'external_url' ? (
          <Card sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {t('att.externalNote')}
            </Typography>
            <Typography sx={{ fontWeight: 700, my: 1 }}>{urlHost(a.url ?? '')}</Typography>
            <Button variant="contained" component="a" href={a.url} target="_blank" rel="noopener noreferrer nofollow" startIcon={<Icon name="link" size={18} />}>
              {t('att.openExternal')}
            </Button>
          </Card>
        ) : loading ? (
          <Typography color="text.secondary">{t('common.loading')}</Typography>
        ) : missing || !url ? (
          <Alert severity="warning">{a.remote ? t('att.cloudOnly') : t('att.fileMissing')}</Alert>
        ) : isImage ? (
          <Box component="img" src={url} alt={a.name} sx={{ width: '100%', maxHeight: '60vh', objectFit: 'contain', bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1 }} />
        ) : isPdf ? (
          <Stack spacing={1}>
            <Box component="iframe" src={url} title={a.name} sx={{ width: '100%', height: '60vh', border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: '#fff' }} />
            <Button component="a" href={url} target="_blank" rel="noopener" startIcon={<Icon name="file" size={18} />}>
              {t('att.openNewTab')}
            </Button>
          </Stack>
        ) : (
          <Alert severity="info">{t('att.noPreview')}</Alert>
        )}

        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          {a.provider === 'local' && (
            <Button variant="outlined" startIcon={<Icon name="download" size={18} />} onClick={() => void download()}>
              {t('att.download')}
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={<Icon name="edit" size={18} />}
            onClick={() => {
              setForm({ name: a.name, typeKey: a.typeKey, note: a.note ?? '', url: a.url ?? '' })
              setEditing(true)
            }}
          >
            {t('common.edit')}
          </Button>
          <Button variant="outlined" startIcon={<Icon name="link" size={18} />} onClick={() => setLinking(true)}>
            {t('att.manageLinks')}
          </Button>
        </Stack>

        <Card sx={{ p: 2 }}>
          <Meta label={t('att.type')} value={t(`attType.${a.typeKey}`)} />
          <Meta label={t('att.source')} value={a.provider === 'external_url' ? t('att.sourceUrl') : a.remote ? t('att.sourceCloud') : t('att.sourceLocal')} />
          <Meta label={t('att.originalName')} value={a.originalName} />
          <Meta label={t('att.size')} value={a.size !== undefined ? formatBytes(a.size) : undefined} />
          <Meta label={t('att.dims')} value={a.width ? `${a.width} × ${a.height}` : undefined} />
          <Meta label={t('att.policy')} value={a.provider === 'local' ? (a.optimized ? t('att.optimized') : t('att.original')) : undefined} />
          <Meta label="SHA-256" value={a.checksum ? `${a.checksum.slice(0, 16)}…` : undefined} />
          <Meta label={t('att.created')} value={formatTime(a.createdAt, lang)} />
          <Meta label={t('att.note')} value={a.note} />
        </Card>

        <Section title={t('att.linksTitle', { count: links.length })}>
          {links.length ? (
            <Card>
              <List disablePadding>
                {links.map((l) => {
                  const e = snap.entities[l.targetId]
                  return (
                    <Box key={l.id} sx={{ borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                      <EntityRow snap={snap} entity={e} />
                      <Stack direction="row" spacing={1} sx={{ px: 2, pb: 1, pl: 9 }}>
                        {a.typeKey === 'photo' && a.provider === 'local' && e.coverId !== a.id && e.kind === 'item' && (
                          <Button size="small" onClick={() => void commit('update', { entityId: e.id, entityName: e.name }, (tx) => setCover(tx, e.id, a.id), { success: t('cover.set') })}>
                            {t('cover.setThis')}
                          </Button>
                        )}
                        <Button
                          size="small"
                          color="warning"
                          onClick={() =>
                            void commit('detach', { entityId: e.id, entityName: e.name, text: a.name }, (tx) => unlinkAttachment(tx, a.id, 'entity', e.id), {
                              success: t('att.unlinkedToast', { name: e.name }),
                            })
                          }
                        >
                          {t('att.unlinkHere')}
                        </Button>
                      </Stack>
                    </Box>
                  )
                })}
              </List>
            </Card>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('att.unlinkedNote')}
            </Typography>
          )}
        </Section>

        <Button color="error" startIcon={<Icon name="delete" size={18} />} onClick={() => void remove()} sx={{ alignSelf: 'flex-start' }}>
          {a.provider === 'external_url' ? t('att.deleteLink') : t('att.deleteFile')}
        </Button>
        {links.length === 0 && (
          <Button onClick={() => navigate('/attachments')} sx={{ alignSelf: 'flex-start' }}>
            {t('att.backToList')}
          </Button>
        )}
      </Page>

      <LinkManager attachmentId={id} open={linking} onClose={() => setLinking(false)} />
      <Dialog open={editing} onClose={() => setEditing(false)} fullWidth maxWidth="sm">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const r = await commit(
              'update',
              { entityName: form.name },
              (tx) => updateAttachment(tx, id, { name: form.name, typeKey: form.typeKey, note: form.note, url: a.provider === 'external_url' ? form.url : undefined }),
              { success: t('toast.saved') },
            )
            if (r.ok) setEditing(false)
          }}
        >
          <DialogTitle>{t('common.edit')}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label={t('att.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <TextField select label={t('att.type')} value={form.typeKey} onChange={(e) => setForm({ ...form, typeKey: e.target.value as AttachmentTypeKey })}>
                {ATTACHMENT_TYPES.filter((k) => (a.provider === 'external_url' ? k !== 'photo' : k !== 'link')).map((k) => (
                  <MenuItem key={k} value={k}>
                    {t(`attType.${k}`)}
                  </MenuItem>
                ))}
              </TextField>
              {a.provider === 'local' && form.typeKey === 'photo' && !a.optimized && <Alert severity="info">{t('att.retypeNote')}</Alert>}
              {a.provider === 'external_url' && <TextField label={t('att.url')} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />}
              <TextField label={t('att.note')} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} multiline minRows={2} />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={!form.name.trim()}>
              {t('common.save')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  )
}
