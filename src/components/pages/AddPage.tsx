import {
  Alert,
  Box,
  Button,
  Collapse,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_ITEM_ICON, iconById, iconLabel } from '../../catalog.ts'
import {
  addAttachment,
  createEntity,
  createWithBarcode,
  parseProductCode,
  productCodeSuggestions,
  pathNames,
  PATH_SEP,
  setCover,
  similarNames,
  type AttachmentInput,
  type CreateInput,
  type Entity,
  type ProductDetails,
} from '../../core/index.ts'
import { useI18n, useT } from '../../context/i18n.tsx'
import { useFeedback } from '../../context/feedback.tsx'
import { useSnap, useStore } from '../../context/store.tsx'
import { useCommit } from '../../hooks/useCommit.ts'
import { useProductLookup } from '../../hooks/useProductLookup.ts'
import { navigate, useRoute } from '../../hooks/useRoute.ts'
import { checkFile, optimizePhoto, sha256 } from '../../lib/files.ts'
import { newId } from '../../lib/store.ts'
import { IconPicker } from '../dialogs/Basic.tsx'
import { CategoryField, ExpiryField } from '../ui/Fields.tsx'
import { PlacePicker } from '../dialogs/PlacePicker.tsx'
import { Icon } from '../ui/Icon.tsx'
import { LookupHint } from '../ui/LookupHint.tsx'
import { Card, Page, PageHeader } from '../ui/Layout.tsx'

interface Added {
  id: string
  name: string
  opId: string | null
  undone?: boolean
}

/** 极简创建：名称是唯一必填；连续模式保存后清空名称、保持位置与键盘。 */
export function AddPage() {
  const t = useT()
  const { lang } = useI18n()
  const snap = useSnap()
  const store = useStore()
  const { commit } = useCommit()
  const { toast } = useFeedback()
  const { query } = useRoute()
  const initialParent = query.get('parent')
  const [name, setName] = useState(query.get('name') ?? '')
  const [parentId, setParentId] = useState<string | null>(initialParent && snap.entities[initialParent] ? initialParent : null)
  const [continuous, setContinuous] = useState(query.get('continuous') === '1')
  const [more, setMore] = useState(!!query.get('barcode'))
  const [iconKey, setIconKey] = useState<string | null>(null)
  const [tracking, setTracking] = useState(false)
  const [qty, setQty] = useState('1')
  const [unit, setUnit] = useState('')
  const [container, setContainer] = useState(false)
  const [category, setCategory] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState('')
  const [barcode, setBarcode] = useState(query.get('barcode') ?? '')
  const [picking, setPicking] = useState(false)
  const [iconOpen, setIconOpen] = useState(false)
  const [added, setAdded] = useState<Added[]>([])
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const similar = useMemo(() => (name.trim().length >= 2 ? similarNames(snap, name, 'item').slice(0, 3) : []), [snap, name])
  const parentPath = parentId ? [...pathNames(snap.entities, parentId), snap.entities[parentId]?.name].join(PATH_SEP) : t('path.unassigned')
  const qtyNum = Number(qty)
  const qtyErr = tracking && (!/^\d+$/.test(qty) || !Number.isInteger(qtyNum)) ? t('qty.mustInt') : tracking && container && qtyNum > 1 ? t('err.container.hasQuantity') : ''
  const product = barcode.trim() ? parseProductCode(barcode) : null
  const barcodeErr = barcode.trim() && !product ? t('err.barcode.invalid') : ''
  const barcodeFix = barcodeErr ? productCodeSuggestions(barcode) : []
  const lookup = useProductLookup(product)
  // 查到商品名时：名称为空或仍是上次自动填入的值才填入，绝不覆盖用户输入
  const autoName = useRef(query.get('name') ? null : '')
  const [autoApplied, setAutoApplied] = useState(false)
  useEffect(() => {
    if (lookup.status !== 'found' || !lookup.info) return
    const info = lookup.info
    if (autoName.current !== null && (name === '' || name === autoName.current)) {
      setName(info.name)
      autoName.current = info.name
      setAutoApplied(true)
    }
    if (info.category) setCategory((c) => c || info.category!)
  }, [lookup]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null)
      return
    }
    const u = URL.createObjectURL(photo)
    setPhotoUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [photo])

  function onPhoto(f: File | undefined) {
    if (!f) return
    const c = checkFile(f)
    if (!c.ok || !c.mime.startsWith('image/')) {
      toast(c.ok ? t('att.err.type') : c.reason === 'tooLarge' ? t('att.err.tooLarge') : t('att.err.type'), { severity: 'error' })
      return
    }
    setPhoto(f)
  }

  async function save() {
    if (!name.trim() || qtyErr || barcodeErr || busy) return
    setBusy(true)
    const input: CreateInput = {
      kind: 'item',
      name,
      parentId,
      iconKey,
      quantity: tracking ? qtyNum : null,
      unit: tracking ? unit : undefined,
      canContain: container,
      category,
      note,
      expiresAt: expiresAt || null,
    }
    // 照片先优化并存入本机，再在同一次提交里建物品、附件并设为封面；提交失败则删掉文件
    let att: { id: string; meta: AttachmentInput } | null = null
    if (photo) {
      try {
        const o = await optimizePhoto(photo)
        const id = newId()
        await store.saveFile(id, o.blob)
        att = {
          id,
          meta: { name: name.trim(), typeKey: 'photo', provider: 'local', mime: 'image/jpeg', size: o.blob.size, originalName: photo.name, checksum: await sha256(o.blob), width: o.width, height: o.height, optimized: true },
        }
      } catch {
        setBusy(false)
        toast(t('att.err.decode'), { severity: 'error' })
        return
      }
    }
    const details: ProductDetails | null =
      lookup.status === 'found' && lookup.info
        ? { name: lookup.info.name, brand: lookup.info.brand, model: lookup.info.model, category: lookup.info.category, source: lookup.info.source, at: Date.now() }
        : null
    const r = await commit<Entity>(
      'create',
      (e: Entity) => ({ entityId: e.id, entityName: e.name, toId: parentId, toName: parentId ? snap.entities[parentId]?.name : null, qty: e.quantity }),
      (tx) => {
        const e = product ? createWithBarcode(tx, input, product, details) : createEntity(tx, input)
        if (att) {
          addAttachment(tx, att.meta, att.id)
          setCover(tx, e.id, att.id)
        }
        return e
      },
      { success: continuous ? '' : (e) => t('toast.created', { name: e.name }) },
    )
    setBusy(false)
    if (!r.ok) {
      if (att) await store.deleteFile(att.id)
      return
    }
    if (continuous) {
      setAdded((a) => [{ id: r.out.id, name: r.out.name, opId: r.opId }, ...a])
      setName('')
      setBarcode('')
      setPhoto(null)
      setExpiresAt('')
      autoName.current = ''
      setAutoApplied(false)
      nameRef.current?.focus()
    } else {
      navigate(`/e/${r.out.id}`, { replace: true })
    }
  }

  async function undoAdded(a: Added) {
    if (!a.opId) return
    try {
      await store.undo(a.opId)
      setAdded((list) => list.map((x) => (x.id === a.id ? { ...x, undone: true } : x)))
    } catch {
      toast(t('err.undo.stale', { name: a.name }), { severity: 'error' })
    }
  }

  const icon = iconById(iconKey) ?? iconById(DEFAULT_ITEM_ICON)!

  return (
    <>
      <PageHeader title={continuous ? t('add.titleMany') : t('add.title')} back={parentId ? `/e/${parentId}` : '/items'} />
      <Page>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            inputRef={nameRef}
            autoFocus
            required
            label={t('field.name')}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (autoName.current !== null && e.target.value !== autoName.current) {
                autoName.current = null
                setAutoApplied(false)
              }
            }}
            placeholder={t('add.namePlaceholder')}
            slotProps={{ htmlInput: { enterKeyHint: continuous ? 'next' : 'done', maxLength: 80 } }}
          />
          {product && <LookupHint state={lookup} applied={autoApplied} />}
          {similar.length > 0 && (
            <Alert severity="info" icon={false} sx={{ py: 0 }}>
              {t('add.similar')}{' '}
              {similar.map((s, i) => (
                <Box component="span" key={s.id}>
                  {i > 0 && '、'}
                  <Box component="button" type="button" onClick={() => navigate(`/e/${s.id}`)} sx={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline' }}>
                    {s.name}
                  </Box>
                </Box>
              ))}
              {t('add.similarTail')}
            </Alert>
          )}
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('add.location')}
            </Typography>
            <Button
              fullWidth
              variant="outlined"
              onClick={() => setPicking(true)}
              startIcon={<Icon name="places" size={18} />}
              endIcon={<Icon name="next" size={16} />}
              sx={{ justifyContent: 'flex-start', textAlign: 'left', mt: 0.5, '& .MuiButton-endIcon': { ml: 'auto' } }}
            >
              <Box component="span" sx={{ wordBreak: 'break-word' }}>
                {parentPath}
              </Box>
            </Button>
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('add.appearance')}
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 0.5 }}>
              <Box sx={{ width: 56, height: 56, border: 1, borderColor: 'divider', borderRadius: 1, display: 'grid', placeItems: 'center', color: 'primary.main', overflow: 'hidden', flexShrink: 0 }}>
                {photoUrl ? <Box component="img" src={photoUrl} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name={icon.id} size={30} />}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2">{photo ? t('add.photoChosen') : iconKey ? iconLabel(icon, lang) : t('add.iconDefault')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {photo ? t('add.photoNote') : t('add.appearanceHelp')}
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" sx={{ gap: 1, mt: 1, flexWrap: 'wrap' }}>
              <input ref={photoInput} type="file" hidden accept="image/*" onChange={(e) => {
                onPhoto(e.target.files?.[0])
                e.target.value = ''
              }} />
              <Button size="small" variant="outlined" startIcon={<Icon name="camera" size={16} />} onClick={() => photoInput.current?.click()}>
                {photo ? t('cover.change') : t('add.takePhoto')}
              </Button>
              {photo && (
                <Button size="small" onClick={() => setPhoto(null)}>
                  {t('add.removePhoto')}
                </Button>
              )}
              <Button size="small" startIcon={<Icon name="items" size={16} />} onClick={() => setIconOpen(true)}>
                {t('icon.change')}
              </Button>
            </Stack>
          </Box>

          <Button size="small" onClick={() => setMore((m) => !m)} sx={{ alignSelf: 'flex-start' }} endIcon={<Icon name="next" size={14} sx={{ transform: more ? 'rotate(90deg)' : 'none' }} />}>
            {t('add.more')}
          </Button>
          <Collapse in={more}>
            <Stack spacing={2}>
              <FormControlLabel control={<Switch checked={tracking} onChange={(e) => setTracking(e.target.checked)} />} label={t('qty.tracking')} />
              {tracking && (
                <Stack direction="row" spacing={1}>
                  <TextField
                    label={t('qty.current.label')}
                    value={qty}
                    onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))}
                    error={!!qtyErr}
                    helperText={qtyErr || t('qty.startHelp')}
                    slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*' } }}
                  />
                  <TextField label={t('field.unit')} value={unit} onChange={(e) => setUnit(e.target.value)} sx={{ maxWidth: 110 }} placeholder={t('add.unitPh')} />
                </Stack>
              )}
              <FormControlLabel control={<Switch checked={container} onChange={(e) => setContainer(e.target.checked)} />} label={t('entity.containerSwitch')} />
              <CategoryField value={category} onChange={setCategory} />
              <ExpiryField value={expiresAt} onChange={setExpiresAt} />
              <TextField
                label={t('barcode.label')}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                error={!!barcodeErr}
                helperText={barcodeErr || t('barcode.help')}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              />
              {barcodeFix.map((code) => (
                <Button key={code} size="small" variant="outlined" onClick={() => setBarcode(code)} sx={{ alignSelf: 'flex-start', mt: -1 }}>
                  {t('barcode.didYouMean', { code })}
                </Button>
              ))}
              <TextField label={t('field.note')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} />
            </Stack>
          </Collapse>

          <FormControlLabel control={<Switch checked={continuous} onChange={(e) => setContinuous(e.target.checked)} />} label={t('add.continuous')} />
          <Button type="submit" variant="contained" color="secondary" size="large" disabled={!name.trim() || !!qtyErr || !!barcodeErr || busy}>
            {continuous ? t('add.saveNext') : t('common.save')}
          </Button>
        </Box>

        {added.length > 0 && (
          <Card>
            <Typography variant="subtitle2" sx={{ px: 2, pt: 1.5 }}>
              {t('add.addedList', { count: added.filter((a) => !a.undone).length })}
            </Typography>
            <List dense>
              {added.map((a) => (
                <ListItem
                  key={a.id}
                  secondaryAction={
                    !a.undone && (
                      <IconButton aria-label={t('common.undo')} onClick={() => void undoAdded(a)}>
                        <Icon name="back" size={18} />
                      </IconButton>
                    )
                  }
                >
                  <ListItemText
                    primary={a.name}
                    secondary={a.undone ? t('log.undone') : parentPath}
                    slotProps={{ primary: { sx: { textDecoration: a.undone ? 'line-through' : 'none' } } }}
                    onClick={() => !a.undone && navigate(`/e/${a.id}`)}
                  />
                </ListItem>
              ))}
            </List>
          </Card>
        )}
      </Page>
      <PlacePicker
        open={picking}
        title={t('add.location')}
        initialId={parentId}
        onClose={() => setPicking(false)}
        onPick={(id) => {
          setParentId(id)
          setPicking(false)
        }}
      />
      <IconPicker
        open={iconOpen}
        value={iconKey}
        onPhoto={() => {
          setIconOpen(false)
          photoInput.current?.click()
        }}
        onClose={() => setIconOpen(false)}
        onPick={(k) => {
          setIconKey(k)
          setIconOpen(false)
        }}
      />
    </>
  )
}
