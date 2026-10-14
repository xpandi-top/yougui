import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import {
  BATCH_MAX,
  LineError,
  addLine,
  bindLabel,
  classifyScan,
  commitBatch,
  createEntity,
  findTypeByBarcode,
  formatLabelCode,
  labelByCode,
  labelByToken,
  lineForEntity,
  pathNames,
  PATH_SEP,
  resolveScan,
  stocksOfType,
  type BatchLine,
  type BatchOp,
  type Entity,
  type Label,
  type ProductCode,
  type Resolution,
  type ScanResult,
} from '../../core/index.ts'
import { errorText, useT, type UiKey } from '../../context/i18n.tsx'
import { useFeedback } from '../../context/feedback.tsx'
import { useSnap, useStore } from '../../context/store.tsx'
import { useCommit } from '../../hooks/useCommit.ts'
import { navigate, q, useRoute } from '../../hooks/useRoute.ts'
import { beep } from '../../lib/scanner.ts'
import { CameraView } from '../ui/CameraView.tsx'
import { getSettings, readJSON, writeJSON } from '../../lib/settings.ts'
import { newId } from '../../lib/store.ts'
import { EntityPicker, QtyDialog, TextDialog } from '../dialogs/Basic.tsx'
import { PlacePicker } from '../dialogs/PlacePicker.tsx'
import { ProductNameDialog } from '../dialogs/ProductNameDialog.tsx'
import { EntityRow } from '../ui/EntityBits.tsx'
import { Icon } from '../ui/Icon.tsx'
import { Card, PageHeader } from '../ui/Layout.tsx'

type Mode = 'single' | 'batch'
type Tone = 'ok' | 'warn' | 'error'
interface Feedback {
  tone: Tone
  text: string
  at: number
}

const DRAFT_KEY = 'yg-scan-draft-v1'
interface Draft {
  op: BatchOp
  targetId: string | null | undefined
  lines: BatchLine[]
}

type Ask =
  | { kind: 'holder'; entity: Entity; scan: ScanResult }
  | { kind: 'source'; candidates: Entity[] }
  | { kind: 'unknownProduct'; product: ProductCode }
  | { kind: 'blank'; label: Label; scan: ScanResult }
  | { kind: 'singleStocks'; list: Entity[] }
  | { kind: 'switchTarget'; target: string | null }
  | { kind: 'fixCode'; raw: string; suggestions: string[] }

export default function ScanPage() {
  const t = useT()
  const snap = useSnap()
  const store = useStore()
  const { commit } = useCommit()
  const { confirm } = useFeedback()
  const { query } = useRoute()
  const draft = readJSON<Draft>(DRAFT_KEY, { op: 'putIn', targetId: undefined, lines: [] })
  const qTarget = query.get('target')
  const [mode, setMode] = useState<Mode>(query.get('mode') === 'batch' ? 'batch' : 'single')
  const [op, setOp] = useState<BatchOp>((query.get('op') as BatchOp | null) ?? draft.op)
  const [targetId, setTargetId] = useState<string | null | undefined>(qTarget ?? draft.targetId)
  const [lines, setLines] = useState<BatchLine[]>(qTarget && qTarget !== draft.targetId ? [] : draft.lines)
  const [fb, setFb] = useState<Feedback | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [picking, setPicking] = useState(false)
  const [manual, setManual] = useState('')
  const [editLine, setEditLine] = useState<BatchLine | null>(null)
  const [lineErr, setLineErr] = useState<{ key: string; text: string } | null>(null)
  const [binding, setBinding] = useState<'existing' | 'new' | null>(null)
  const [newName, setNewName] = useState(false)

  useEffect(() => {
    writeJSON(DRAFT_KEY, { op, targetId, lines } satisfies Draft)
  }, [op, targetId, lines])

  const say = (tone: Tone, text: string) => {
    setFb({ tone, text, at: Date.now() })
    if (tone === 'ok' && getSettings().scanSound) beep()
  }

  const target = targetId ? snap.entities[targetId] : null
  const targetText = targetId === undefined ? null : targetId === null ? t('path.unassigned') : target ? [...pathNames(snap.entities, target.id), target.name].join(PATH_SEP) : '?'

  // ───────────── 普通模式 ─────────────
  function handleSingle(scan: ScanResult, raw: string) {
    if (scan.kind === 'label' || scan.kind === 'code') {
      const label = scan.kind === 'label' ? labelByToken(snap, scan.token) : labelByCode(snap, scan.code)
      if (!label) return say('warn', t('scan.info.unknownLabel'))
      if (label.status === 'bound' && label.entityId && snap.entities[label.entityId] && !snap.entities[label.entityId].deletedAt) {
        return navigate(`/e/${label.entityId}`)
      }
      if (label.status === 'disabled') return say('warn', t('scan.info.labelDisabled'))
      return navigate(`/label/${label.id}`)
    }
    if (scan.kind === 'product') {
      const type = findTypeByBarcode(snap, scan.product.normalized)
      const stocks = type ? stocksOfType(snap, type.id) : []
      if (stocks.length === 1) return navigate(`/e/${stocks[0].id}`)
      if (stocks.length > 1) return setAsk({ kind: 'singleStocks', list: stocks })
      say('ok', t('scan.unknownProductCreate'))
      return navigate(`/add${q({ barcode: scan.product.raw })}`)
    }
    if (scan.kind === 'invalidProduct') return say('error', t('err.barcode.invalid'))
    if (raw.trim() && !/^https?:/i.test(raw.trim())) return navigate(`/search${q({ q: raw.trim() })}`)
    say('error', t('scan.info.unknownCode'))
  }

  // ───────────── 连续模式 ─────────────
  const applyResolution = (r: Resolution, scan: ScanResult) => {
    switch (r.kind) {
      case 'lines':
        setLines(r.lines)
        setLineErr(null)
        say('ok', r.line.qty !== null ? t('scan.addedQty', { name: r.line.name, qty: r.line.qty }) : t('scan.added', { name: r.line.name }))
        return
      case 'info':
        say(r.code === 'unknownCode' || r.code === 'invalidProduct' ? 'error' : 'warn', t(`scan.info.${r.code}` as UiKey, { name: r.name ?? '', max: BATCH_MAX }))
        return
      case 'holder': {
        const e = r.entity
        if (op === 'withdraw') {
          if (e.kind === 'location') return say('warn', t('err.withdraw.location'))
          return applyResolution(resolveScan(snap, op, targetId, lines, scan, true), scan)
        }
        if (targetId === undefined) {
          setTargetId(e.id)
          return say('ok', t('scan.targetSet', { name: e.name }))
        }
        if (e.id === targetId) return say('warn', t('scan.info.alreadyTarget', { name: e.name }))
        setAsk({ kind: 'holder', entity: e, scan })
        return
      }
      case 'chooseSource':
        setAsk({ kind: 'source', candidates: r.candidates })
        return
      case 'unknownProduct':
        if (op !== 'putIn') return say('warn', t('scan.info.unknownProductOther'))
        setAsk({ kind: 'unknownProduct', product: r.product })
        return
      case 'blankLabel':
        setAsk({ kind: 'blank', label: r.label, scan })
        return
    }
  }

  const onCode = (raw: string) => {
    if (ask || picking || editLine || binding || newName) return
    processCode(raw)
  }

  function processCode(raw: string) {
    const scan = classifyScan(raw)
    // 手输 11 位：多半漏了条外小号的校验位或前导 0，先让用户确认补全后的商品码
    if (scan.kind === 'invalidProduct' && scan.suggestions.length) return setAsk({ kind: 'fixCode', raw: scan.raw, suggestions: scan.suggestions })
    if (mode === 'single') return handleSingle(scan, raw)
    applyResolution(resolveScan(snap, op, targetId, lines, scan), scan)
  }

  async function changeTarget(next: string | null) {
    if (lines.length && next !== targetId) {
      setAsk({ kind: 'switchTarget', target: next })
      return
    }
    setTargetId(next)
  }

  async function changeOp(next: BatchOp) {
    if (next === op) return
    if (lines.length && !(await confirm({ title: t('scan.switchOpTitle'), body: t('scan.switchOpBody', { count: lines.length }), danger: true }))) return
    setLines([])
    setOp(next)
  }

  async function submit(): Promise<boolean> {
    if (!lines.length) return true
    if (op !== 'withdraw' && targetId === undefined) {
      say('warn', t('scan.info.needTarget'))
      return false
    }
    const batchId = newId()
    const r = await commit(
      'batch',
      { count: lines.length, toId: targetId ?? null, toName: target?.name ?? null, text: op },
      (tx) => commitBatch(tx, op, targetId ?? null, lines),
      { batchId, success: t('scan.committed', { count: lines.length }), silent: true },
    )
    if (r.ok) {
      setLines([])
      setLineErr(null)
      say('ok', t('scan.committed', { count: r.out }))
      return true
    }
    if (r.error instanceof LineError) {
      setLineErr({ key: r.error.lineKey, text: errorText(t, r.error.inner) })
      say('error', t('scan.commitFailed', { name: r.error.lineName }))
    } else {
      say('error', errorText(t, r.error))
    }
    return false
  }

  async function bindBlank(label: Label, scan: ScanResult, entityId: string) {
    const r = await commit('labelBind', { entityId, entityName: snap.entities[entityId]?.name, text: label.code }, (tx) => bindLabel(tx, label.id, entityId), {
      success: t('label.bound', { code: formatLabelCode(label.code) }),
    })
    setAsk(null)
    setBinding(null)
    if (r.ok) applyResolution(resolveScan(store.getState().snap, op, targetId, lines, scan), scan)
  }

  const fbColor = fb?.tone === 'ok' ? 'success' : fb?.tone === 'warn' ? 'warning' : 'error'
  const dialogsOpen = !!ask || picking || !!editLine || !!binding || newName

  return (
    <>
      <PageHeader
        title={t('nav.scan')}
        actions={
          <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v: Mode | null) => v && setMode(v)} sx={{ mr: 1 }}>
            <ToggleButton value="single">{t('scan.mode.single')}</ToggleButton>
            <ToggleButton value="batch">{t('scan.mode.batch')}</ToggleButton>
          </ToggleButtonGroup>
        }
      />
      <Box sx={{ px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {mode === 'batch' && (
          <Stack spacing={1}>
            <ToggleButtonGroup fullWidth exclusive value={op} onChange={(_, v: BatchOp | null) => v && void changeOp(v)} color="secondary">
              {(['putIn', 'withdraw', 'move'] as const).map((o) => (
                <ToggleButton key={o} value={o} sx={{ py: 1 }}>
                  {t(`scan.op.${o}`)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            {op !== 'withdraw' && (
              <Button
                variant={targetId === undefined ? 'contained' : 'outlined'}
                onClick={() => setPicking(true)}
                startIcon={<Icon name="places" size={18} />}
                sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
              >
                <Box component="span" sx={{ wordBreak: 'break-word' }}>
                  {targetText ? t('scan.target', { path: targetText }) : t('scan.chooseTarget')}
                </Box>
              </Button>
            )}
            <Typography variant="caption" color="text.secondary">
              {t(`scan.opHelp.${op}`)}
            </Typography>
          </Stack>
        )}

        <CameraView active onCode={onCode} paused={dialogsOpen} />

        <Box aria-live="polite" sx={{ minHeight: 48 }}>
          {fb && (
            <Alert key={fb.at} severity={fbColor} variant="filled" sx={{ py: 0.25 }}>
              {fb.text}
            </Alert>
          )}
        </Box>

        <Stack
          component="form"
          direction="row"
          spacing={1}
          onSubmit={(e) => {
            e.preventDefault()
            if (manual.trim()) onCode(manual.trim())
            setManual('')
          }}
        >
          <TextField
            size="small"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            label={t('scan.manual')}
            placeholder={t('scan.manualPh')}
            slotProps={{ htmlInput: { autoCapitalize: 'characters', autoCorrect: 'off', enterKeyHint: 'go' } }}
          />
          <Button type="submit" variant="outlined" disabled={!manual.trim()}>
            {t('common.ok')}
          </Button>
        </Stack>

        {mode === 'batch' && (
          <Card>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle1">{t('scan.pending', { count: lines.length })}</Typography>
              {lines.length > 0 && (
                <Button
                  size="small"
                  color="error"
                  onClick={async () => {
                    if (await confirm({ title: t('scan.clearTitle'), body: t('scan.clearBody'), danger: true })) setLines([])
                  }}
                >
                  {t('scan.clear')}
                </Button>
              )}
            </Stack>
            {lines.length ? (
              <List dense disablePadding>
                {lines.map((l) => (
                  <ListItem
                    key={l.key}
                    divider
                    sx={{ bgcolor: lineErr?.key === l.key ? 'paper.warn' : undefined }}
                    secondaryAction={
                      <IconButton aria-label={t('common.remove')} onClick={() => setLines((s) => s.filter((x) => x.key !== l.key))}>
                        <Icon name="close" size={18} />
                      </IconButton>
                    }
                  >
                    <ListItemText
                      primary={`${l.name}${l.create ? ` · ${t('scan.newStock')}` : ''}`}
                      secondary={lineErr?.key === l.key ? lineErr.text : l.qty === null ? t('scan.whole') : undefined}
                      slotProps={{ secondary: { sx: { color: lineErr?.key === l.key ? 'error.main' : undefined } } }}
                    />
                    {l.qty !== null && (
                      <Button size="small" variant="outlined" onClick={() => setEditLine(l)} sx={{ mr: 1, minWidth: 56 }}>
                        ×{l.qty}
                      </Button>
                    )}
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                {t('scan.pendingEmpty')}
              </Typography>
            )}
            <Box sx={{ p: 1.5 }}>
              <Button fullWidth variant="contained" color="secondary" size="large" disabled={!lines.length} onClick={() => void submit()}>
                {t('scan.submit', { count: lines.length })}
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'center' }}>
                {t('scan.submitNote')}
              </Typography>
            </Box>
          </Card>
        )}
        {mode === 'single' && (
          <Typography variant="caption" color="text.secondary">
            {t('scan.singleHelp')}
          </Typography>
        )}
      </Box>

      <PlacePicker
        open={picking}
        title={t('scan.chooseTarget')}
        initialId={targetId ?? null}
        onClose={() => setPicking(false)}
        onPick={(id) => {
          setPicking(false)
          void changeTarget(id)
        }}
      />

      {/* 扫到另一个容器：更换目标还是作为待处理物品 */}
      <Dialog open={ask?.kind === 'holder'} onClose={() => setAsk(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{ask?.kind === 'holder' ? t('scan.holderTitle', { name: ask.entity.name }) : ''}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">{t('scan.holderBody')}</Typography>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setAsk(null)}>{t('common.cancel')}</Button>
          <Button
            variant="outlined"
            onClick={() => {
              if (ask?.kind !== 'holder') return
              const a = ask
              setAsk(null)
              void changeTarget(a.entity.id)
            }}
          >
            {t('scan.holderAsTarget')}
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              if (ask?.kind !== 'holder') return
              const a = ask
              setAsk(null)
              applyResolution(resolveScan(snap, op, targetId, lines, a.scan, true), a.scan)
            }}
          >
            {t('scan.holderAsItem')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 手输商品码少一位：确认补全 */}
      <Dialog open={ask?.kind === 'fixCode'} onClose={() => setAsk(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('barcode.fixTitle')}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">{ask?.kind === 'fixCode' ? t('barcode.fixBody', { raw: ask.raw }) : ''}</Typography>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setAsk(null)}>{t('common.cancel')}</Button>
          {ask?.kind === 'fixCode' &&
            ask.suggestions.map((code) => (
              <Button
                key={code}
                variant="contained"
                onClick={() => {
                  setAsk(null)
                  processCode(code)
                }}
              >
                {t('barcode.useCode', { code })}
              </Button>
            ))}
        </DialogActions>
      </Dialog>

      {/* 有待提交清单时更换目标 */}
      <Dialog open={ask?.kind === 'switchTarget'} onClose={() => setAsk(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('scan.switchTargetTitle')}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">{t('scan.switchTargetBody', { count: lines.length })}</Typography>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setAsk(null)}>{t('common.cancel')}</Button>
          <Button
            color="error"
            onClick={() => {
              if (ask?.kind !== 'switchTarget') return
              setLines([])
              setTargetId(ask.target)
              setAsk(null)
            }}
          >
            {t('scan.discardAndSwitch')}
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (ask?.kind !== 'switchTarget') return
              const next = ask.target
              setAsk(null)
              if (await submit()) setTargetId(next)
            }}
          >
            {t('scan.submitAndSwitch')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 同型号多处：必须选择来源，不猜测 */}
      <Dialog open={ask?.kind === 'source' || ask?.kind === 'singleStocks'} onClose={() => setAsk(null)} fullWidth maxWidth="sm">
        <DialogTitle>{ask?.kind === 'singleStocks' ? t('scan.stocksTitle') : t('scan.sourceTitle')}</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <List disablePadding>
            {(ask?.kind === 'source' ? ask.candidates : ask?.kind === 'singleStocks' ? ask.list : []).map((c) => (
              <EntityRow
                key={c.id}
                snap={snap}
                entity={c}
                onClick={() => {
                  if (ask?.kind === 'singleStocks') {
                    setAsk(null)
                    navigate(`/e/${c.id}`)
                    return
                  }
                  setAsk(null)
                  applyResolution(addLine(lines, lineForEntity(c, op)), { kind: 'unknown', text: '' })
                }}
              />
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAsk(null)}>{t('common.cancel')}</Button>
        </DialogActions>
      </Dialog>

      {/* 未知商品码：入库时极简创建（自动查询商品名作为建议） */}
      <ProductNameDialog
        product={ask?.kind === 'unknownProduct' ? ask.product : null}
        onClose={() => setAsk(null)}
        onSubmit={(name, details) => {
          if (ask?.kind !== 'unknownProduct') return
          const p = ask.product
          setAsk(null)
          applyResolution(addLine(lines, { key: `p:${p.normalized}`, name: name.trim(), create: { product: p, details }, qty: 1 }), { kind: 'product', product: p })
        }}
      />

      {/* 空白标签：暂停，绑定后继续 */}
      <Dialog open={ask?.kind === 'blank' && !binding && !newName} onClose={() => setAsk(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{ask?.kind === 'blank' ? t('scan.blankTitle', { code: formatLabelCode(ask.label.code) }) : ''}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">{t('scan.blankBody')}</Typography>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setAsk(null)}>{t('common.cancel')}</Button>
          <Button variant="outlined" onClick={() => setBinding('existing')}>
            {t('bind.existing')}
          </Button>
          <Button variant="contained" onClick={() => setNewName(true)}>
            {t('bind.newItem')}
          </Button>
        </DialogActions>
      </Dialog>
      <EntityPicker
        open={binding === 'existing'}
        title={t('bind.existing')}
        onClose={() => setBinding(null)}
        onPick={([id]) => {
          if (ask?.kind === 'blank' && id) void bindBlank(ask.label, ask.scan, id)
        }}
      />
      <TextDialog
        open={newName}
        title={t('bind.newItem')}
        label={t('field.name')}
        helper={targetText ? t('bind.newItemAt', { path: targetText }) : t('bind.newItemUnassigned')}
        onClose={() => setNewName(false)}
        onSubmit={async (name) => {
          if (ask?.kind !== 'blank') return
          const a = ask
          const r = await commit<Entity>(
            'labelBind',
            (e: Entity) => ({ entityId: e.id, entityName: e.name, text: a.label.code }),
            (tx) => {
              const e = createEntity(tx, { kind: 'item', name, parentId: op === 'withdraw' ? null : (targetId ?? null) })
              bindLabel(tx, a.label.id, e.id)
              return e
            },
            { success: (e) => t('toast.created', { name: e.name }) },
          )
          setNewName(false)
          setAsk(null)
          if (r.ok) say('ok', t('scan.boundNew', { name: r.out.name }))
        }}
      />

      <QtyDialog
        open={!!editLine}
        title={editLine ? t('scan.editQty', { name: editLine.name }) : ''}
        initial={editLine?.qty ?? 1}
        min={1}
        max={editLine?.entityId && op !== 'putIn' ? (snap.entities[editLine.entityId]?.quantity ?? undefined) : undefined}
        onClose={() => setEditLine(null)}
        onSubmit={(n) => {
          setLines((s) => s.map((l) => (l.key === editLine?.key ? { ...l, qty: n } : l)))
          setEditLine(null)
        }}
      />
    </>
  )
}
