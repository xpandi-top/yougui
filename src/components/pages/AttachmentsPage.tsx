import { Button, Chip, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, Stack, Tab, Tabs, TextField } from '@mui/material'
import { useMemo, useState } from 'react'
import { ATTACHMENT_TYPES, linksOfAttachment, normalize, unlinkedAttachments, type Attachment, type AttachmentTypeKey } from '../../core/index.ts'
import { useT } from '../../context/i18n.tsx'
import { useSnap } from '../../context/store.tsx'
import { navigate, q, useRoute } from '../../hooks/useRoute.ts'
import { formatBytes } from '../../lib/files.ts'
import { AttachmentAddDialog } from '../dialogs/AttachmentAdd.tsx'
import { Icon } from '../ui/Icon.tsx'
import { Card, EmptyState, Page, PageHeader } from '../ui/Layout.tsx'

export function attIcon(a: Attachment): string {
  return a.provider === 'external_url' ? 'link' : a.typeKey === 'photo' ? 'photo' : 'file'
}

/** 附件：未关联基础列表（P0）+ 全部档案按名称/类型筛选。 */
export default function AttachmentsPage() {
  const t = useT()
  const snap = useSnap()
  const { query } = useRoute()
  const tab = query.get('tab') === 'all' ? 'all' : 'unlinked'
  const [text, setText] = useState('')
  const [type, setType] = useState<AttachmentTypeKey | null>(null)
  const [adding, setAdding] = useState(false)

  const list = useMemo(() => {
    const base = tab === 'unlinked' ? unlinkedAttachments(snap) : Object.values(snap.attachments).filter((a) => !a.deletedAt).sort((a, b) => b.createdAt - a.createdAt)
    const n = normalize(text)
    return base.filter((a) => (!type || a.typeKey === type) && (!n || normalize(`${a.name}${a.note ?? ''}${a.originalName ?? ''}`).includes(n)))
  }, [snap, tab, text, type])

  return (
    <>
      <PageHeader
        title={t('more.attachments')}
        back="/more"
        actions={
          <Button startIcon={<Icon name="add" size={18} />} onClick={() => setAdding(true)}>
            {t('common.add')}
          </Button>
        }
      />
      <Tabs value={tab} onChange={(_, v) => navigate(`/attachments${q({ tab: v === 'all' ? 'all' : null })}`, { replace: true })} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="unlinked" label={t('att.tabUnlinked')} />
        <Tab value="all" label={t('att.tabAll')} />
      </Tabs>
      <Page>
        <TextField
          size="small"
          placeholder={t('att.search')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Icon name="search" size={18} /></InputAdornment> } }}
        />
        <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap' }}>
          <Chip size="small" label={t('common.all')} color={type ? 'default' : 'primary'} onClick={() => setType(null)} />
          {ATTACHMENT_TYPES.map((k) => (
            <Chip key={k} size="small" label={t(`attType.${k}`)} color={type === k ? 'primary' : 'default'} onClick={() => setType(k)} />
          ))}
        </Stack>
        {list.length ? (
          <Card>
            <List disablePadding>
              {list.map((a) => {
                const n = linksOfAttachment(snap, a.id).length
                return (
                  <ListItemButton key={a.id} divider onClick={() => navigate(`/a/${a.id}`)}>
                    <ListItemIcon sx={{ minWidth: 40, color: 'primary.main' }}>
                      <Icon name={attIcon(a)} />
                    </ListItemIcon>
                    <ListItemText
                      primary={a.name}
                      secondary={[t(`attType.${a.typeKey}`), a.size ? formatBytes(a.size) : null, n ? t('att.linkCount', { count: n }) : t('att.unlinked')].filter(Boolean).join(' · ')}
                      slotProps={{ primary: { sx: { wordBreak: 'break-word' } } }}
                    />
                  </ListItemButton>
                )
              })}
            </List>
          </Card>
        ) : (
          <EmptyState icon="attachment" title={tab === 'unlinked' ? t('att.emptyUnlinked') : t('att.emptyAll')} body={t('att.emptyBody')} />
        )}
      </Page>
      <AttachmentAddDialog open={adding} onClose={() => setAdding(false)} onDone={(id) => navigate(`/a/${id}`)} />
    </>
  )
}
