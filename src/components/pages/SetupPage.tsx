import { Box, Button, Chip, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { LOCATION_ICON, ROOM_ICONS, suggestRoomIcon } from '../../catalog.ts'
import { createEntity } from '../../core/index.ts'
import { useT, type UiKey } from '../../context/i18n.tsx'
import { useStore } from '../../context/store.tsx'
import { useCommit } from '../../hooks/useCommit.ts'
import { navigate } from '../../hooks/useRoute.ts'
import { syncFeatureEnabled } from '../../lib/sync.ts'
import { BrandMark } from '../ui/BrandMark.tsx'
import { Icon } from '../ui/Icon.tsx'

// 预设房间来自房间图标库（rooms-*），常用的先显示，其余收在「更多房间」
const COMMON = ['living', 'bedroom', 'kitchen', 'study', 'dining', 'child', 'powder', 'bathroom', 'balcony', 'entry', 'storage', 'garage']
const DEFAULT_ON = ['living', 'bedroom', 'kitchen', 'study']

interface RoomOption {
  name: string
  icon: string | null
}

export function SetupPage() {
  const t = useT()
  const store = useStore()
  const { commit } = useCommit()
  const [name, setName] = useState(t('setup.defaultName'))
  const roomName = (key: string) => t(`room.${key}` as UiKey)
  const [rooms, setRooms] = useState<string[]>(DEFAULT_ON.map(roomName))
  const [custom, setCustom] = useState<RoomOption[]>([])
  const [customText, setCustomText] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)

  const ordered = [...ROOM_ICONS].sort((a, b) => {
    const ia = COMMON.indexOf(a.key)
    const ib = COMMON.indexOf(b.key)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const preset: RoomOption[] = (showAll ? ordered : ordered.filter((i) => COMMON.includes(i.key))).map((i) => ({ name: roomName(i.key), icon: i.id }))
  const options = [...preset, ...custom.filter((c) => !preset.some((p) => p.name === c.name))]
  const iconFor = (name: string) => ROOM_ICONS.find((i) => roomName(i.key) === name)?.id ?? custom.find((c) => c.name === name)?.icon ?? suggestRoomIcon(name)
  const toggle = (r: string) => setRooms((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]))

  async function start() {
    setBusy(true)
    await store.setHousehold(name.trim() || t('setup.defaultName'))
    if (rooms.length) {
      await commit('create', { count: rooms.length, text: rooms.join('、') }, (tx) => {
        for (const r of rooms) createEntity(tx, { kind: 'location', name: r, iconKey: iconFor(r) })
      })
    }
    navigate('/', { replace: true })
  }

  return (
    <Box sx={{ px: 3, pt: 'calc(env(safe-area-inset-top) + 40px)', pb: 6, maxWidth: 560, mx: 'auto' }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 4 }}>
        <BrandMark size={52} tile sx={{ border: 1, borderColor: 'divider' }} />
        <Typography variant="h2" component="p" sx={{ letterSpacing: '0.3em' }}>
          {t('app.name')}
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: '0.3em' }}>
        {t('home.eyebrow')}
      </Typography>
      <Typography variant="h1" sx={{ mt: 1, mb: 1.5 }}>
        {t('home.slogan')}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 4 }}>
        {t('setup.intro')}
      </Typography>

      <Stack spacing={3}>
        <TextField label={t('setup.householdName')} value={name} onChange={(e) => setName(e.target.value)} />
        <Box>
          <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
            {t('setup.rooms')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t('setup.roomsHelp')}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {options.map((o) => {
              const on = rooms.includes(o.name)
              return (
                <Chip
                  key={o.name}
                  label={o.name}
                  onClick={() => toggle(o.name)}
                  color={on ? 'primary' : 'default'}
                  variant={on ? 'filled' : 'outlined'}
                  aria-pressed={on}
                  icon={<Icon name={o.icon ?? LOCATION_ICON} size={18} />}
                  onDelete={on ? () => toggle(o.name) : undefined}
                  deleteIcon={on ? <Icon name="check" size={16} /> : undefined}
                  sx={{ minHeight: 36, '& .MuiChip-icon': { color: 'inherit' }, '& .MuiChip-deleteIcon': { color: 'inherit' } }}
                />
              )
            })}
            {!showAll && (
              <Chip label={t('setup.moreRooms', { count: ROOM_ICONS.length - COMMON.length })} variant="outlined" onClick={() => setShowAll(true)} sx={{ minHeight: 36, borderStyle: 'dashed' }} />
            )}
          </Stack>
          <Stack
            component="form"
            direction="row"
            spacing={1}
            sx={{ mt: 1.5 }}
            onSubmit={(e) => {
              e.preventDefault()
              const v = customText.trim()
              if (v && !rooms.includes(v)) {
                setRooms((s) => [...s, v])
                setCustom((c) => [...c, { name: v, icon: suggestRoomIcon(v) }])
              }
              setCustomText('')
            }}
          >
            <TextField size="small" label={t('setup.customRoom')} value={customText} onChange={(e) => setCustomText(e.target.value)} />
            <Button type="submit" variant="outlined" disabled={!customText.trim()}>
              {t('common.add')}
            </Button>
          </Stack>
        </Box>
        <Button variant="contained" color="secondary" size="large" onClick={() => void start()} disabled={busy}>
          {t('setup.start')}
        </Button>
        <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
          <Button size="small" startIcon={<Icon name="archive" size={18} />} onClick={() => navigate('/backup')}>
            {t('setup.restore')}
          </Button>
          {syncFeatureEnabled() && (
            <Button size="small" startIcon={<Icon name="storage" size={18} />} onClick={() => navigate('/sync')}>
              {t('setup.join')}
            </Button>
          )}
          <Button size="small" startIcon={<Icon name="file" size={18} />} onClick={() => navigate('/help')}>
            {t('more.help')}
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {t('setup.localNote')}
        </Typography>
      </Stack>
    </Box>
  )
}
