import { Alert, Box, Button, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useT } from '../../context/i18n.tsx'
import { useFeedback } from '../../context/feedback.tsx'
import { useAppState, useStore } from '../../context/store.tsx'
import { navigate } from '../../hooks/useRoute.ts'
import { recentErrors } from '../../lib/errors.ts'
import { formatBytes } from '../../lib/files.ts'
import { appUrl, updateSettings, useSettings, type LangPref, type ThemePref } from '../../lib/settings.ts'
import { setSyncConfig } from '../../lib/sync.ts'
import { TextDialog } from '../dialogs/Basic.tsx'
import { UpdateControls } from '../ui/UpdateControls.tsx'
import { Card, Page, PageHeader, Section } from '../ui/Layout.tsx'

export default function SettingsPage() {
  const t = useT()
  const s = useSettings()
  const store = useStore()
  const { household } = useAppState()
  const { confirm, toast } = useFeedback()
  const [renaming, setRenaming] = useState(false)
  const [usage, setUsage] = useState<{ used?: number; quota?: number; persisted?: boolean } | null>(null)
  const [wipeOpen, setWipeOpen] = useState(false)
  const errors = recentErrors()

  useEffect(() => {
    void (async () => {
      const est = await navigator.storage?.estimate?.().catch(() => undefined)
      const persisted = await navigator.storage?.persisted?.().catch(() => undefined)
      setUsage({ used: est?.usage, quota: est?.quota, persisted })
    })()
  }, [])

  return (
    <>
      <PageHeader title={t('more.settings')} back={household ? '/more' : '/'} />
      <Page>
        {household && (
          <Section title={t('settings.household')}>
            <Card sx={{ p: 2 }}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontWeight: 700 }}>{household.name}</Typography>
                <Button onClick={() => setRenaming(true)}>{t('common.edit')}</Button>
              </Stack>
            </Card>
          </Section>
        )}
        <Section title={t('settings.display')}>
          <Card sx={{ p: 2 }}>
            <Stack spacing={2}>
              <TextField select label={t('settings.lang')} value={s.lang} onChange={(e) => updateSettings({ lang: e.target.value as LangPref })}>
                <MenuItem value="auto">{t('settings.auto')}</MenuItem>
                <MenuItem value="zh">中文</MenuItem>
                <MenuItem value="en">English</MenuItem>
              </TextField>
              <TextField select label={t('settings.theme')} value={s.theme} onChange={(e) => updateSettings({ theme: e.target.value as ThemePref })}>
                <MenuItem value="system">{t('settings.auto')}</MenuItem>
                <MenuItem value="light">{t('settings.light')}</MenuItem>
                <MenuItem value="dark">{t('settings.dark')}</MenuItem>
              </TextField>
              <FormControlLabel control={<Switch checked={s.scanSound} onChange={(e) => updateSettings({ scanSound: e.target.checked })} />} label={t('settings.scanSound')} />
              <Box>
                <FormControlLabel
                  control={<Switch checked={s.productLookup} onChange={(e) => updateSettings({ productLookup: e.target.checked })} />}
                  label={t('settings.productLookup')}
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {t('settings.productLookupHelp')}
                </Typography>
              </Box>
            </Stack>
          </Card>
        </Section>
        <Section title={t('settings.labels')}>
          <Card sx={{ p: 2 }}>
            <TextField
              label={t('settings.labelUrl')}
              value={s.labelBaseUrl}
              onChange={(e) => updateSettings({ labelBaseUrl: e.target.value })}
              placeholder={appUrl()}
              helperText={t('settings.labelUrlHelp')}
              slotProps={{ htmlInput: { inputMode: 'url', autoCapitalize: 'off' } }}
            />
          </Card>
        </Section>
        <Section title={t('update.section')}>
          <Card sx={{ p: 2 }}>
            <UpdateControls full />
          </Card>
        </Section>
        <Section title={t('settings.storage')}>
          <Card sx={{ p: 2 }}>
            <Typography variant="body2">
              {usage?.used !== undefined ? t('settings.usage', { used: formatBytes(usage.used), quota: formatBytes(usage.quota) }) : t('settings.usageUnknown')}
            </Typography>
            <Typography variant="body2" color={usage?.persisted ? 'success.main' : 'warning.main'} sx={{ mt: 0.5 }}>
              {usage?.persisted ? t('settings.persisted') : t('settings.notPersisted')}
            </Typography>
            <Button size="small" sx={{ mt: 1 }} onClick={() => navigate('/backup')}>
              {t('more.backup')}
            </Button>
          </Card>
        </Section>
        {errors.length > 0 && (
          <Section title={t('settings.errors')}>
            <Card sx={{ p: 2 }}>
              {errors.map((e) => (
                <Typography key={e.at} variant="caption" sx={{ display: 'block', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                  {new Date(e.at).toLocaleTimeString()} {e.message}
                </Typography>
              ))}
            </Card>
          </Section>
        )}
        <Section title={t('settings.danger')}>
          <Alert severity="error" action={<Button color="inherit" onClick={() => setWipeOpen(true)}>{t('settings.wipe')}</Button>}>
            {t('settings.wipeHelp')}
          </Alert>
        </Section>
      </Page>
      <TextDialog
        open={renaming}
        title={t('settings.household')}
        label={t('setup.householdName')}
        initial={household?.name ?? ''}
        onClose={() => setRenaming(false)}
        onSubmit={async (v) => {
          await store.setHousehold(v.trim())
          setRenaming(false)
          toast(t('toast.saved'))
        }}
      />
      <TextDialog
        open={wipeOpen}
        title={t('settings.wipe')}
        label={t('settings.wipeConfirmLabel', { word: t('settings.wipeWord') })}
        helper={t('settings.wipeHelp')}
        confirmText={t('settings.wipe')}
        onClose={() => setWipeOpen(false)}
        onSubmit={async (v) => {
          if (v.trim() !== t('settings.wipeWord')) return toast(t('settings.wipeMismatch'), { severity: 'error' })
          setWipeOpen(false)
          if (!(await confirm({ title: t('settings.wipe'), body: t('settings.wipeLast'), danger: true }))) return
          await store.clearAll()
          setSyncConfig(null)
          for (const k of ['yg-scan-draft-v1', 'yg-count-draft-v1']) localStorage.removeItem(k)
          navigate('/', { replace: true })
        }}
      />
    </>
  )
}
