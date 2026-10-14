import {
  Box,
  Breadcrumbs,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useState, type ReactNode } from 'react'
import {
  CODE_ALPHABET,
  addBarcode,
  ancestors,
  attachmentsOf,
  bindLabel,
  childrenOf,
  createEntity,
  createLabels,
  deleteEntity,
  descendants,
  formatLabelCode,
  isEffectivelyOut,
  labelByCode,
  labelsOf,
  liveChildCount,
  moveEntity,
  displayProductCode,
  parseProductCode,
  productCodeSuggestions,
  putIn,
  randomString,
  removeBarcode,
  setContainer,
  setCover,
  setProductDetails,
  setQuantity,
  stocksOfType,
  TOKEN_ALPHABET,
  updateEntity,
  withdraw,
  type Entity,
  type OpSummary,
  type Snapshot,
} from '../../core/index.ts'
import { iconById, iconLabel } from '../../catalog.ts'
import { hasKey, useI18n, useT, type UiKey } from '../../context/i18n.tsx'
import { formatDateTime } from '../../lib/dates.ts'
import { lookupProduct } from '../../lib/lookup.ts'
import { useSettings } from '../../lib/settings.ts'
import { CategoryField, ExpiryChip, ExpiryField } from '../ui/Fields.tsx'
import { useFeedback } from '../../context/feedback.tsx'
import { useAppState, useSnap } from '../../context/store.tsx'
import { useCommit } from '../../hooks/useCommit.ts'
import { useFileUrl } from '../../hooks/useFileUrl.ts'
import { navigate, q } from '../../hooks/useRoute.ts'
import { randomBytes } from '../../lib/store.ts'
import { AttachmentAddDialog } from '../dialogs/AttachmentAdd.tsx'
import { IconPicker, QtyDialog, TextDialog } from '../dialogs/Basic.tsx'
import { NewPlaceDialog } from '../dialogs/NewPlaceDialog.tsx'
import { PlacePicker } from '../dialogs/PlacePicker.tsx'
import { EntityAvatar, EntityRow, PathLine, QtyText, StateChips } from '../ui/EntityBits.tsx'
import { Icon } from '../ui/Icon.tsx'
import { Card, EmptyState, Page, PageHeader, Section } from '../ui/Layout.tsx'
import { describeOp, formatTime } from '../ui/opText.ts'

function parentName(snap: Snapshot, id: string | null): string | null {
  return id ? (snap.entities[id]?.name ?? null) : null
}

export function newLabelGen() {
  return () => ({ token: randomString(TOKEN_ALPHABET, 16, randomBytes), code: randomString(CODE_ALPHABET, 6, randomBytes) })
}

// ───────────────────────── 物品操作（详情页与搜索结果共用） ─────────────────────────

type Pending =
  | { kind: 'move'; target: string | null }
  | { kind: 'withdraw' }
  | { kind: 'restock' }
  | { kind: 'adjust' }
  | { kind: 'track' }

export function useEntityActions(entity: Entity) {
  const t = useT()
  const snap = useSnap()
  const { commit } = useCommit()
  const { confirm } = useFeedback()
  const [picker, setPicker] = useState<'move' | 'putBack' | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const tracked = entity.quantity !== null
  const base: OpSummary = { entityId: entity.id, entityName: entity.name }

  async function doMove(target: string | null, qty?: number) {
    const r = await commit(
      'move',
      { ...base, fromId: entity.parentId, fromName: parentName(snap, entity.parentId), toId: target, toName: parentName(snap, target), qty: qty ?? null },
      (tx) => moveEntity(tx, entity.id, target, qty),
      { success: t('toast.moved', { name: entity.name, to: parentName(snap, target) ?? t('path.unassigned') }) },
    )
    if (r.ok) setPending(null)
  }

  async function doWithdraw(qty?: number) {
    const r = await commit(
      'withdraw',
      { ...base, fromId: entity.parentId, fromName: parentName(snap, entity.parentId), qty: qty ?? null, qtyBefore: entity.quantity },
      (tx) => withdraw(tx, entity.id, qty),
      { success: t('toast.withdrawn', { name: entity.name }) },
    )
    if (r.ok) setPending(null)
  }

  const actions = {
    withdraw: async () => {
      if (tracked) return setPending({ kind: 'withdraw' })
      const kids = liveChildCount(snap, entity.id)
      if (kids > 0 && !(await confirm({ title: t('withdraw.containerTitle'), body: t('withdraw.containerBody', { count: kids }) }))) return
      await doWithdraw()
    },
    move: () => setPicker('move'),
    putBack: () => setPicker('putBack'),
    restock: () => setPending({ kind: 'restock' }),
    adjust: () => setPending({ kind: 'adjust' }),
    toggleTracking: async () => {
      if (tracked) {
        if (!(await confirm({ title: t('qty.stopTitle'), body: t('qty.stopBody') }))) return
        await commit('adjust', { ...base, qtyBefore: entity.quantity, qtyAfter: null }, (tx) => setQuantity(tx, entity.id, null), {
          success: t('toast.saved'),
        })
      } else setPending({ kind: 'track' })
    },
  }

  const dialogs = (
    <>
      <PlacePicker
        open={picker !== null}
        title={picker === 'putBack' ? t('action.putBackTo', { name: entity.name }) : t('action.moveTo', { name: entity.name })}
        movingId={entity.id}
        locationsOnly={entity.kind === 'location'}
        initialId={entity.parentId}
        onClose={() => setPicker(null)}
        onPick={async (target) => {
          const mode = picker
          setPicker(null)
          if (mode === 'putBack') {
            await commit(
              'putIn',
              { ...base, toId: target, toName: parentName(snap, target) },
              (tx) => putIn(tx, entity.id, { targetId: target }),
              { success: t('toast.putBack', { name: entity.name }) },
            )
          } else if (tracked && (entity.quantity ?? 0) > 1 && entity.state === 'in' && !entity.canContain) {
            setPending({ kind: 'move', target })
          } else {
            await doMove(target)
          }
        }}
      />
      <QtyDialog
        open={pending !== null}
        title={
          pending?.kind === 'withdraw'
            ? t('action.withdrawQty', { name: entity.name })
            : pending?.kind === 'move'
              ? t('action.moveQty', { name: entity.name })
              : pending?.kind === 'restock'
                ? t('action.restockQty', { name: entity.name })
                : pending?.kind === 'track'
                  ? t('qty.startTitle')
                  : t('action.adjustQty', { name: entity.name })
        }
        initial={pending?.kind === 'move' ? (entity.quantity ?? 1) : pending?.kind === 'adjust' ? (entity.quantity ?? 0) : pending?.kind === 'track' ? 1 : 1}
        min={pending?.kind === 'adjust' || pending?.kind === 'track' ? 0 : 1}
        max={pending?.kind === 'withdraw' || pending?.kind === 'move' ? (entity.quantity ?? undefined) : undefined}
        helper={pending?.kind === 'track' ? t('qty.startHelp') : pending?.kind === 'withdraw' ? t('qty.current', { qty: entity.quantity ?? 0 }) : undefined}
        onClose={() => setPending(null)}
        onSubmit={async (n) => {
          const p = pending
          if (!p) return
          if (p.kind === 'withdraw') return doWithdraw(n)
          if (p.kind === 'move') return doMove(p.target, n === entity.quantity ? undefined : n)
          const r =
            p.kind === 'restock'
              ? await commit('putIn', { ...base, qty: n, qtyBefore: entity.quantity }, (tx) => putIn(tx, entity.id, { qty: n }), {
                  success: t('toast.restocked', { name: entity.name, qty: n }),
                })
              : await commit('adjust', { ...base, qtyBefore: entity.quantity, qtyAfter: n }, (tx) => setQuantity(tx, entity.id, n), {
                  success: t('toast.saved'),
                })
          if (r.ok) setPending(null)
        }}
      />
    </>
  )

  return { actions, dialogs, tracked }
}

export function ItemQuickActions({ entity }: { entity: Entity }) {
  const t = useT()
  const { actions, dialogs } = useEntityActions(entity)
  return (
    <Stack direction="row" spacing={1}>
      {entity.state === 'in' ? (
        <Button size="small" variant="outlined" startIcon={<Icon name="withdraw" size={16} />} onClick={() => void actions.withdraw()} disabled={entity.quantity === 0}>
          {t('action.withdraw')}
        </Button>
      ) : (
        <Button size="small" variant="outlined" startIcon={<Icon name="upload" size={16} />} onClick={actions.putBack}>
          {t('action.putBack')}
        </Button>
      )}
      <Button size="small" variant="outlined" startIcon={<Icon name="move" size={16} />} onClick={actions.move}>
        {t('action.move')}
      </Button>
      {dialogs}
    </Stack>
  )
}

// ───────────────────────── 详情页 ─────────────────────────

function EditDialog({ entity, open, onClose }: { entity: Entity; open: boolean; onClose: () => void }) {
  const t = useT()
  const { commit } = useCommit()
  const init = () => ({ name: entity.name, category: entity.category ?? '', unit: entity.unit ?? '', note: entity.note ?? '', expiresAt: entity.expiresAt ?? '' })
  const [f, setF] = useState(init)
  const reset = () => setF(init())
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" slotProps={{ transition: { onEnter: reset } }}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const r = await commit('update', { entityId: entity.id, entityName: f.name }, (tx) => updateEntity(tx, entity.id, entity.kind === 'item' ? { ...f, expiresAt: f.expiresAt || null } : { name: f.name, note: f.note }), { success: t('toast.saved') })
          if (r.ok) onClose()
        }}
      >
        <DialogTitle>{t('common.edit')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label={t('field.name')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
            {entity.kind === 'item' && (
              <>
                <Stack direction="row" spacing={1}>
                  <Box sx={{ flex: 1 }}>
                    <CategoryField value={f.category} onChange={(category) => setF({ ...f, category })} />
                  </Box>
                  <TextField label={t('field.unit')} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} sx={{ maxWidth: 120 }} />
                </Stack>
                <ExpiryField value={f.expiresAt} onChange={(expiresAt) => setF({ ...f, expiresAt })} />
              </>
            )}
            <TextField label={t('field.note')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} multiline minRows={3} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!f.name.trim()}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

function SwitchRow({ label, help, checked, onChange, disabled }: { label: ReactNode; help?: ReactNode; checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <ListItem secondaryAction={<Switch edge="end" checked={checked} onChange={onChange} disabled={disabled} slotProps={{ input: { 'aria-label': String(label) } }} />}>
      <ListItemText primary={label} secondary={help} />
    </ListItem>
  )
}

function CoverActions({ entity }: { entity: Entity }) {
  const t = useT()
  const { commit } = useCommit()
  const { missing } = useFileUrl(entity.coverId)
  const [adding, setAdding] = useState(false)
  return (
    <>
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" startIcon={<Icon name="camera" size={16} />} onClick={() => setAdding(true)}>
          {entity.coverId ? t('cover.change') : t('cover.add')}
        </Button>
        {entity.coverId && (
          <Button
            size="small"
            onClick={() =>
              void commit('update', { entityId: entity.id, entityName: entity.name }, (tx) => setCover(tx, entity.id, null), {
                success: t('cover.removed'),
              })
            }
          >
            {t('cover.remove')}
          </Button>
        )}
      </Stack>
      {entity.coverId && missing && (
        <Typography variant="caption" color="warning.main">
          {t('cover.missing')}
        </Typography>
      )}
      <AttachmentAddDialog open={adding} entityId={entity.id} asCover onClose={() => setAdding(false)} />
    </>
  )
}

function DetailRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.75, alignItems: 'baseline' }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, flex: 1, wordBreak: 'break-word' }}>{children}</Box>
    </Stack>
  )
}

/** 详细信息：录入时间、有效期、分类、备注。 */
function Details({ entity, onEdit }: { entity: Entity; onEdit: () => void }) {
  const t = useT()
  const { lang } = useI18n()
  return (
    <Card sx={{ px: 2, py: 1 }}>
      <DetailRow label={t('detail.createdAt')}>
        <Typography variant="body2">{formatDateTime(entity.createdAt, lang)}</Typography>
      </DetailRow>
      {entity.updatedAt - entity.createdAt > 60_000 && (
        <DetailRow label={t('detail.updatedAt')}>
          <Typography variant="body2">{formatDateTime(entity.updatedAt, lang)}</Typography>
        </DetailRow>
      )}
      {entity.kind === 'item' && (
        <DetailRow label={t('expiry.label')}>
          {entity.expiresAt ? (
            <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="body2">{entity.expiresAt}</Typography>
              <ExpiryChip entity={entity} always />
            </Stack>
          ) : (
            <Link component="button" variant="body2" onClick={onEdit}>
              {t('expiry.set')}
            </Link>
          )}
        </DetailRow>
      )}
      {entity.category && (
        <DetailRow label={t('field.category')}>
          <Typography variant="body2">{entity.category}</Typography>
        </DetailRow>
      )}
      {entity.note && (
        <DetailRow label={t('field.note')}>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {entity.note}
          </Typography>
        </DetailRow>
      )}
    </Card>
  )
}

/** 产品信息：联网查到并保存在型号上的品牌、型号等；可重新查询，并可用作名称/分类。 */
function ProductInfoBlock({ entity }: { entity: Entity }) {
  const t = useT()
  const { lang } = useI18n()
  const snap = useSnap()
  const { commit } = useCommit()
  const { toast } = useFeedback()
  const { productLookup } = useSettings()
  const [busy, setBusy] = useState(false)
  const type = entity.typeId ? snap.types[entity.typeId] : undefined
  const p = type?.product
  const code = type?.barcodes[0]
  if (!type || (!p && !code)) return null

  async function refresh() {
    if (!code || !type) return
    setBusy(true)
    const r = await lookupProduct(parseProductCode(code)!, lang, { force: true })
    setBusy(false)
    if (r.status !== 'found' || !r.info) {
      toast(t(`lookup.${r.status}` as UiKey), { severity: r.status === 'rateLimited' ? 'warning' : 'info' })
      return
    }
    const info = r.info
    await commit('update', { entityId: entity.id, entityName: entity.name }, (tx) =>
      setProductDetails(tx, type.id, { name: info.name, brand: info.brand, model: info.model, category: info.category, source: info.source, at: Date.now() }),
    { success: t('product.saved') })
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {t('product.title')}
      </Typography>
      {p ? (
        <>
          {p.name && <DetailRow label={t('product.name')}><Typography variant="body2">{p.name}</Typography></DetailRow>}
          {p.brand && <DetailRow label={t('product.brand')}><Typography variant="body2">{p.brand}</Typography></DetailRow>}
          {p.model && <DetailRow label={t('product.model')}><Typography variant="body2">{p.model}</Typography></DetailRow>}
          {p.category && <DetailRow label={t('field.category')}><Typography variant="body2">{p.category}</Typography></DetailRow>}
          <Typography variant="caption" color="text.secondary">
            {t('product.sourceAt', { source: p.source && hasKey(`lookup.src.${p.source}`) ? t(`lookup.src.${p.source}` as UiKey) : (p.source ?? '—'), at: formatDateTime(p.at, lang) })}
          </Typography>
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mt: 1 }}>
            {p.name && p.name !== entity.name && (
              <Button size="small" variant="outlined" onClick={() => void commit('update', { entityId: entity.id, entityName: p.name }, (tx) => updateEntity(tx, entity.id, { name: p.name! }), { success: t('toast.saved') })}>
                {t('product.useName')}
              </Button>
            )}
            {p.category && p.category !== entity.category && (
              <Button size="small" variant="outlined" onClick={() => void commit('update', { entityId: entity.id, entityName: entity.name }, (tx) => updateEntity(tx, entity.id, { category: p.category! }), { success: t('toast.saved') })}>
                {t('product.useCategory', { category: p.category })}
              </Button>
            )}
          </Stack>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t('product.none')}
        </Typography>
      )}
      {code && productLookup && (
        <Button size="small" startIcon={<Icon name="search" size={16} />} onClick={() => void refresh()} disabled={busy} sx={{ mt: 1 }}>
          {busy ? t('lookup.loading') : p ? t('product.refresh') : t('product.lookup')}
        </Button>
      )}
    </Box>
  )
}

function BarcodeSection({ entity }: { entity: Entity }) {
  const t = useT()
  const snap = useSnap()
  const { commit } = useCommit()
  const { toast, confirm } = useFeedback()
  const [adding, setAdding] = useState(false)
  const type = entity.typeId ? snap.types[entity.typeId] : undefined
  const others = type ? stocksOfType(snap, type.id).filter((s) => s.id !== entity.id) : []
  return (
    <Section title={t('product.sectionTitle')}>
      <Card sx={{ p: 2 }}>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {type?.barcodes.map((c) => (
            <Chip
              key={c}
              label={displayProductCode(c)}
              variant="outlined"
              onDelete={() => void commit('update', { entityId: entity.id, entityName: entity.name }, (tx) => removeBarcode(tx, type.id, c), { success: t('toast.saved') })}
            />
          ))}
          {!type?.barcodes.length && (
            <Typography variant="body2" color="text.secondary">
              {t('barcode.none')}
            </Typography>
          )}
          <Button size="small" startIcon={<Icon name="add" size={16} />} onClick={() => setAdding(true)}>
            {t('barcode.add')}
          </Button>
        </Stack>
        <ProductInfoBlock entity={entity} />
        {others.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {t('barcode.sameType')}
            </Typography>
            <List disablePadding dense>
              {others.map((o) => (
                <EntityRow key={o.id} snap={snap} entity={o} dense />
              ))}
            </List>
          </Box>
        )}
      </Card>
      <TextDialog
        open={adding}
        title={t('barcode.add')}
        label={t('barcode.label')}
        helper={t('barcode.help')}
        onClose={() => setAdding(false)}
        onSubmit={async (v) => {
          let p = parseProductCode(v)
          if (!p) {
            const fix = productCodeSuggestions(v)
            if (fix.length === 1 && (await confirm({ title: t('barcode.fixTitle'), body: t('barcode.fixBody', { raw: v.trim() }), confirmText: t('barcode.useCode', { code: fix[0] }) }))) {
              p = parseProductCode(fix[0])
            }
          }
          if (!p) {
            toast(t('err.barcode.invalid'), { severity: 'error' })
            return
          }
          const r = await commit('update', { entityId: entity.id, entityName: entity.name }, (tx) => addBarcode(tx, entity.id, p), { success: t('toast.saved') })
          if (r.ok) setAdding(false)
        }}
      />
    </Section>
  )
}

function LabelSection({ entity }: { entity: Entity }) {
  const t = useT()
  const snap = useSnap()
  const { commit } = useCommit()
  const { confirm, toast } = useFeedback()
  const [entering, setEntering] = useState(false)
  const labels = labelsOf(snap, entity.id)

  async function bindByCode(raw: string) {
    const code = raw.toUpperCase().replace(/[\s-]/g, '')
    const label = labelByCode(snap, code)
    if (!label) {
      toast(t('err.label.notFound'), { severity: 'error' })
      return
    }
    let force = false
    if (label.status === 'bound' && label.entityId && label.entityId !== entity.id) {
      const old = snap.entities[label.entityId]
      force = await confirm({ title: t('label.rebindTitle'), body: t('label.rebindBody', { code: formatLabelCode(code), name: old?.name ?? '?' }), danger: true })
      if (!force) return
    } else if (label.status === 'disabled') {
      force = await confirm({ title: t('label.reactivateTitle'), body: t('label.reactivateBody') })
      if (!force) return
    }
    const r = await commit('labelBind', { entityId: entity.id, entityName: entity.name, text: label.code }, (tx) => bindLabel(tx, label.id, entity.id, force), {
      success: t('label.bound', { code: formatLabelCode(label.code) }),
    })
    if (r.ok) setEntering(false)
  }

  async function newAndPrint() {
    const r = await commit(
      'labelBind',
      { entityId: entity.id, entityName: entity.name },
      (tx) => {
        const [l] = createLabels(tx, 1, newLabelGen(), `single-${tx.ctx.now}`)
        bindLabel(tx, l.id, entity.id)
        return l
      },
      { success: (l) => t('label.bound', { code: formatLabelCode(l.code) }) },
    )
    if (r.ok) navigate(`/print${q({ ids: r.out.id })}`)
  }

  return (
    <Section title={t('label.title')}>
      <Card sx={{ p: 2 }}>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {labels.map((l) => (
            <Chip key={l.id} icon={<Icon name="qr" size={16} />} label={formatLabelCode(l.code)} onClick={() => navigate(`/label/${l.id}`)} />
          ))}
          {!labels.length && (
            <Typography variant="body2" color="text.secondary">
              {t('label.none')}
            </Typography>
          )}
        </Stack>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
          <Button size="small" variant="outlined" startIcon={<Icon name="print" size={16} />} onClick={() => void newAndPrint()}>
            {t('label.newAndPrint')}
          </Button>
          <Button size="small" startIcon={<Icon name="qr" size={16} />} onClick={() => setEntering(true)}>
            {t('label.bindBlank')}
          </Button>
        </Stack>
      </Card>
      <TextDialog
        open={entering}
        title={t('label.bindBlank')}
        label={t('label.codeInput')}
        helper={t('label.codeHelp')}
        onClose={() => setEntering(false)}
        onSubmit={(v) => void bindByCode(v)}
      />
    </Section>
  )
}

function AttachmentSection({ entity }: { entity: Entity }) {
  const t = useT()
  const snap = useSnap()
  const [adding, setAdding] = useState(false)
  const list = attachmentsOf(snap, 'entity', entity.id)
  return (
    <Section
      title={t('att.section')}
      action={
        <Button size="small" startIcon={<Icon name="add" size={16} />} onClick={() => setAdding(true)}>
          {t('common.add')}
        </Button>
      }
    >
      {list.length ? (
        <Card>
          <List disablePadding>
            {list.map((a) => (
              <ListItemButton key={a.id} onClick={() => navigate(`/a/${a.id}`)} sx={{ gap: 1.5 }}>
                <Icon name={a.typeKey === 'photo' ? 'photo' : a.provider === 'external_url' ? 'link' : 'file'} />
                <ListItemText
                  primary={a.name}
                  secondary={`${t(`attType.${a.typeKey}`)}${entity.coverId === a.id ? ` · ${t('cover.current')}` : ''}`}
                  slotProps={{ primary: { sx: { wordBreak: 'break-word' } } }}
                />
              </ListItemButton>
            ))}
          </List>
        </Card>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t('att.noneForEntity')}
        </Typography>
      )}
      <AttachmentAddDialog open={adding} entityId={entity.id} onClose={() => setAdding(false)} />
    </Section>
  )
}

function History({ entity }: { entity: Entity }) {
  const t = useT()
  const { lang } = useI18n()
  const { ops } = useAppState()
  const mine = ops.filter((o) => o.summary.entityId === entity.id || o.changes.some((c) => c.id === entity.id)).slice(0, 8)
  if (!mine.length) return null
  return (
    <Section title={t('entity.history')}>
      <Card>
        <List dense disablePadding>
          {mine.map((o, i) => (
            <ListItem key={o.id} divider={i < mine.length - 1}>
              <ListItemText
                primary={describeOp(t, o)}
                secondary={`${formatTime(o.createdAt, lang)}${o.undoneBy ? ` · ${t('log.undone')}` : ''}`}
                slotProps={{ primary: { sx: { textDecoration: o.undoneBy ? 'line-through' : 'none', wordBreak: 'break-word' } } }}
              />
            </ListItem>
          ))}
        </List>
      </Card>
    </Section>
  )
}

function Contents({ entity }: { entity: Entity }) {
  const t = useT()
  const snap = useSnap()
  const [deep, setDeep] = useState(false)
  const list = deep ? descendants(snap, entity.id) : childrenOf(snap, entity.id)
  return (
    <Section
      title={t('entity.contents')}
      action={
        <ToggleButtonGroup size="small" exclusive value={deep ? 'deep' : 'here'} onChange={(_, v) => v && setDeep(v === 'deep')}>
          <ToggleButton value="here" sx={{ px: 1.25, py: 0.25 }}>
            {t('entity.levelHere')}
          </ToggleButton>
          <ToggleButton value="deep" sx={{ px: 1.25, py: 0.25 }}>
            {t('entity.levelDeep')}
          </ToggleButton>
        </ToggleButtonGroup>
      }
    >
      {list.length ? (
        <Card>
          <List disablePadding>
            {list.map((e) => (
              <Box key={e.id} sx={{ borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                <EntityRow snap={snap} entity={e} showPath={deep} />
              </Box>
            ))}
          </List>
        </Card>
      ) : (
        <EmptyState icon="archive" title={t('entity.emptyContents')} body={t('entity.emptyContentsBody')} />
      )}
    </Section>
  )
}

/** 位置外观：房间图标或照片封面（照片优先，取消封面不删照片）。 */
function Appearance({ entity, onChangeIcon }: { entity: Entity; onChangeIcon: () => void }) {
  const t = useT()
  const { lang } = useI18n()
  const icon = iconById(entity.iconKey)
  const name = icon ? iconLabel(icon, lang, (k) => (hasKey(`room.${k}`) ? t(`room.${k}` as UiKey) : k)) : t('icon.defaultPlace')
  return (
    <Section title={t('entity.appearance')}>
      <Card sx={{ p: 2 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <EntityAvatar entity={entity} size={56} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {entity.coverId ? t('cover.current') : name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('entity.appearanceHelp')}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mt: 1.5, alignItems: 'flex-start' }}>
          <Button size="small" variant="outlined" startIcon={<Icon name="room" size={16} />} onClick={onChangeIcon}>
            {t('icon.change')}
          </Button>
          <CoverActions entity={entity} />
        </Stack>
      </Card>
    </Section>
  )
}

export function EntityPage({ id }: { id: string }) {
  const t = useT()
  const snap = useSnap()
  const { commit } = useCommit()
  const { confirm } = useFeedback()
  const e = snap.entities[id]
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [iconOpen, setIconOpen] = useState(false)
  const [subOpen, setSubOpen] = useState(false)
  const [coverOpen, setCoverOpen] = useState(false)
  const fallbackBack = e?.parentId ? `/e/${e.parentId}` : e?.kind === 'location' ? '/places' : '/items'
  const actions = useEntityActions(e ?? ({ id, kind: 'item', quantity: null } as Entity))

  if (!e || e.deletedAt) {
    return (
      <>
        <PageHeader title={t('entity.missingTitle')} back="/" />
        <EmptyState icon="warning" title={t('entity.missingTitle')} body={t('entity.missingBody')} action={<Button onClick={() => navigate('/')}>{t('nav.home')}</Button>} />
      </>
    )
  }

  const isHolder = e.kind === 'location' || e.canContain
  const crumbs = ancestors(snap.entities, e.id)
  const out = e.kind === 'item' && isEffectivelyOut(snap.entities, e.id)

  async function remove() {
    const kids = liveChildCount(snap, e.id)
    if (kids > 0) {
      await confirm({ title: t('delete.blockedTitle'), body: t('err.delete.notEmpty', { count: kids }), confirmText: t('common.ok') })
      return
    }
    const ok = await confirm({
      title: t('delete.title', { name: e.name }),
      body: e.kind === 'item' ? t('delete.itemBody') : t('delete.locationBody'),
      confirmText: t('delete.confirm'),
      danger: true,
    })
    if (!ok) return
    const r = await commit('delete', { entityId: e.id, entityName: e.name, fromName: parentName(snap, e.parentId) }, (tx) => deleteEntity(tx, e.id), {
      success: t('toast.deleted', { name: e.name }),
    })
    if (r.ok) navigate(fallbackBack, { replace: true })
  }

  return (
    <>
      <PageHeader
        title={e.name}
        eyebrow={e.kind === 'location' ? (e.parentId ? t('entity.subLocation') : t('entity.room')) : e.canContain ? t('entity.container') : t('entity.item')}
        back={fallbackBack}
        actions={
          <IconButton aria-label={t('common.more')} onClick={(ev) => setMenu(ev.currentTarget)}>
            <Icon name="more" />
          </IconButton>
        }
      />
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => (setMenu(null), setEditing(true))}>
          <Icon name="edit" size={18} sx={{ mr: 1.5 }} />
          {t('common.edit')}
        </MenuItem>
        <MenuItem onClick={() => (setMenu(null), setIconOpen(true))}>
          <Icon name="photo" size={18} sx={{ mr: 1.5 }} />
          {t('icon.change')}
        </MenuItem>
        <MenuItem onClick={() => (setMenu(null), actions.actions.move())}>
          <Icon name="move" size={18} sx={{ mr: 1.5 }} />
          {t('action.move')}
        </MenuItem>
        {isHolder && (
          <MenuItem onClick={() => (setMenu(null), navigate(`/stocktake${q({ scope: e.id })}`))}>
            <Icon name="stocktake" size={18} sx={{ mr: 1.5 }} />
            {t('entity.countHere')}
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={() => (setMenu(null), void remove())} sx={{ color: 'error.main' }}>
          <Icon name="delete" size={18} sx={{ mr: 1.5 }} />
          {t('delete.menu')}
        </MenuItem>
      </Menu>

      <Page>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
          <EntityAvatar entity={e} size={76} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography variant="h2" sx={{ wordBreak: 'break-word', fontSize: 24 }}>
                {e.name}
              </Typography>
              <StateChips entity={e} />
            </Stack>
            {crumbs.length ? (
              <Breadcrumbs separator="›" sx={{ fontSize: 13, mt: 0.5, '& ol': { flexWrap: 'wrap' } }} aria-label={t('entity.path')}>
                {crumbs.map((c) => (
                  <Link key={c.id} component="button" underline="hover" color="text.secondary" onClick={() => navigate(`/e/${c.id}`)}>
                    {c.name}
                  </Link>
                ))}
              </Breadcrumbs>
            ) : (
              <PathLine snap={snap} entity={e} sx={{ mt: 0.5 }} />
            )}
            {out && crumbs.length > 0 && (
              <Typography variant="caption" color="warning.main">
                {t('entity.outNote')}
              </Typography>
            )}
            {e.kind === 'item' && (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('qty.label')}
                </Typography>
                <QtyText entity={e} />
              </Stack>
            )}
          </Box>
        </Stack>

        {e.kind === 'item' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 1 }}>
            {e.state === 'in' ? (
              <Button variant="contained" color="secondary" startIcon={<Icon name="withdraw" size={18} />} onClick={() => void actions.actions.withdraw()} disabled={e.quantity === 0}>
                {t('action.withdraw')}
              </Button>
            ) : (
              <Button variant="contained" color="secondary" startIcon={<Icon name="upload" size={18} />} onClick={actions.actions.putBack}>
                {t('action.putBack')}
              </Button>
            )}
            <Button variant="outlined" startIcon={<Icon name="move" size={18} />} onClick={actions.actions.move}>
              {t('action.move')}
            </Button>
            {actions.tracked && (
              <>
                <Button variant="outlined" startIcon={<Icon name="add" size={18} />} onClick={actions.actions.restock}>
                  {t('action.restock')}
                </Button>
                <Button variant="outlined" startIcon={<Icon name="edit" size={18} />} onClick={actions.actions.adjust}>
                  {t('action.adjust')}
                </Button>
              </>
            )}
          </Box>
        )}

        {isHolder && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 1 }}>
            <Button variant="contained" startIcon={<Icon name="add" size={18} />} onClick={() => navigate(`/add${q({ parent: e.id })}`)}>
              {t('entity.addItem')}
            </Button>
            <Button variant="outlined" startIcon={<Icon name="items" size={18} />} onClick={() => navigate(`/add${q({ parent: e.id, continuous: 1 })}`)}>
              {t('home.addMany')}
            </Button>
            {e.kind === 'location' && (
              <Button variant="outlined" startIcon={<Icon name="room" size={18} />} onClick={() => setSubOpen(true)}>
                {t('entity.addSub')}
              </Button>
            )}
            <Button variant="outlined" startIcon={<Icon name="scan" size={18} />} onClick={() => navigate(`/scan${q({ mode: 'batch', op: 'putIn', target: e.id })}`)}>
              {t('entity.scanIn')}
            </Button>
            <Button variant="outlined" startIcon={<Icon name="search" size={18} />} onClick={() => navigate(`/search${q({ scope: e.id })}`)}>
              {t('entity.searchHere')}
            </Button>
          </Box>
        )}

        <Details entity={e} onEdit={() => setEditing(true)} />

        {isHolder && <Contents entity={e} />}
        {e.kind === 'location' && <Appearance entity={e} onChangeIcon={() => setIconOpen(true)} />}

        {e.kind === 'item' && (
          <Section title={t('entity.settings')}>
            <Card>
              <List disablePadding>
                <SwitchRow
                  label={t('qty.tracking')}
                  help={actions.tracked ? t('qty.trackingOn') : t('qty.trackingOff')}
                  checked={actions.tracked}
                  onChange={() => void actions.actions.toggleTracking()}
                />
                <Divider component="li" />
                <SwitchRow
                  label={t('entity.containerSwitch')}
                  help={t('entity.containerHelp')}
                  checked={e.canContain}
                  onChange={() =>
                    void commit(e.canContain ? 'containerOff' : 'containerOn', { entityId: e.id, entityName: e.name }, (tx) => setContainer(tx, e.id, !e.canContain), {
                      success: t('toast.saved'),
                    })
                  }
                />
                {e.category && (
                  <>
                    <Divider component="li" />
                    <ListItem>
                      <ListItemText primary={t('field.category')} secondary={e.category} />
                    </ListItem>
                  </>
                )}
              </List>
            </Card>
            <Box sx={{ mt: 1.5 }}>
              <CoverActions entity={e} />
            </Box>
          </Section>
        )}

        {e.kind === 'item' && <BarcodeSection entity={e} />}
        <LabelSection entity={e} />
        <AttachmentSection entity={e} />
        <History entity={e} />
      </Page>

      {actions.dialogs}
      <EditDialog entity={e} open={editing} onClose={() => setEditing(false)} />
      <IconPicker
        open={iconOpen}
        value={e.iconKey}
        sets={e.kind === 'location' ? ['rooms', 'items'] : ['items']}
        title={e.kind === 'location' ? t('icon.pickPlace') : undefined}
        onPhoto={() => {
          setIconOpen(false)
          setCoverOpen(true)
        }}
        onClose={() => setIconOpen(false)}
        onPick={async (key) => {
          const r = await commit('update', { entityId: e.id, entityName: e.name }, (tx) => updateEntity(tx, e.id, { iconKey: key }), { success: t('toast.saved') })
          if (r.ok) setIconOpen(false)
        }}
      />
      <AttachmentAddDialog open={coverOpen} entityId={e.id} asCover onClose={() => setCoverOpen(false)} />
      <NewPlaceDialog
        open={subOpen}
        title={t('entity.addSub')}
        label={t('places.subName')}
        onClose={() => setSubOpen(false)}
        onSubmit={async (name, iconKey) => {
          const r = await commit<Entity>('create', (c: Entity) => ({ entityId: c.id, entityName: c.name, toId: e.id, toName: e.name }), (tx) => createEntity(tx, { kind: 'location', name, parentId: e.id, iconKey }), {
            success: (c) => t('toast.created', { name: c.name }),
          })
          if (r.ok) setSubOpen(false)
        }}
      />
    </>
  )
}
