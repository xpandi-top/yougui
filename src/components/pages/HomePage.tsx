import { Box, Button, ButtonBase, Chip, IconButton, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import { useMemo } from 'react'
import { LOCATION_ICON, iconById } from '../../catalog.ts'
import { countItems, rooms, unassigned, type Entity } from '../../core/index.ts'
import { useI18n, useT } from '../../context/i18n.tsx'
import { useAppState } from '../../context/store.tsx'
import { useCommit } from '../../hooks/useCommit.ts'
import { useFileUrl } from '../../hooks/useFileUrl.ts'
import { navigate } from '../../hooks/useRoute.ts'
import { SERIF } from '../../theme/theme.ts'
import { BrandMark } from '../ui/BrandMark.tsx'
import { Icon } from '../ui/Icon.tsx'
import { Card, Section } from '../ui/Layout.tsx'
import { describeOp, formatTime } from '../ui/opText.ts'

/** 房间卡片：照片封面优先，其次房间图标，最后通用房间图标。 */
function RoomCard({ room, count }: { room: Entity; count: number }) {
  const t = useT()
  const { url } = useFileUrl(room.coverId)
  const icon = iconById(room.iconKey)?.id ?? LOCATION_ICON
  return (
    <ButtonBase
      onClick={() => navigate(`/e/${room.id}`)}
      aria-label={room.name}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
        textAlign: 'left',
        minHeight: 96,
        position: 'relative',
        overflow: 'hidden',
        '&:after': url
          ? undefined
          : {
              content: '""',
              position: 'absolute',
              right: -18,
              top: -18,
              width: 64,
              height: 64,
              border: 1,
              borderColor: 'divider',
              borderRadius: '50%',
            },
      }}
    >
      {url ? (
        <Box component="img" src={url} alt="" sx={{ width: '100%', height: 84, objectFit: 'cover', display: 'block', borderBottom: 1, borderColor: 'divider' }} />
      ) : (
        <Box sx={{ color: 'primary.main', px: 1.75, pt: 1.75 }}>
          <Icon name={icon} size={30} />
        </Box>
      )}
      <Box sx={{ px: 1.75, pt: 1, pb: 1.5 }}>
        <Typography sx={{ fontWeight: 700, fontFamily: SERIF, letterSpacing: '0.08em', wordBreak: 'break-word' }}>{room.name}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t('home.roomCount', { count })}
        </Typography>
      </Box>
    </ButtonBase>
  )
}

export function HomePage() {
  const t = useT()
  const { lang } = useI18n()
  const { snap, ops, household } = useAppState()
  const { undo } = useCommit()

  const stats = useMemo(() => {
    const items = Object.values(snap.entities).filter((e) => !e.deletedAt && e.kind === 'item')
    return {
      items: items.length,
      out: items.filter((e) => e.state === 'out').length,
      unassigned: unassigned(snap).length,
    }
  }, [snap])
  const roomList = rooms(snap)
  const recent = ops.filter((o) => o.type !== 'undo' && !o.undoneBy).slice(0, 5)

  return (
    <Box sx={{ px: 2, pt: 'calc(env(safe-area-inset-top) + 12px)', pb: 2, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider', pb: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <BrandMark size={34} />
          <Typography variant="h2" component="p" sx={{ letterSpacing: '0.3em', fontSize: 22 }}>
            {t('app.name')}
          </Typography>
        </Stack>
        <Button size="small" color="inherit" onClick={() => navigate('/settings')} endIcon={<Icon name="settings" size={16} />}>
          {household?.name}
        </Button>
      </Stack>

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: '0.35em' }}>
          {t('home.eyebrow')}
        </Typography>
        <Typography variant="h1" sx={{ mt: 0.5 }}>
          {t('home.slogan')}
        </Typography>
      </Box>

      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          bgcolor: '#35463D',
          color: '#F4EFE5',
          borderRadius: 1,
          p: 2.5,
          boxShadow: 'inset 0 0 0 6px #35463D, inset 0 0 0 7px rgba(181,181,154,.45)',
          '&:before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(145deg, transparent 55%, rgba(166,181,155,.06) 55%, rgba(166,181,155,.06) 68%, transparent 68%)',
            pointerEvents: 'none',
          },
        }}
      >
        <Box sx={{ display: 'inline-block', border: 1, borderColor: 'rgba(244,239,229,.35)', px: 1, py: 0.25, fontSize: 12, mb: 2 }}>
          {t('home.heroBadge', { name: household?.name ?? '', count: stats.items })}
        </Box>
        <Typography variant="h3" component="p" sx={{ color: 'inherit', mb: 1, fontSize: 22 }}>
          {t('home.heroTitle')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.85, mb: 2.5, maxWidth: 260, whiteSpace: 'pre-line' }}>
          {t('home.heroBody')}
        </Typography>
        <Button
          variant="contained"
          onClick={() => navigate('/scan')}
          startIcon={<Icon name="scan" size={20} />}
          sx={{ bgcolor: '#F4EFE5', color: '#35463D', '&:hover': { bgcolor: '#fff' } }}
        >
          {t('home.startScan')}
        </Button>
        <Box sx={{ position: 'absolute', right: 20, bottom: 20 }}>
          <BrandMark size={60} tile sx={{ boxShadow: '0 2px 10px rgba(0,0,0,.25)' }} />
        </Box>
      </Box>

      <ButtonBase
        onClick={() => navigate('/search')}
        sx={{
          justifyContent: 'flex-start',
          gap: 1.25,
          px: 2,
          minHeight: 48,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'background.paper',
          color: 'text.secondary',
        }}
        aria-label={t('search.placeholder')}
      >
        <Icon name="search" size={20} />
        <Typography>{t('search.placeholder')}</Typography>
      </ButtonBase>

      <Stack direction="row" spacing={1}>
        <Button fullWidth variant="outlined" startIcon={<Icon name="add" size={18} />} onClick={() => navigate('/add')}>
          {t('home.addItem')}
        </Button>
        <Button fullWidth variant="outlined" startIcon={<Icon name="items" size={18} />} onClick={() => navigate('/add?continuous=1')}>
          {t('home.addMany')}
        </Button>
      </Stack>

      {(stats.unassigned > 0 || stats.out > 0) && (
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          {stats.unassigned > 0 && (
            <Chip clickable onClick={() => navigate('/items?f=unassigned')} label={t('home.unassigned', { count: stats.unassigned })} variant="outlined" />
          )}
          {stats.out > 0 && <Chip clickable onClick={() => navigate('/items?f=out')} label={t('home.out', { count: stats.out })} color="warning" variant="outlined" />}
        </Stack>
      )}

      <Section
        title={t('home.places')}
        action={
          <Button size="small" endIcon={<Icon name="next" size={16} />} onClick={() => navigate('/places')}>
            {t('common.all')}
          </Button>
        }
      >
        {roomList.length ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.25 }}>
            {roomList.slice(0, 8).map((r) => (
              <RoomCard key={r.id} room={r} count={countItems(snap, r.id)} />
            ))}
          </Box>
        ) : (
          <Button variant="outlined" onClick={() => navigate('/places')}>
            {t('places.addRoom')}
          </Button>
        )}
      </Section>

      <Section
        title={t('home.recent')}
        action={
          ops.length > 0 && (
            <Button size="small" endIcon={<Icon name="next" size={16} />} onClick={() => navigate('/log')}>
              {t('home.log')}
            </Button>
          )
        }
      >
        {recent.length ? (
          <Card>
            <List disablePadding dense>
              {recent.map((op, i) => (
                <ListItem
                  key={op.id}
                  divider={i < recent.length - 1}
                  secondaryAction={
                    i === 0 ? (
                      <IconButton aria-label={t('common.undo')} onClick={() => void undo(op.id)} title={t('common.undo')}>
                        <Icon name="back" size={18} />
                      </IconButton>
                    ) : undefined
                  }
                >
                  <ListItemText
                    primary={describeOp(t, op)}
                    secondary={formatTime(op.createdAt, lang)}
                    slotProps={{ primary: { sx: { wordBreak: 'break-word' } } }}
                  />
                </ListItem>
              ))}
            </List>
          </Card>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('home.noRecent')}
          </Typography>
        )}
      </Section>
    </Box>
  )
}
