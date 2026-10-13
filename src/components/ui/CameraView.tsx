import { Box, Button, IconButton, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT, type UiKey } from '../../context/i18n.tsx'
import { CameraError, startScanner, type ScannerHandle } from '../../lib/scanner.ts'
import { Icon } from './Icon.tsx'

type CamState = { s: 'idle' } | { s: 'starting' } | { s: 'running'; decoder: string } | { s: 'paused' } | { s: 'error'; code: string }

/** 取景框：用户点击后开启；已授权时自动开启；切后台释放摄像头；卸载时停止所有轨道。 */
export function CameraView({ active, onCode, paused }: { active: boolean; onCode: (text: string) => void; paused: boolean }) {
  const t = useT()
  const video = useRef<HTMLVideoElement>(null)
  const handle = useRef<ScannerHandle | null>(null)
  const [cam, setCam] = useState<CamState>({ s: 'idle' })
  const cb = useRef(onCode)
  cb.current = onCode

  const stop = useCallback(() => {
    handle.current?.stop()
    handle.current = null
  }, [])

  const start = useCallback(async () => {
    if (!video.current || handle.current) return
    setCam({ s: 'starting' })
    try {
      handle.current = await startScanner(video.current, (text) => cb.current(text))
      setCam({ s: 'running', decoder: handle.current.decoderName })
    } catch (err) {
      setCam({ s: 'error', code: err instanceof CameraError ? err.code : 'other' })
    }
  }, [])

  useEffect(() => {
    handle.current?.setPaused(paused)
  }, [paused])

  // 已授权时自动开启；切后台释放摄像头，回来需点继续（iOS 会回收流）
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const perms = navigator.permissions as Permissions | undefined
    perms
      ?.query({ name: 'camera' as PermissionName })
      .then((p) => {
        if (!cancelled && p.state === 'granted') void start()
      })
      .catch(() => undefined)
    const onVis = () => {
      if (document.hidden && handle.current) {
        stop()
        setCam({ s: 'paused' })
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      stop()
    }
  }, [active, start, stop])

  const running = cam.s === 'running'
  return (
    <Box sx={{ position: 'relative', bgcolor: '#121714', borderRadius: 1, overflow: 'hidden', aspectRatio: '4 / 3', maxHeight: '46vh', width: '100%' }}>
      <Box component="video" ref={video} muted playsInline sx={{ width: '100%', height: '100%', objectFit: 'cover', display: running ? 'block' : 'none' }} />
      {running && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: '18% 16%',
            border: '2px solid rgba(244,239,229,.85)',
            borderRadius: 1,
            boxShadow: '0 0 0 100vmax rgba(0,0,0,.28)',
          }}
        />
      )}
      {running && (
        <IconButton
          aria-label={t('scan.stopCamera')}
          onClick={() => {
            stop()
            setCam({ s: 'idle' })
          }}
          sx={{ position: 'absolute', top: 8, right: 8, color: '#F4EFE5', bgcolor: 'rgba(0,0,0,.35)' }}
        >
          <Icon name="close" size={20} />
        </IconButton>
      )}
      {!running && (
        <Stack sx={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 1.5, p: 3, textAlign: 'center', color: '#E9E3D6' }}>
          <Icon name="camera" size={40} strokeWidth={1.2} />
          {cam.s === 'error' ? (
            <Typography variant="body2">{t(`scan.cam.${cam.code}` as UiKey)}</Typography>
          ) : cam.s === 'paused' ? (
            <Typography variant="body2">{t('scan.cam.paused')}</Typography>
          ) : (
            <Typography variant="body2">{t('scan.cam.hint')}</Typography>
          )}
          <Button variant="contained" color="secondary" onClick={() => void start()} disabled={cam.s === 'starting'}>
            {cam.s === 'starting' ? t('scan.cam.starting') : cam.s === 'error' ? t('common.retry') : t('scan.cam.open')}
          </Button>
        </Stack>
      )}
    </Box>
  )
}
