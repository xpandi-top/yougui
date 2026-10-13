import { Box, CircularProgress, Link, Typography } from '@mui/material'
import type { ProductInfo } from '../../core/index.ts'
import { useT, type UiKey } from '../../context/i18n.tsx'
import { navigate } from '../../hooks/useRoute.ts'
import type { LookupState } from '../../hooks/useProductLookup.ts'
import { Icon } from './Icon.tsx'

export function lookupMeta(t: ReturnType<typeof useT>, info: ProductInfo): string {
  return [info.brand, info.model, info.category, t('lookup.source', { source: t(`lookup.src.${info.source}` as UiKey) })].filter(Boolean).join(' · ')
}

/** 商品名查询的状态行：查询中 / 查到（来源）/ 没查到 / 需开启同步 / 额度用完 / 离线。 */
export function LookupHint({ state, applied }: { state: LookupState; applied?: boolean }) {
  const t = useT()
  if (state.status === 'idle' || state.status === 'disabled') return null
  if (state.status === 'loading') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }} aria-live="polite">
        <CircularProgress size={14} color="inherit" />
        <Typography variant="caption">{t('lookup.loading')}</Typography>
      </Box>
    )
  }
  if (state.status === 'found' && state.info) {
    return (
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', p: 1.25, borderRadius: 1, bgcolor: 'paper.soft' }} aria-live="polite">
        <Box sx={{ color: 'success.main', mt: 0.25 }}>
          <Icon name="check" size={18} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
            {t('lookup.found', { name: state.info.name })}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-word' }}>
            {lookupMeta(t, state.info)}
          </Typography>
          {applied && (
            <Typography variant="caption" color="text.secondary">
              {t('lookup.applied')}
            </Typography>
          )}
        </Box>
      </Box>
    )
  }
  return (
    <Typography variant="caption" color={state.status === 'rateLimited' ? 'warning.main' : 'text.secondary'} aria-live="polite">
      {t(`lookup.${state.status}` as UiKey)}
      {state.status === 'needsSync' && (
        <>
          {' '}
          <Link component="button" type="button" variant="caption" onClick={() => navigate('/sync')}>
            {t('lookup.openSync')}
          </Link>
        </>
      )}
    </Typography>
  )
}
