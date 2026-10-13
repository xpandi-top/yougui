import { CssBaseline, ThemeProvider, useColorScheme } from '@mui/material'
import { useEffect, type ReactNode } from 'react'
import { FeedbackProvider } from './context/feedback.tsx'
import { I18nProvider } from './context/i18n.tsx'
import { StoreProvider } from './context/store.tsx'
import { useSettings } from './lib/settings.ts'
import type { AppStore } from './lib/store.ts'
import { theme } from './theme/theme.ts'

function ThemeModeSync() {
  const { theme: pref } = useSettings()
  const { setMode } = useColorScheme()
  useEffect(() => setMode(pref), [pref, setMode])
  return null
}

export function Providers({ store, children }: { store: AppStore; children: ReactNode }) {
  return (
    <ThemeProvider theme={theme} defaultMode="system" noSsr>
      <CssBaseline enableColorScheme />
      <ThemeModeSync />
      <I18nProvider>
        <StoreProvider store={store}>
          <FeedbackProvider>{children}</FeedbackProvider>
        </StoreProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
