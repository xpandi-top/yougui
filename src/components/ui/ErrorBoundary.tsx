import { Box, Button, Typography } from '@mui/material'
import { Component, type ReactNode } from 'react'
import { makeT, resolveLang } from '../../context/i18n.tsx'
import { recordError } from '../../lib/errors.ts'
import { getSettings } from '../../lib/settings.ts'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    recordError(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    const t = makeT(resolveLang(getSettings().lang))
    return (
      <Box sx={{ p: 3, textAlign: 'center' }} role="alert">
        <Typography variant="h3" sx={{ mb: 1 }}>
          {t('error.title')}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2, wordBreak: 'break-word' }}>
          {this.state.error.message}
        </Typography>
        <Button variant="contained" onClick={() => location.reload()}>
          {t('error.reload')}
        </Button>
      </Box>
    )
  }
}
