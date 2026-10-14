import { Alert, Box, Button, FormControlLabel, MenuItem, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { formatLabelCode, labelUrl, pathNames, PATH_SEP, type Label } from '../../core/index.ts'
import { useT } from '../../context/i18n.tsx'
import { useSnap } from '../../context/store.tsx'
import { goBack, useRoute } from '../../hooks/useRoute.ts'
import { qrSvg } from '../../lib/qr.ts'
import { exportLabelsPdf, printUnsupported, shareOrDownload } from '../../lib/labelExport.ts'
import { recordError } from '../../lib/errors.ts'
import { useFeedback } from '../../context/feedback.tsx'
import { appUrl, updateSettings, useSettings, type LabelSize } from '../../lib/settings.ts'
import { Icon } from '../ui/Icon.tsx'

const SIZES: Record<LabelSize, { w: number; h: number }> = {
  '40x30': { w: 40, h: 30 },
  '30x20': { w: 30, h: 20 },
  '50x30': { w: 50, h: 30 },
  '62x29': { w: 62, h: 29 },
}

type Layout = 'roll' | 'a4'

/**
 * 打印预览：实际尺寸（mm）。roll = 每张标签一页（标签机/厂商 App 导入 PDF）；a4 = A4 排版裁切。
 * Safari 无法得知打印是否成功：关闭打印对话框不等于成功，请用样张确认尺寸与可扫性。
 */
export default function PrintPage() {
  const t = useT()
  const snap = useSnap()
  const { query } = useRoute()
  const settings = useSettings()
  const { toast } = useFeedback()
  const [layout, setLayout] = useState<Layout>('a4')
  const [svgs, setSvgs] = useState<Record<string, string>>({})
  const size = SIZES[settings.labelSize]

  const labels: Label[] = useMemo(() => {
    const all = Object.values(snap.labels).filter((l) => !l.deletedAt)
    const ids = query.get('ids')?.split(',').filter(Boolean)
    const batch = query.get('batch')
    const status = query.get('status')
    const list = ids ? all.filter((l) => ids.includes(l.id)) : batch ? all.filter((l) => l.batchId === batch) : status ? all.filter((l) => l.status === status) : []
    return list.sort((a, b) => a.code.localeCompare(b.code))
  }, [snap, query])

  const base = appUrl()
  useEffect(() => {
    let alive = true
    void Promise.all(labels.map(async (l) => [l.id, await qrSvg(labelUrl(base, l.token))] as const)).then((pairs) => {
      if (alive) setSvgs(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [labels, base])

  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(base)
  const noPrint = printUnsupported()
  const mobile = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const [exporting, setExporting] = useState(false)

  async function exportPdf() {
    setExporting(true)
    try {
      const items = labels.map((l) => {
        const e = l.status === 'bound' && l.entityId ? snap.entities[l.entityId] : null
        return {
          label: l,
          name: e && settings.labelShowName ? e.name : undefined,
          path: e && settings.labelShowPath ? pathNames(snap.entities, e.id).join(PATH_SEP) : undefined,
        }
      })
      const blob = await exportLabelsPdf(items, { appUrl: base, size, layout })
      const r = await shareOrDownload(blob, `yougui-labels-${settings.labelSize}-${layout}.pdf`)
      if (r === 'downloaded') toast(t('print.downloaded'))
    } catch (err) {
      recordError(err)
      toast(t('print.exportFailed'), { severity: 'error' })
    } finally {
      setExporting(false)
    }
  }
  const pageCss =
    layout === 'roll'
      ? `@page { size: ${size.w}mm ${size.h}mm; margin: 0 } .yg-label { page-break-after: always; break-after: page; border: 0 !important; }`
      : `@page { size: A4; margin: 10mm }`

  return (
    <Box sx={{ bgcolor: '#e9e5dc', minHeight: '100dvh', '@media print': { bgcolor: '#fff', minHeight: 0 } }}>
      <style>{`@media print { ${pageCss} body { background: #fff !important; } .MuiSnackbar-root { display: none !important; } }`}</style>
      <Box sx={{ p: 2, maxWidth: 760, mx: 'auto', '@media print': { display: 'none' } }}>
        <Stack direction="row" sx={{ alignItems: 'center', mb: 2, gap: 1, flexWrap: 'wrap' }}>
          <Button startIcon={<Icon name="back" size={18} />} onClick={() => goBack('/labels')}>
            {t('common.back')}
          </Button>
          <Typography variant="h3" sx={{ flex: '1 1 140px' }}>
            {t('print.title', { count: labels.length })}
          </Typography>
          {!noPrint && (
            <Button variant={mobile ? 'outlined' : 'contained'} color="secondary" startIcon={<Icon name="print" size={18} />} onClick={() => window.print()} disabled={!labels.length || exporting}>
              {t('print.printShort')}
            </Button>
          )}
          <Button variant={mobile || noPrint ? 'contained' : 'outlined'} color="secondary" startIcon={<Icon name="download" size={18} />} onClick={() => void exportPdf()} disabled={!labels.length || exporting}>
            {exporting ? t('print.exporting') : t('print.exportPdf')}
          </Button>
        </Stack>
        <Stack direction="row" sx={{ gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
          <TextField select size="small" label={t('print.size')} value={settings.labelSize} onChange={(e) => updateSettings({ labelSize: e.target.value as LabelSize })} sx={{ width: 140 }}>
            {Object.keys(SIZES).map((k) => (
              <MenuItem key={k} value={k}>
                {k.replace('x', ' × ')} mm
              </MenuItem>
            ))}
          </TextField>
          <ToggleButtonGroup size="small" exclusive value={layout} onChange={(_, v: Layout | null) => v && setLayout(v)}>
            <ToggleButton value="a4">{t('print.a4')}</ToggleButton>
            <ToggleButton value="roll">{t('print.roll')}</ToggleButton>
          </ToggleButtonGroup>
          <FormControlLabel control={<Switch checked={settings.labelShowName} onChange={(e) => updateSettings({ labelShowName: e.target.checked })} />} label={t('print.showName')} />
          <FormControlLabel control={<Switch checked={settings.labelShowPath} onChange={(e) => updateSettings({ labelShowPath: e.target.checked })} />} label={t('print.showPath')} />
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {t('print.help')}
        </Typography>
        {noPrint && (
          <Alert severity="info" sx={{ mt: 1 }}>
            {t('print.iosStandalone')}
          </Alert>
        )}
        {local && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {t('print.localUrl', { url: base })}
          </Alert>
        )}
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: layout === 'a4' ? '4mm' : '6mm',
          justifyContent: 'center',
          p: 2,
          '@media print': { p: 0, gap: layout === 'a4' ? '3mm' : 0, justifyContent: 'flex-start' },
        }}
      >
        {labels.map((l) => {
          const e = l.status === 'bound' && l.entityId ? snap.entities[l.entityId] : null
          // 二维码边长受高与宽共同限制，给右侧文字留出至少 ~12mm
          const qr = Math.min(size.h - 4, Math.round(size.w * 0.55))
          const tiny = size.w - qr < 20
          return (
            <Box
              key={l.id}
              className="yg-label"
              sx={{
                width: `${size.w}mm`,
                height: `${size.h}mm`,
                bgcolor: '#fff',
                color: '#000',
                border: '0.2mm dashed #999',
                display: 'flex',
                alignItems: 'center',
                gap: '1.5mm',
                p: '2mm',
                boxSizing: 'border-box',
                overflow: 'hidden',
                breakInside: 'avoid',
              }}
            >
              <Box sx={{ width: `${qr}mm`, height: `${qr}mm`, flexShrink: 0, '& svg': { width: '100%', height: '100%', display: 'block' } }} dangerouslySetInnerHTML={{ __html: svgs[l.id] ?? '' }} />
              <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', py: '0.5mm' }}>
                <Box>
                  {e && settings.labelShowName && (
                    <Box sx={{ fontSize: tiny ? '2.4mm' : '3mm', fontWeight: 700, lineHeight: 1.15, wordBreak: 'break-all', maxHeight: '7.5mm', overflow: 'hidden' }}>{e.name}</Box>
                  )}
                  {e && settings.labelShowPath && (
                    <Box sx={{ fontSize: '2.2mm', lineHeight: 1.2, mt: '0.6mm', color: '#333', wordBreak: 'break-all', maxHeight: '5.4mm', overflow: 'hidden' }}>
                      {pathNames(snap.entities, e.id).join(PATH_SEP)}
                    </Box>
                  )}
                </Box>
                <Box sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 700, fontSize: tiny ? '2.6mm' : '3.2mm', lineHeight: 1.1, whiteSpace: 'nowrap' }}>
                  {tiny ? (
                    <>
                      {l.code.slice(0, 3)}
                      <br />
                      {l.code.slice(3)}
                    </>
                  ) : (
                    formatLabelCode(l.code)
                  )}
                </Box>
              </Box>
            </Box>
          )
        })}
        {!labels.length && (
          <Typography color="text.secondary" sx={{ py: 6 }}>
            {t('print.empty')}
          </Typography>
        )}
      </Box>
    </Box>
  )
}
