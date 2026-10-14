import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import {
  ATTACHMENT_TYPES,
  addAttachment,
  linkAttachment,
  linksOfAttachment,
  setCover,
  unlinkAttachment,
  urlHost,
  type AttachmentTypeKey,
} from '../../core/index.ts'
import { errorText, useT } from '../../context/i18n.tsx'
import { useFeedback } from '../../context/feedback.tsx'
import { useSnap, useStore } from '../../context/store.tsx'
import { useCommit } from '../../hooks/useCommit.ts'
import { checkFile, defaultAttachmentName, formatBytes, imageSize, optimizePhoto, sha256, sniffMime } from '../../lib/files.ts'
import { newId } from '../../lib/store.ts'
import { Icon } from '../ui/Icon.tsx'
import { EntityPicker } from './Basic.tsx'

interface Props {
  open: boolean
  /** 预先关联的实体（从物品详情进入） */
  entityId?: string
  /** 保存后设为该实体封面（仅照片） */
  asCover?: boolean
  onClose: () => void
  onDone?: (attachmentId: string) => void
}

type Phase = 'idle' | 'optimizing' | 'saving'

export function AttachmentAddDialog({ open, entityId, asCover, onClose, onDone }: Props) {
  const t = useT()
  const snap = useSnap()
  const store = useStore()
  const { commit } = useCommit()
  const { toast } = useFeedback()
  const [mode, setMode] = useState<'file' | 'url'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [mime, setMime] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [typeKey, setTypeKey] = useState<AttachmentTypeKey>('photo')
  const [note, setNote] = useState('')
  const [url, setUrl] = useState('')
  const [targets, setTargets] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setMode('file')
    setFile(null)
    setPreview(null)
    setName('')
    setTypeKey('photo')
    setNote('')
    setUrl('')
    setTargets(entityId ? [entityId] : [])
    setPhase('idle')
    setError('')
  }, [open, entityId])

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  async function onFile(f: File | undefined) {
    setError('')
    if (!f) return
    const c = checkFile(f)
    if (!c.ok) {
      setError(c.reason === 'tooLarge' ? t('att.err.tooLarge') : t('att.err.type'))
      return
    }
    const real = await sniffMime(f)
    if (real && real.split('/')[0] !== c.mime.split('/')[0] && !(real === 'image/heic' && /hei[cf]/.test(c.mime))) {
      setError(t('att.err.disguised'))
      return
    }
    const m = real ?? c.mime
    setFile(f)
    setMime(m)
    const isImage = m.startsWith('image/')
    const stamp = new Date().toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    setName(defaultAttachmentName(f.name, isImage, entityId ? snap.entities[entityId]?.name : undefined, `${t(isImage ? 'attType.photo' : 'attType.document')} ${stamp}`))
    setTypeKey(m.startsWith('image/') ? 'photo' : 'document')
    setPreview(m.startsWith('image/') && !/hei[cf]/.test(m) ? URL.createObjectURL(f) : null)
  }

  async function save() {
    setError('')
    const id = newId()
    let stored = false
    try {
      let payload: Parameters<typeof addAttachment>[1]
      if (mode === 'url') {
        payload = { name: name.trim() || urlHost(url.trim()), typeKey: typeKey === 'photo' ? 'link' : typeKey, provider: 'external_url', url, note }
      } else {
        if (!file) return
        let blob: Blob = file
        let dims: { width: number; height: number } | null = null
        let optimized = false
        if (typeKey === 'photo') {
          setPhase('optimizing')
          try {
            const o = await optimizePhoto(file)
            blob = o.blob
            dims = { width: o.width, height: o.height }
            optimized = true
          } catch {
            setPhase('idle')
            setError(t('att.err.decode'))
            return
          }
        } else if (mime.startsWith('image/')) {
          dims = await imageSize(file)
        }
        setPhase('saving')
        const checksum = await sha256(blob)
        await store.saveFile(id, blob)
        stored = true
        payload = {
          name,
          typeKey,
          provider: 'local',
          mime: optimized ? 'image/jpeg' : mime,
          size: blob.size,
          originalName: file.name,
          checksum,
          width: dims?.width,
          height: dims?.height,
          optimized,
          note,
        }
      }
      setPhase('saving')
      const r = await commit(
        'attach',
        { entityName: payload.name, count: targets.length },
        (tx) => {
          const a = addAttachment(tx, payload, id)
          for (const tid of targets) linkAttachment(tx, a.id, 'entity', tid)
          if (asCover && entityId && a.typeKey === 'photo' && a.provider === 'local') setCover(tx, entityId, a.id)
          return a
        },
        { success: t('att.saved'), silent: true },
      )
      if (!r.ok) {
        if (stored) await store.deleteFile(id)
        setError(errorText(t, r.error))
        setPhase('idle')
        return
      }
      onDone?.(id)
      onClose()
    } catch (err) {
      if (stored) await store.deleteFile(id).catch(() => undefined)
      setError(errorText(t, err))
      setPhase('idle')
      toast(errorText(t, err), { severity: 'error' })
    }
  }

  const busy = phase !== 'idle'
  const canSave = !busy && (mode === 'url' ? !!url.trim() : !!file && !!name.trim())
  const types = mode === 'url' ? ATTACHMENT_TYPES.filter((k) => k !== 'photo') : ATTACHMENT_TYPES.filter((k) => k !== 'link' && (k !== 'photo' || mime.startsWith('image/')))

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle sx={{ pb: 0 }}>{asCover ? t('att.addPhoto') : t('att.add')}</DialogTitle>
      {!asCover && (
        <Tabs
          value={mode}
          onChange={(_, v: 'file' | 'url') => {
            setMode(v)
            setError('')
            setTypeKey(v === 'url' ? 'link' : file && mime.startsWith('image/') ? 'photo' : 'document')
          }}
          sx={{ px: 2 }}
        >
          <Tab value="file" label={t('att.fileTab')} />
          <Tab value="url" label={t('att.urlTab')} />
        </Tabs>
      )}
      <DialogContent dividers>
        <Stack spacing={2}>
          {mode === 'file' ? (
            <>
              <input ref={fileInput} type="file" hidden accept={asCover ? 'image/*' : 'image/*,application/pdf,.pdf,.heic,.heif'} onChange={(e) => void onFile(e.target.files?.[0])} />
              <input ref={cameraInput} type="file" hidden accept="image/*" capture="environment" onChange={(e) => void onFile(e.target.files?.[0])} />
              <Stack direction="row" spacing={1}>
                <Button variant="outlined" startIcon={<Icon name="camera" size={18} />} onClick={() => cameraInput.current?.click()} disabled={busy}>
                  {t('att.takePhoto')}
                </Button>
                <Button variant="outlined" startIcon={<Icon name="file" size={18} />} onClick={() => fileInput.current?.click()} disabled={busy}>
                  {t('att.chooseFile')}
                </Button>
              </Stack>
              {file && (
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Box sx={{ width: 64, height: 64, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    {preview ? <Box component="img" src={preview} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="file" size={28} />}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ wordBreak: 'break-all' }}>{file.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {mime} · {formatBytes(file.size)}
                    </Typography>
                  </Box>
                </Stack>
              )}
            </>
          ) : (
            <TextField
              label={t('att.url')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
              helperText={t('att.urlHelp')}
              slotProps={{ htmlInput: { inputMode: 'url', autoCapitalize: 'off', autoCorrect: 'off' } }}
            />
          )}
          {(mode === 'url' || file) && (
            <>
              <TextField label={t('att.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === 'url' && url ? urlHost(url) : ''} />
              {!asCover && (
                <TextField select label={t('att.type')} value={types.includes(typeKey) ? typeKey : types[0]} onChange={(e) => setTypeKey(e.target.value as AttachmentTypeKey)}>
                  {types.map((k) => (
                    <MenuItem key={k} value={k}>
                      {t(`attType.${k}`)}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {mode === 'file' && (
                <Alert severity={typeKey === 'photo' ? 'info' : 'success'} icon={false}>
                  {typeKey === 'photo' ? t('att.photoPolicy') : t('att.originalPolicy')}
                </Alert>
              )}
              <TextField label={t('att.note')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} />
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  {t('att.links')}
                </Typography>
                <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
                  {targets.map((id) => (
                    <Chip key={id} label={snap.entities[id]?.name ?? '?'} onDelete={() => setTargets((s) => s.filter((x) => x !== id))} />
                  ))}
                  {!targets.length && (
                    <Typography variant="body2" color="text.secondary">
                      {t('att.noLinks')}
                    </Typography>
                  )}
                  <Button size="small" startIcon={<Icon name="link" size={16} />} onClick={() => setPicking(true)}>
                    {t('att.linkTo')}
                  </Button>
                </Stack>
              </Box>
            </>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {busy && (
            <Box>
              <Typography variant="caption">{phase === 'optimizing' ? t('att.phase.optimizing') : t('att.phase.saving')}</Typography>
              <LinearProgress />
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={!canSave}>
          {t('common.save')}
        </Button>
      </DialogActions>
      <EntityPicker
        open={picking}
        title={t('att.linkTo')}
        multiple
        initial={targets}
        onClose={() => setPicking(false)}
        onPick={(ids) => {
          setTargets(ids)
          setPicking(false)
        }}
      />
    </Dialog>
  )
}

/** 管理一份附件的多对象关联：增删只改关联，不复制、不删除文件。 */
export function LinkManager({ attachmentId, open, onClose }: { attachmentId: string; open: boolean; onClose: () => void }) {
  const t = useT()
  const snap = useSnap()
  const { commit } = useCommit()
  const current = linksOfAttachment(snap, attachmentId)
    .filter((l) => l.targetKind === 'entity' && snap.entities[l.targetId] && !snap.entities[l.targetId].deletedAt)
    .map((l) => l.targetId)
  return (
    <EntityPicker
      open={open}
      title={t('att.manageLinks')}
      multiple
      initial={current}
      onClose={onClose}
      onPick={async (ids) => {
        const add = ids.filter((id) => !current.includes(id))
        const remove = current.filter((id) => !ids.includes(id))
        if (add.length || remove.length) {
          await commit(
            'attach',
            { entityName: snap.attachments[attachmentId]?.name, count: ids.length },
            (tx) => {
              for (const id of add) linkAttachment(tx, attachmentId, 'entity', id)
              for (const id of remove) unlinkAttachment(tx, attachmentId, 'entity', id)
            },
            { success: t('att.linksSaved') },
          )
        }
        onClose()
      }}
    />
  )
}
