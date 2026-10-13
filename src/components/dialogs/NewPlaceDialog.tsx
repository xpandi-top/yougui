import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { LOCATION_ICON, iconById, iconLabel, suggestRoomIcon } from '../../catalog.ts'
import { hasKey, useI18n, useT, type UiKey } from '../../context/i18n.tsx'
import { Icon } from '../ui/Icon.tsx'
import { IconPicker } from './Basic.tsx'

interface Props {
  open: boolean
  title: string
  label: string
  onClose: () => void
  onSubmit: (name: string, iconKey: string | null) => void
}

/** 新建房间/子位置：名称 + 图标。没手选时按名称推荐房间图标（可见、可改）。 */
export function NewPlaceDialog({ open, title, label, onClose, onSubmit }: Props) {
  const t = useT()
  const { lang } = useI18n()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<{ key: string | null } | null>(null)
  const [picking, setPicking] = useState(false)
  useEffect(() => {
    if (open) {
      setName('')
      setPicked(null)
    }
  }, [open])
  const iconKey = picked ? picked.key : suggestRoomIcon(name)
  const icon = iconById(iconKey)
  const iconText = icon ? iconLabel(icon, lang, (k) => (hasKey(`room.${k}`) ? t(`room.${k}` as UiKey) : k)) : t('icon.defaultPlace')
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onSubmit(name, iconKey)
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" label={label} value={name} onChange={(e) => setName(e.target.value)} />
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 1.5 }}>
            <Box sx={{ width: 48, height: 48, border: 1, borderColor: 'divider', borderRadius: 1, display: 'grid', placeItems: 'center', color: 'primary.main', bgcolor: 'paper.soft', flexShrink: 0 }}>
              <Icon name={icon?.id ?? LOCATION_ICON} size={28} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2">{iconText}</Typography>
              <Typography variant="caption" color="text.secondary">
                {picked ? t('icon.pickedManually') : t('icon.autoByName')}
              </Typography>
            </Box>
            <Button size="small" onClick={() => setPicking(true)}>
              {t('icon.change')}
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
      <IconPicker
        open={picking}
        value={iconKey}
        sets={['rooms', 'items']}
        title={t('icon.pickPlace')}
        onClose={() => setPicking(false)}
        onPick={(k) => {
          setPicked({ key: k })
          setPicking(false)
        }}
      />
    </Dialog>
  )
}
