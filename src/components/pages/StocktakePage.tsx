import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  LinearProgress,
  List,
  ListItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import {
  DomainError,
  applyCount,
  buildCount,
  classifyScan,
  diffCount,
  findTypeByBarcode,
  labelByCode,
  labelByToken,
  PATH_SEP,
  type CountEntry,
  type CountLine,
} from '../../core/index.ts'
import { errorText, useT } from '../../context/i18n.tsx'
import { useFeedback } from '../../context/feedback.tsx'
import { useSnap } from '../../context/store.tsx'
import { useCommit } from '../../hooks/useCommit.ts'
import { navigate, useRoute } from '../../hooks/useRoute.ts'
import { readJSON, writeJSON } from '../../lib/settings.ts'
import { PlacePicker } from '../dialogs/PlacePicker.tsx'
import { CameraView } from '../ui/CameraView.tsx'
import { Icon } from '../ui/Icon.tsx'
import { Card, EmptyState, Page, PageHeader, Section } from '../ui/Layout.tsx'

const DRAFT_KEY = 'yg-count-draft-v1'

interface Session {
  scopeId: string | null
  deep: boolean
  lines: CountLine[]
  entries: Record<string, CountEntry>
  startedAt: number
}

type Step = 'setup' | 'count' | 'review'

export default function StocktakePage() {
  const t = useT()
  const snap = useSnap()
  const { commit } = useCommit()
  const { confirm, toast } = useFeedback()
  const { query } = useRoute()
  const saved = readJSON<Session | null>(DRAFT_KEY, null)
  const [session, setSession] = useState<Session | null>(saved)
  const [step, setStep] = useState<Step>(saved ? 'count' : 'setup')
  const [scopeId, setScopeId] = useState<string | null>(query.get('scope'))
  const [deep, setDeep] = useState(true)
  const [picking, setPicking] = useState(false)
  const [filter, setFilter] = useState<'all' | 'todo'>('all')
  const [scanning, setScanning] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null)
  const [stale, setStale] = useState('')

  useEffect(() => {
    if (session) writeJSON(DRAFT_KEY, session)
    else localStorage.removeItem(DRAFT_KEY)
  }, [session])

  const rows = useMemo(() => (session ? diffCount(session.lines, session.entries) : []), [session])
  const checked = rows.filter((r) => r.kind !== 'unchecked').length

  function start() {
    const lines = buildCount(snap, scopeId, deep)
    setSession({ scopeId, deep, lines, entries: {}, startedAt: Date.now() })
    setStep('count')
    setStale('')
  }

  function setEntry(id: string, e: CountEntry | null) {
    setSession((s) => {
      if (!s) return s
      const entries = { ...s.entries }
      if (e) entries[id] = e
      else delete entries[id]
      return { ...s, entries }
    })
  }

  function onScan(raw: string) {
    if (!session) return
    const scan = classifyScan(raw)
    const inScope = new Map(session.lines.map((l) => [l.entityId, l]))
    if (scan.kind === 'label' || scan.kind === 'code') {
      const label = scan.kind === 'label' ? labelByToken(snap, scan.token) : labelByCode(snap, scan.code)
      const line = label?.entityId ? inScope.get(label.entityId) : undefined
      if (!line) return setMsg({ tone: 'warning', text: t('count.notInScope') })
      // 同一码只算一次：实物标签只标记已见
      const cur = session.entries[line.entityId]
      if (cur?.seen) return setMsg({ tone: 'warning', text: t('count.alreadySeen', { name: line.name }) })
      setEntry(line.entityId, { ...cur, seen: true, missing: false })
      return setMsg({ tone: 'success', text: line.expected === null ? t('count.seen', { name: line.name }) : t('count.seenEnterQty', { name: line.name }) })
    }
    if (scan.kind === 'product') {
      const type = findTypeByBarcode(snap, scan.product.normalized)
      const matches = session.lines.filter((l) => type && snap.entities[l.entityId]?.typeId === type.id)
      if (matches.length !== 1) return setMsg({ tone: 'warning', text: matches.length ? t('count.multiMatch') : t('count.notInScope') })
      const l = matches[0]
      if (l.expected === null) {
        setEntry(l.entityId, { seen: true })
        return setMsg({ tone: 'success', text: t('count.seen', { name: l.name }) })
      }
      const n = (session.entries[l.entityId]?.actual ?? 0) + 1
      setEntry(l.entityId, { actual: n, seen: true })
      return setMsg({ tone: 'success', text: t('count.plusOne', { name: l.name, qty: n }) })
    }
    setMsg({ tone: 'warning', text: t('scan.info.unknownCode') })
  }

  async function finish() {
    if (!session) return
    const changes = rows.filter((r) => r.kind === 'qty' || r.kind === 'missing')
    const scopeName = session.scopeId ? (snap.entities[session.scopeId]?.name ?? '?') : t('count.wholeHome')
    const r = await commit('stocktake', { entityId: session.scopeId ?? undefined, entityName: scopeName, count: changes.length }, (tx) => applyCount(tx, rows), {
      success: (n) => t('count.saved', { count: n }),
      silent: true,
    })
    if (r.ok) {
      setSession(null)
      setStep('setup')
      if (session.scopeId) navigate(`/e/${session.scopeId}`, { replace: true })
    } else if (r.error instanceof DomainError && r.error.code === 'stocktake.changed') {
      setStale(errorText(t, r.error))
    } else {
      toast(errorText(t, r.error), { severity: 'error' })
    }
  }

  /** 盘点期间库存变化：重建快照并保留已录入的值，重新复核。 */
  function rebuild() {
    if (!session) return
    const lines = buildCount(snap, session.scopeId, session.deep)
    const ids = new Set(lines.map((l) => l.entityId))
    const entries = Object.fromEntries(Object.entries(session.entries).filter(([id]) => ids.has(id)))
    setSession({ ...session, lines, entries })
    setStale('')
    setStep('count')
    toast(t('count.rebuilt'), { severity: 'info' })
  }

  async function abandon() {
    if (await confirm({ title: t('count.abandonTitle'), body: t('count.abandonBody'), danger: true })) {
      setSession(null)
      setStep('setup')
    }
  }

  const scopeName = (id: string | null) => (id ? (snap.entities[id]?.name ?? '?') : t('count.wholeHome'))

  if (step === 'setup' || !session) {
    return (
      <>
        <PageHeader title={t('count.title')} back="/more" />
        <Page>
          <Typography color="text.secondary">{t('count.intro')}</Typography>
          <Card sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t('count.scope')}
                </Typography>
                <Button fullWidth variant="outlined" onClick={() => setPicking(true)} startIcon={<Icon name="places" size={18} />} sx={{ justifyContent: 'flex-start', mt: 0.5 }}>
                  {scopeName(scopeId)}
                </Button>
                {scopeId && (
                  <Button size="small" onClick={() => setScopeId(null)}>
                    {t('count.useWholeHome')}
                  </Button>
                )}
              </Box>
              {scopeId && <FormControlLabel control={<Switch checked={deep} onChange={(e) => setDeep(e.target.checked)} />} label={t('count.includeChildren')} />}
              <Button variant="contained" color="secondary" size="large" onClick={start}>
                {t('count.start')}
              </Button>
            </Stack>
          </Card>
        </Page>
        <PlacePicker
          open={picking}
          title={t('count.scope')}
          allowRoot={false}
          initialId={scopeId}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setScopeId(id)
            setPicking(false)
          }}
        />
      </>
    )
  }

  if (step === 'review') {
    const qty = rows.filter((r) => r.kind === 'qty')
    const missing = rows.filter((r) => r.kind === 'missing')
    const unchecked = rows.filter((r) => r.kind === 'unchecked')
    return (
      <>
        <PageHeader title={t('count.review')} back="/stocktake" />
        <Page>
          {stale && (
            <Alert severity="warning" action={<Button onClick={rebuild}>{t('count.rebuild')}</Button>}>
              {stale}
            </Alert>
          )}
          <Section title={t('count.diffQty', { count: qty.length })}>
            <Card>
              <List dense disablePadding>
                {qty.map((r) => (
                  <ListItem key={r.line.entityId} divider>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontWeight: 600 }}>{r.line.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {r.line.path.join(PATH_SEP)}
                      </Typography>
                    </Box>
                    <Typography sx={{ fontWeight: 700, color: (r.actual ?? 0) < (r.line.expected ?? 0) ? 'warning.main' : 'success.main' }}>
                      {r.line.expected} → {r.actual}
                    </Typography>
                  </ListItem>
                ))}
                {!qty.length && <Typography sx={{ p: 2 }} color="text.secondary">{t('count.none')}</Typography>}
              </List>
            </Card>
          </Section>
          <Section title={t('count.diffMissing', { count: missing.length })}>
            <Card>
              <List dense disablePadding>
                {missing.map((r) => (
                  <ListItem key={r.line.entityId} divider>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontWeight: 600 }}>{r.line.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {r.line.expected === null ? t('count.missingOut') : t('count.missingZero')}
                      </Typography>
                    </Box>
                  </ListItem>
                ))}
                {!missing.length && <Typography sx={{ p: 2 }} color="text.secondary">{t('count.none')}</Typography>}
              </List>
            </Card>
          </Section>
          {unchecked.length > 0 && <Alert severity="info">{t('count.uncheckedNote', { count: unchecked.length })}</Alert>}
          <Stack direction="row" spacing={1}>
            <Button fullWidth onClick={() => setStep('count')}>
              {t('count.backToCount')}
            </Button>
            <Button fullWidth variant="contained" color="secondary" onClick={() => void finish()} disabled={!!stale}>
              {qty.length + missing.length ? t('count.confirm', { count: qty.length + missing.length }) : t('count.confirmNoChange')}
            </Button>
          </Stack>
        </Page>
      </>
    )
  }

  const visible = rows.filter((r) => filter === 'all' || r.kind === 'unchecked')
  return (
    <>
      <PageHeader
        title={t('count.counting', { name: scopeName(session.scopeId) })}
        back="/more"
        actions={
          <Button color="error" onClick={() => void abandon()}>
            {t('count.abandon')}
          </Button>
        }
      />
      <Page>
        <Box>
          <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2">{t('count.progress', { done: checked, total: rows.length })}</Typography>
            <Button size="small" startIcon={<Icon name="scan" size={16} />} onClick={() => setScanning((s) => !s)}>
              {scanning ? t('count.hideScan') : t('count.showScan')}
            </Button>
          </Stack>
          <LinearProgress variant="determinate" value={rows.length ? (checked / rows.length) * 100 : 100} color="secondary" />
        </Box>
        {scanning && (
          <>
            <CameraView active onCode={onScan} paused={false} />
            {msg && <Alert severity={msg.tone}>{msg.text}</Alert>}
          </>
        )}
        <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v) => v && setFilter(v)}>
          <ToggleButton value="all">{t('common.all')}</ToggleButton>
          <ToggleButton value="todo">{t('count.todo')}</ToggleButton>
        </ToggleButtonGroup>
        {rows.length ? (
          <Card>
            <List disablePadding>
              {visible.map(({ line, kind }) => {
                const en = session.entries[line.entityId]
                return (
                  <ListItem key={line.entityId} divider sx={{ flexWrap: 'wrap', gap: 1, py: 1.25 }}>
                    <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600, wordBreak: 'break-word' }}>{line.name}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                        {line.path.join(PATH_SEP) || t('path.unassigned')}
                      </Typography>
                      <Typography variant="caption" sx={{ display: 'block' }}>
                        {line.expected === null ? t('qty.untracked') : t('count.expected', { qty: line.expected })}
                      </Typography>
                    </Box>
                    {line.expected !== null ? (
                      <TextField
                        size="small"
                        label={t('count.actual')}
                        value={en?.actual ?? ''}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^\d]/g, '')
                          setEntry(line.entityId, v === '' ? null : { actual: Number(v), seen: true })
                        }}
                        sx={{ width: 96 }}
                        slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*' } }}
                      />
                    ) : (
                      <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={en?.missing ? 'missing' : en?.seen ? 'seen' : null}
                        onChange={(_, v) => setEntry(line.entityId, v === 'seen' ? { seen: true } : v === 'missing' ? { missing: true } : null)}
                      >
                        <ToggleButton value="seen">{t('count.markSeen')}</ToggleButton>
                        <ToggleButton value="missing">{t('count.markMissing')}</ToggleButton>
                      </ToggleButtonGroup>
                    )}
                    {line.expected !== null && (
                      <Chip
                        size="small"
                        variant={en?.missing ? 'filled' : 'outlined'}
                        color={en?.missing ? 'warning' : 'default'}
                        label={t('count.markMissing')}
                        onClick={() => setEntry(line.entityId, en?.missing ? null : { missing: true })}
                      />
                    )}
                    {kind === 'qty' && <Chip size="small" color="warning" label={t('count.diff')} />}
                  </ListItem>
                )
              })}
            </List>
          </Card>
        ) : (
          <EmptyState icon="stocktake" title={t('count.noItems')} />
        )}
        <Button variant="contained" color="secondary" size="large" onClick={() => setStep('review')} disabled={!rows.length}>
          {t('count.toReview')}
        </Button>
      </Page>
    </>
  )
}
