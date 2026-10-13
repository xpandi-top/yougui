import { Typography } from '@mui/material'
import { useT, type UiKey } from '../../context/i18n.tsx'
import { useAppState } from '../../context/store.tsx'
import { Card, Page, PageHeader, Section } from '../ui/Layout.tsx'

const SECTIONS = ['start', 'install', 'scan', 'labels', 'data', 'sync', 'limits'] as const

export default function HelpPage() {
  const t = useT()
  const { household } = useAppState()
  return (
    <>
      <PageHeader title={t('more.help')} back={household ? '/more' : '/'} />
      <Page>
        {SECTIONS.map((s) => (
          <Section key={s} title={t(`help.${s}.title` as UiKey)}>
            <Card sx={{ p: 2 }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-line', lineHeight: 1.8 }}>
                {t(`help.${s}.body` as UiKey)}
              </Typography>
            </Card>
          </Section>
        ))}
      </Page>
    </>
  )
}
