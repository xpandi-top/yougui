import { BottomNavigation, BottomNavigationAction, Box, IconButton, Paper, Stack, Typography, type SxProps, type Theme } from '@mui/material'
import type { ReactNode } from 'react'
import { useT } from '../../context/i18n.tsx'
import { goBack, navigate, useRoute } from '../../hooks/useRoute.ts'
import { Icon } from './Icon.tsx'

export const CONTENT_MAX = 720

const TABS = [
  { key: 'home', path: '/', icon: 'home', match: (p: string) => p === '/' || p === '/search' },
  { key: 'places', path: '/places', icon: 'places', match: (p: string) => p.startsWith('/places') },
  { key: 'scan', path: '/scan', icon: 'scan', match: (p: string) => p.startsWith('/scan') },
  { key: 'items', path: '/items', icon: 'items', match: (p: string) => p.startsWith('/items') || p.startsWith('/add') },
  { key: 'more', path: '/more', icon: 'more', match: (p: string) => !['/', '/search'].includes(p) && !/^\/(places|scan|items|add|e)\b/.test(p) },
] as const

export function BottomNav() {
  const t = useT()
  const { path } = useRoute()
  const active = TABS.findIndex((tab) => tab.match(path))
  return (
    <Paper
      component="nav"
      aria-label={t('nav.label')}
      square
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1100,
        borderWidth: '1px 0 0 0',
        pb: 'env(safe-area-inset-bottom)',
        bgcolor: 'background.paper',
        '@media print': { display: 'none' },
      }}
    >
      <BottomNavigation
        showLabels
        value={active}
        sx={{ maxWidth: CONTENT_MAX, mx: 'auto', height: 64, bgcolor: 'transparent' }}
      >
        {TABS.map((tab, i) =>
          tab.key === 'scan' ? (
            <BottomNavigationAction
              key={tab.key}
              label={t(`nav.${tab.key}`)}
              onClick={() => navigate(tab.path)}
              icon={
                <Box
                  sx={{
                    width: 46,
                    height: 46,
                    mt: -2.5,
                    mb: 0.25,
                    borderRadius: 1,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: 'secondary.main',
                    color: 'secondary.contrastText',
                    boxShadow: '0 4px 12px rgba(147,74,58,.35)',
                  }}
                >
                  <Icon name="scan" size={24} />
                </Box>
              }
              sx={{ '&.Mui-selected': { color: 'secondary.main' } }}
              aria-current={i === active ? 'page' : undefined}
            />
          ) : (
            <BottomNavigationAction
              key={tab.key}
              label={t(`nav.${tab.key}`)}
              icon={<Icon name={tab.icon} />}
              onClick={() => navigate(tab.path)}
              aria-current={i === active ? 'page' : undefined}
            />
          ),
        )}
      </BottomNavigation>
    </Paper>
  )
}

interface HeaderProps {
  title: ReactNode
  /** 返回目标（无应用内历史时）；不传则不显示返回 */
  back?: string
  actions?: ReactNode
  eyebrow?: ReactNode
}

export function PageHeader({ title, back, actions, eyebrow }: HeaderProps) {
  const t = useT()
  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        bgcolor: 'background.default',
        borderBottom: 1,
        borderColor: 'divider',
        pt: 'env(safe-area-inset-top)',
        '@media print': { display: 'none' },
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', minHeight: 56, px: 1, gap: 0.5 }}>
        {back !== undefined && (
          <IconButton onClick={() => goBack(back)} aria-label={t('common.back')} edge="start">
            <Icon name="back" />
          </IconButton>
        )}
        <Box sx={{ flex: 1, minWidth: 0, pl: back !== undefined ? 0 : 1 }}>
          {eyebrow && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', letterSpacing: '0.12em', lineHeight: 1.2 }}>
              {eyebrow}
            </Typography>
          )}
          <Typography variant="h3" component="h1" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </Typography>
        </Box>
        {actions}
      </Stack>
    </Box>
  )
}

export function Page({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  return <Box sx={[{ px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: 2.5 }, ...(Array.isArray(sx) ? sx : [sx])]}>{children}</Box>
}

export function Section({ title, action, children, sx }: { title?: ReactNode; action?: ReactNode; children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Box component="section" sx={sx}>
      {(title || action) && (
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1, minHeight: 32 }}>
          {title && (
            <Typography variant="h4" component="h2">
              {title}
            </Typography>
          )}
          {action}
        </Stack>
      )}
      {children}
    </Box>
  )
}

export function Card({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Paper sx={[{ overflow: 'hidden', bgcolor: 'background.paper' }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {children}
    </Paper>
  )
}

export function EmptyState({ icon = 'archive', title, body, action }: { icon?: string; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <Stack sx={{ alignItems: 'center', textAlign: 'center', py: 5, px: 3, gap: 1, color: 'text.secondary' }}>
      <Icon name={icon} size={40} strokeWidth={1.2} />
      <Typography sx={{ fontWeight: 600, color: 'text.primary' }}>{title}</Typography>
      {body && <Typography variant="body2">{body}</Typography>}
      {action && <Box sx={{ mt: 1 }}>{action}</Box>}
    </Stack>
  )
}

/** 宣纸纹理背景。 */
export const paperTexture = {
  backgroundImage: 'radial-gradient(rgba(139,121,80,.06) .6px, transparent .6px)',
  backgroundSize: '4px 4px',
}
