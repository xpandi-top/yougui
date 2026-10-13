import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { useRef, useState } from 'react'
import { TABLES } from '../../core/index.ts'
import { useT } from '../../context/i18n.tsx'
import { useFeedback } from '../../context/feedback.tsx'
import { useAppState, useStore } from '../../context/store.tsx'
import { navigate } from '../../hooks/useRoute.ts'
import { BackupError, exportBackup, readBackup, restoreMerge, restoreReplace, type ParsedBackup } from '../../lib/backup.ts'
import { recordError } from '../../lib/errors.ts'
import { downloadBlob, formatBytes } from '../../lib/files.ts'
import { getSyncConfig } from '../../lib/sync.ts'
import { Icon } from '../ui/Icon.tsx'
import { Card, Page, PageHeader, Section } from '../ui/Layout.tsx'

export default function BackupPage() {
  const t = useT()
  const store = useStore()
  const { household, snap } = useAppState()
  const { confirm, toast } = useFeedback()
  const [busy, setBusy] = useState(false)
  const [parsed, setParsed] = useState<ParsedBackup | null>(null)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  async function doExport() {
    setBusy(true)
    try {
      const { blob, manifest } = await exportBackup(store, __APP_VERSION__)
      const d = new Date()
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
      downloadBlob(blob, `yougui-backup-${stamp}.zip`)
      toast(t('backup.exported', { files: manifest.files.length, size: formatBytes(blob.size) }))
      if (manifest.missing.length) toast(t('backup.missingFiles', { count: manifest.missing.length }), { severity: 'warning' })
    } catch (err) {
      recordError(err)
      toast(t('backup.exportFailed'), { severity: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function onFile(f: File | undefined) {
    setError('')
    setParsed(null)
    if (!f) return
    setBusy(true)
    try {
      setParsed(await readBackup(f))
    } catch (err) {
      setError(err instanceof BackupError ? t(`backup.err.${err.message}` as never) : t('backup.err.notZip'))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function restore(mode: 'merge' | 'replace') {
    if (!parsed) return
    if (mode === 'replace') {
      if (getSyncConfig()) return setError(t('backup.replaceSyncBlocked'))
      const ok = await confirm({ title: t('backup.replaceTitle'), body: t('backup.replaceBody'), confirmText: t('backup.replace'), danger: true })
      if (!ok) return
    }
    setBusy(true)
    try {
      if (mode === 'replace') await restoreReplace(store, parsed)
      else {
        const n = await restoreMerge(store, parsed)
        toast(t('backup.merged', { count: n }))
      }
      setParsed(null)
      if (mode === 'replace') toast(t('backup.replaced'))
      navigate('/', { replace: true })
    } catch (err) {
      recordError(err)
      setError(t('backup.restoreFailed'))
    } finally {
      setBusy(false)
    }
  }

  const counts = Object.fromEntries(TABLES.map((tb) => [tb, Object.values(snap[tb]).filter((r) => !r.deletedAt).length]))

  return (
    <>
      <PageHeader title={t('more.backup')} back={household ? '/more' : '/'} />
      <Page>
        <Alert severity="info" icon={<Icon name="warning" size={20} />}>
          {t('backup.why')}
        </Alert>
        {household && (
          <Section title={t('backup.export')}>
            <Card sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {t('backup.exportHelp', { items: counts.entities, files: counts.attachments })}
              </Typography>
              <Button variant="contained" startIcon={<Icon name="download" size={18} />} onClick={() => void doExport()} disabled={busy}>
                {t('backup.exportBtn')}
              </Button>
            </Card>
          </Section>
        )}
        <Section title={t('backup.restore')}>
          <Card sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {t('backup.restoreHelp')}
            </Typography>
            <input ref={input} type="file" hidden accept=".zip,application/zip" onChange={(e) => void onFile(e.target.files?.[0])} />
            <Button variant="outlined" startIcon={<Icon name="upload" size={18} />} onClick={() => input.current?.click()} disabled={busy}>
              {t('backup.choose')}
            </Button>
            {parsed && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2">{t('backup.report')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line' }}>
                  {t('backup.reportBody', {
                    at: new Date(parsed.manifest.exportedAt).toLocaleString(),
                    entities: parsed.manifest.counts.entities ?? 0,
                    files: parsed.files.length,
                    external: parsed.manifest.external.length,
                    missing: parsed.manifest.missing.length,
                  })}
                </Typography>
                {parsed.corrupt.length > 0 && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    {t('backup.corrupt', { count: parsed.corrupt.length })}
                  </Alert>
                )}
                <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                  <Button variant="contained" onClick={() => void restore('merge')} disabled={busy}>
                    {household ? t('backup.merge') : t('backup.import')}
                  </Button>
                  {household && (
                    <Button color="error" onClick={() => void restore('replace')} disabled={busy}>
                      {t('backup.replace')}
                    </Button>
                  )}
                </Stack>
              </Box>
            )}
            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}
          </Card>
        </Section>
      </Page>
    </>
  )
}
