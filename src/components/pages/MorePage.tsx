import { Box, Chip, List, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material'
import { unlinkedAttachments } from '../../core/index.ts'
import { useT, type UiKey } from '../../context/i18n.tsx'
import { useAppState } from '../../context/store.tsx'
import { navigate } from '../../hooks/useRoute.ts'
import { syncFeatureEnabled, useSyncConfig } from '../../lib/sync.ts'
import { Icon } from '../ui/Icon.tsx'
import { Card, Page, PageHeader, Section } from '../ui/Layout.tsx'

interface Entry {
  icon: string
  label: UiKey
  help: UiKey
  path: string
  badge?: string
}

function Group({ title, entries }: { title: string; entries: Entry[] }) {
  const t = useT()
  return (
    <Section title={title}>
      <Card>
        <List disablePadding>
          {entries.map((e, i) => (
            <ListItemButton key={e.path} divider={i < entries.length - 1} onClick={() => navigate(e.path)}>
              <ListItemIcon sx={{ minWidth: 40, color: 'primary.main' }}>
                <Icon name={e.icon} />
              </ListItemIcon>
              <ListItemText primary={t(e.label)} secondary={t(e.help)} />
              {e.badge && <Chip size="small" label={e.badge} sx={{ mr: 1 }} />}
              <Icon name="next" size={16} />
            </ListItemButton>
          ))}
        </List>
      </Card>
    </Section>
  )
}

export default function MorePage() {
  const t = useT()
  const { snap, conflicts } = useAppState()
  const sync = useSyncConfig()
  const unlinked = unlinkedAttachments(snap).length
  const blank = Object.values(snap.labels).filter((l) => !l.deletedAt && l.status === 'blank').length
  return (
    <>
      <PageHeader title={t('nav.more')} />
      <Page>
        <Group
          title={t('more.manage')}
          entries={[
            { icon: 'stocktake', label: 'more.stocktake', help: 'more.stocktakeHelp', path: '/stocktake' },
            { icon: 'qr', label: 'more.labels', help: 'more.labelsHelp', path: '/labels', badge: blank ? t('more.blankBadge', { count: blank }) : undefined },
            { icon: 'attachment', label: 'more.attachments', help: 'more.attachmentsHelp', path: '/attachments', badge: unlinked ? t('more.unlinkedBadge', { count: unlinked }) : undefined },
            { icon: 'archive', label: 'more.log', help: 'more.logHelp', path: '/log' },
          ]}
        />
        <Group
          title={t('more.data')}
          entries={[
            { icon: 'download', label: 'more.backup', help: 'more.backupHelp', path: '/backup' },
            ...(syncFeatureEnabled()
              ? [
                  {
                    icon: 'storage',
                    label: 'more.sync' as UiKey,
                    help: (sync ? 'more.syncOn' : 'more.syncHelp') as UiKey,
                    path: '/sync',
                    badge: conflicts.length ? t('more.conflictBadge', { count: conflicts.length }) : undefined,
                  },
                ]
              : []),
            { icon: 'settings', label: 'more.settings', help: 'more.settingsHelp', path: '/settings' },
            { icon: 'file', label: 'more.help', help: 'more.helpHelp', path: '/help' },
          ]}
        />
        <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
          <Typography variant="caption">
            {t('app.name')} v{__APP_VERSION__} · {__BUILD_ID__}
          </Typography>
        </Box>
      </Page>
    </>
  )
}
