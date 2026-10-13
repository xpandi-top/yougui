import { Alert, Box, Button, Chip, FormControlLabel, List, ListItem, ListItemText, Stack, Switch, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { parseSyncKey } from '../../core/index.ts'
import { useI18n, useT } from '../../context/i18n.tsx'
import { useFeedback } from '../../context/feedback.tsx'
import { useAppState, useStore } from '../../context/store.tsx'
import { navigate } from '../../hooks/useRoute.ts'
import { recordError } from '../../lib/errors.ts'
import {
  SyncHttpError,
  checkKey,
  createHousehold,
  defaultApiUrl,
  keepLocalVersion,
  setSyncConfig,
  syncFeatureEnabled,
  syncNow,
  useSyncConfig,
  type SyncConfig,
} from '../../lib/sync.ts'
import { Icon } from '../ui/Icon.tsx'
import { Card, EmptyState, Page, PageHeader, Section } from '../ui/Layout.tsx'
import { formatTime } from '../ui/opText.ts'

function errMsg(t: ReturnType<typeof useT>, err: unknown): string {
  if (err instanceof SyncHttpError) {
    if (err.status === 401 || err.status === 403) return t('sync.err.auth')
    if (err.status === 404) return t('sync.err.notFound')
    return t('sync.err.http', { status: err.status, message: err.message })
  }
  if (err instanceof DOMException && err.name === 'AbortError') return t('sync.err.timeout')
  return t('sync.err.network')
}

export default function SyncPage() {
  const t = useT()
  const { lang } = useI18n()
  const store = useStore()
  const { household, conflicts, snap } = useAppState()
  const cfg = useSyncConfig()
  const { confirm, toast } = useFeedback()
  const [tab, setTab] = useState<'create' | 'join'>(household ? 'create' : 'join')
  const [apiUrl, setApiUrl] = useState(cfg?.apiUrl ?? defaultApiUrl())
  const [secret, setSecret] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showKey, setShowKey] = useState(false)

  if (!syncFeatureEnabled()) {
    return (
      <>
        <PageHeader title={t('more.sync')} back="/more" />
        <EmptyState icon="storage" title={t('sync.disabled')} />
      </>
    )
  }

  async function run(fresh?: SyncConfig) {
    setBusy(true)
    setError('')
    try {
      const r = await syncNow(store)
      toast(t('sync.done', { pushed: r.pushed, pulled: r.pulled }), { severity: r.conflicts ? 'warning' : 'success' })
      if (r.conflicts) toast(t('sync.conflicts', { count: r.conflicts }), { severity: 'warning' })
      return true
    } catch (err) {
      recordError(err)
      setError(errMsg(t, err))
      if (fresh && !(err instanceof SyncHttpError)) return true
      return false
    } finally {
      setBusy(false)
    }
  }

  async function create() {
    if (!household) return
    setBusy(true)
    setError('')
    try {
      const res = await createHousehold(apiUrl.trim(), household.name, secret.trim() || undefined)
      const next: SyncConfig = { apiUrl: apiUrl.trim(), key: res.key, householdName: household.name, cursor: 0, lastSyncAt: null, lastError: null, auto: true }
      setSyncConfig(next)
      setShowKey(true)
      setBusy(false)
      await run(next)
    } catch (err) {
      recordError(err)
      setError(errMsg(t, err))
      setBusy(false)
    }
  }

  async function join() {
    const k = key.trim()
    if (!parseSyncKey(k)) return setError(t('sync.err.keyFormat'))
    setBusy(true)
    setError('')
    try {
      const info = await checkKey(apiUrl.trim(), k)
      const hasLocal = Object.values(snap.entities).some((e) => !e.deletedAt)
      setBusy(false)
      if (hasLocal && !(await confirm({ title: t('sync.mergeTitle', { name: info.name }), body: t('sync.mergeBody') }))) return
      const next: SyncConfig = { apiUrl: apiUrl.trim(), key: k, householdName: info.name, cursor: 0, lastSyncAt: null, lastError: null, auto: true }
      // 加入别的家庭：本机家庭记录让位给云端版本
      if (household) await store.applySync([{ kind: 'household', record: { ...household, _dirty: undefined, _srv: 0 } }])
      setSyncConfig(next)
      if (await run(next)) navigate('/', { replace: true })
    } catch (err) {
      recordError(err)
      setError(errMsg(t, err))
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!(await confirm({ title: t('sync.disconnectTitle'), body: t('sync.disconnectBody'), danger: true }))) return
    setSyncConfig(null)
    toast(t('sync.disconnected'))
  }

  const pending = cfg ? store.dirtyRecords().length : 0

  return (
    <>
      <PageHeader title={t('more.sync')} back={household ? '/more' : '/'} />
      <Page>
        {!cfg ? (
          <>
            <Typography color="text.secondary">{t('sync.intro')}</Typography>
            <TextField label={t('sync.apiUrl')} value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://yougui-api.<you>.workers.dev" helperText={t('sync.apiHelp')} slotProps={{ htmlInput: { inputMode: 'url', autoCapitalize: 'off' } }} />
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              {household && <Tab value="create" label={t('sync.tabCreate')} />}
              <Tab value="join" label={t('sync.tabJoin')} />
            </Tabs>
            {tab === 'create' && household ? (
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  {t('sync.createHelp', { name: household.name })}
                </Typography>
                <TextField label={t('sync.setupSecret')} value={secret} onChange={(e) => setSecret(e.target.value)} helperText={t('sync.setupSecretHelp')} type="password" autoComplete="off" />
                <Button variant="contained" color="secondary" onClick={() => void create()} disabled={busy || !apiUrl.trim()}>
                  {t('sync.createBtn')}
                </Button>
              </Stack>
            ) : (
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  {t('sync.joinHelp')}
                </Typography>
                <TextField label={t('sync.key')} value={key} onChange={(e) => setKey(e.target.value)} type="password" autoComplete="off" slotProps={{ htmlInput: { autoCapitalize: 'off', autoCorrect: 'off' } }} />
                <Button variant="contained" color="secondary" onClick={() => void join()} disabled={busy || !apiUrl.trim() || !key.trim()}>
                  {t('sync.joinBtn')}
                </Button>
              </Stack>
            )}
          </>
        ) : (
          <>
            <Card sx={{ p: 2 }}>
              <Stack spacing={0.75}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Icon name="storage" />
                  <Typography sx={{ fontWeight: 700 }}>{cfg.householdName ?? household?.name}</Typography>
                  <Chip size="small" color={cfg.lastError ? 'warning' : 'success'} label={cfg.lastError ? t('sync.statusError') : t('sync.statusOk')} />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                  {cfg.apiUrl}
                </Typography>
                <Typography variant="body2">{cfg.lastSyncAt ? t('sync.last', { at: formatTime(cfg.lastSyncAt, lang) }) : t('sync.never')}</Typography>
                <Typography variant="body2">{t('sync.pending', { count: pending })}</Typography>
                {cfg.lastError && <Alert severity="warning">{cfg.lastError}</Alert>}
              </Stack>
              <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mt: 2 }}>
                <Button variant="contained" onClick={() => void run()} disabled={busy} startIcon={<Icon name="storage" size={18} />}>
                  {busy ? t('sync.running') : t('sync.now')}
                </Button>
                <FormControlLabel control={<Switch checked={cfg.auto} onChange={(e) => setSyncConfig({ ...cfg, auto: e.target.checked })} />} label={t('sync.auto')} />
              </Stack>
            </Card>

            <Section title={t('sync.keyTitle')}>
              <Card sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t('sync.keyHelp')}
                </Typography>
                {showKey ? (
                  <Box sx={{ fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all', bgcolor: 'paper.soft', p: 1.5, borderRadius: 1, userSelect: 'all' }}>{cfg.key}</Box>
                ) : null}
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button size="small" onClick={() => setShowKey((s) => !s)}>
                    {showKey ? t('sync.hideKey') : t('sync.showKey')}
                  </Button>
                  <Button
                    size="small"
                    onClick={() =>
                      void navigator.clipboard?.writeText(cfg.key).then(
                        () => toast(t('sync.copied')),
                        () => toast(t('sync.copyFailed'), { severity: 'warning' }),
                      )
                    }
                  >
                    {t('sync.copyKey')}
                  </Button>
                </Stack>
              </Card>
            </Section>

            {conflicts.length > 0 && (
              <Section title={t('sync.conflictTitle', { count: conflicts.length })}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t('sync.conflictHelp')}
                </Typography>
                <Card>
                  <List disablePadding>
                    {conflicts.map((c, i) => {
                      const name = (c.local as { name?: string; code?: string }).name ?? (c.local as { code?: string }).code ?? c.id
                      return (
                        <ListItem key={`${c.kind}:${c.id}:${c.at}`} divider sx={{ flexWrap: 'wrap', gap: 1 }}>
                          <ListItemText primary={name} secondary={`${t(`sync.kind.${c.kind}` as never)} · ${formatTime(c.at, lang)}`} sx={{ flex: '1 1 160px' }} />
                          <Button size="small" onClick={() => void store.dismissConflict(i)}>
                            {t('sync.keepCloud')}
                          </Button>
                          <Button size="small" variant="outlined" onClick={() => void keepLocalVersion(store, i).then(() => run())}>
                            {t('sync.keepLocal')}
                          </Button>
                        </ListItem>
                      )
                    })}
                  </List>
                </Card>
              </Section>
            )}
            <Button color="error" onClick={() => void disconnect()} sx={{ alignSelf: 'flex-start' }}>
              {t('sync.disconnect')}
            </Button>
          </>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        <Typography variant="caption" color="text.secondary">
          {t('sync.privacy')}
        </Typography>
      </Page>
    </>
  )
}
