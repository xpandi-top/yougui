import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { useT, type UiKey } from '../../context/i18n.tsx'
import { useFeedback } from '../../context/feedback.tsx'
import { applyUpdate, checkForUpdate, hardReload, useUpdateState } from '../../lib/pwa.ts'
import { Icon } from './Icon.tsx'

/** 全局横幅：新版本已下载，点「更新」切换并刷新。显示在底部导航上方。 */
export function UpdateBanner() {
  const t = useT()
  const { available } = useUpdateState()
  if (!available) return null
  return (
    <Box
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 'calc(72px + env(safe-area-inset-bottom))',
        zIndex: 1200,
        px: 2,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        '@media print': { display: 'none' },
      }}
    >
      <Alert
        severity="info"
        variant="filled"
        icon={<Icon name="download" size={20} />}
        action={
          <Button color="inherit" size="small" onClick={() => void applyUpdate()} sx={{ fontWeight: 700 }}>
            {t('update.apply')}
          </Button>
        }
        sx={{ pointerEvents: 'auto', maxWidth: 560, width: '100%', alignItems: 'center', bgcolor: 'primary.main', color: 'primary.contrastText' }}
      >
        {t('update.available')}
      </Alert>
    </Box>
  )
}

/** 版本号 + 检查更新（更多页底部、设置页）。full 时附带「清除缓存并重新加载」。 */
export function UpdateControls({ full = false }: { full?: boolean }) {
  const t = useT()
  const { toast, confirm } = useFeedback()
  const { available, checking, supported } = useUpdateState()

  async function check() {
    if (!supported) {
      location.reload()
      return
    }
    const r = await checkForUpdate()
    if (r !== 'available') toast(t(`update.result.${r}` as UiKey), { severity: r === 'latest' ? 'success' : r === 'error' ? 'error' : 'info' })
  }

  return (
    <Stack spacing={1} sx={{ alignItems: full ? 'flex-start' : 'center' }}>
      <Typography variant="caption" color="text.secondary">
        {t('app.name')} v{__APP_VERSION__} · {__BUILD_ID__}
      </Typography>
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', justifyContent: full ? 'flex-start' : 'center' }}>
        {available ? (
          <Button size="small" variant="contained" startIcon={<Icon name="download" size={16} />} onClick={() => void applyUpdate()}>
            {t('update.apply')}
          </Button>
        ) : (
          <Button size="small" variant="outlined" startIcon={<Icon name="download" size={16} />} onClick={() => void check()} disabled={checking}>
            {checking ? t('update.checking') : t('update.check')}
          </Button>
        )}
        {full && (
          <Button
            size="small"
            onClick={async () => {
              if (await confirm({ title: t('update.hardTitle'), body: t('update.hardBody') })) await hardReload()
            }}
          >
            {t('update.hard')}
          </Button>
        )}
      </Stack>
      {full && (
        <Typography variant="caption" color="text.secondary">
          {t('update.help')}
        </Typography>
      )}
    </Stack>
  )
}
