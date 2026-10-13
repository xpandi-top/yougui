// 全局提示（Snackbar，可带撤销）与确认对话框。
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Snackbar, Typography } from '@mui/material'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useT } from './i18n.tsx'

type Severity = 'success' | 'info' | 'warning' | 'error'

interface ToastOptions {
  severity?: Severity
  action?: { label: string; onClick: () => void }
  duration?: number
}

interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface FeedbackValue {
  toast: (message: string, opts?: ToastOptions) => void
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

const Ctx = createContext<FeedbackValue>({ toast: () => {}, confirm: async () => false })

interface ToastState extends ToastOptions {
  key: number
  message: string
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [toastState, setToast] = useState<ToastState | null>(null)
  const [confirmState, setConfirm] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const toast = useCallback((message: string, opts: ToastOptions = {}) => {
    setToast({ key: Date.now(), message, ...opts })
  }, [])

  const confirm = useCallback((opts: ConfirmOptions) => {
    setConfirm(opts)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const close = (v: boolean) => {
    resolver.current?.(v)
    resolver.current = null
    setConfirm(null)
  }

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm])

  return (
    <Ctx.Provider value={value}>
      {children}
      <Snackbar
        key={toastState?.key}
        open={!!toastState}
        autoHideDuration={toastState?.duration ?? (toastState?.action ? 6000 : 3500)}
        onClose={(_, reason) => reason !== 'clickaway' && setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 'calc(84px + env(safe-area-inset-bottom))' } }}
      >
        <Alert
          severity={toastState?.severity ?? 'success'}
          variant="filled"
          role={toastState?.severity === 'error' ? 'alert' : 'status'}
          onClose={() => setToast(null)}
          action={
            toastState?.action ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  toastState.action!.onClick()
                  setToast(null)
                }}
              >
                {toastState.action.label}
              </Button>
            ) : undefined
          }
          sx={{ width: '100%', alignItems: 'center' }}
        >
          {toastState?.message}
        </Alert>
      </Snackbar>
      <Dialog open={!!confirmState} onClose={() => close(false)} maxWidth="xs">
        <DialogTitle>{confirmState?.title}</DialogTitle>
        {confirmState?.body && (
          <DialogContent>
            {typeof confirmState.body === 'string' ? <Typography color="text.secondary">{confirmState.body}</Typography> : confirmState.body}
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => close(false)}>{confirmState?.cancelText ?? t('common.cancel')}</Button>
          <Button variant="contained" color={confirmState?.danger ? 'error' : 'primary'} onClick={() => close(true)} autoFocus>
            {confirmState?.confirmText ?? t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Ctx.Provider>
  )
}

export function useFeedback(): FeedbackValue {
  return useContext(Ctx)
}
