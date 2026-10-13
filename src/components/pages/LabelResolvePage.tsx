import { Button, Stack } from '@mui/material'
import { useEffect } from 'react'
import { labelByToken } from '../../core/index.ts'
import { useT } from '../../context/i18n.tsx'
import { useSnap } from '../../context/store.tsx'
import { navigate } from '../../hooks/useRoute.ts'
import { syncFeatureEnabled } from '../../lib/sync.ts'
import { EmptyState, PageHeader } from '../ui/Layout.tsx'

/** 标签深链接 #/l/<token>：已绑定 → 打开对象；空白 → 绑定流程；本机没有 → 说明（可能未同步）。 */
export default function LabelResolvePage({ token }: { token: string }) {
  const t = useT()
  const snap = useSnap()
  const label = labelByToken(snap, (token ?? '').toLowerCase())
  const target = label?.status === 'bound' && label.entityId && snap.entities[label.entityId] && !snap.entities[label.entityId].deletedAt ? label.entityId : null
  useEffect(() => {
    if (target) navigate(`/e/${target}`, { replace: true })
    else if (label) navigate(`/label/${label.id}`, { replace: true })
  }, [target, label])
  if (label) return null
  return (
    <>
      <PageHeader title={t('label.title')} back="/" />
      <EmptyState
        icon="qr"
        title={t('label.notOnDevice')}
        body={t('label.notOnDeviceBody')}
        action={
          <Stack direction="row" spacing={1}>
            <Button onClick={() => navigate('/')}>{t('nav.home')}</Button>
            {syncFeatureEnabled() && (
              <Button variant="contained" onClick={() => navigate('/sync')}>
                {t('more.sync')}
              </Button>
            )}
          </Stack>
        }
      />
    </>
  )
}
