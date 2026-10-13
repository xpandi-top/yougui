import { Box, CircularProgress } from '@mui/material'
import { Suspense, useEffect, type ReactNode } from 'react'
import { EntityPage } from './components/pages/EntityPage.tsx'
import { HomePage } from './components/pages/HomePage.tsx'
import { ItemsPage } from './components/pages/ItemsPage.tsx'
import { AddPage } from './components/pages/AddPage.tsx'
import { PlacesPage } from './components/pages/PlacesPage.tsx'
import { SearchPage } from './components/pages/SearchPage.tsx'
import { SetupPage } from './components/pages/SetupPage.tsx'
import { ErrorBoundary } from './components/ui/ErrorBoundary.tsx'
import { BottomNav, CONTENT_MAX, paperTexture } from './components/ui/Layout.tsx'
import { useAppState, useStore } from './context/store.tsx'
import { useRoute, type Route } from './hooks/useRoute.ts'
import { lazyWithRetry } from './lib/lazy.ts'
import { getSyncConfig, syncNow } from './lib/sync.ts'
import { recordError } from './lib/errors.ts'

const ScanPage = lazyWithRetry(() => import('./components/pages/ScanPage.tsx'))
const MorePage = lazyWithRetry(() => import('./components/pages/MorePage.tsx'))
const StocktakePage = lazyWithRetry(() => import('./components/pages/StocktakePage.tsx'))
const LabelsPage = lazyWithRetry(() => import('./components/pages/LabelsPage.tsx'))
const LabelPage = lazyWithRetry(() => import('./components/pages/LabelPage.tsx'))
const LabelResolvePage = lazyWithRetry(() => import('./components/pages/LabelResolvePage.tsx'))
const PrintPage = lazyWithRetry(() => import('./components/pages/PrintPage.tsx'))
const AttachmentsPage = lazyWithRetry(() => import('./components/pages/AttachmentsPage.tsx'))
const AttachmentPage = lazyWithRetry(() => import('./components/pages/AttachmentPage.tsx'))
const LogPage = lazyWithRetry(() => import('./components/pages/LogPage.tsx'))
const BackupPage = lazyWithRetry(() => import('./components/pages/BackupPage.tsx'))
const SyncPage = lazyWithRetry(() => import('./components/pages/SyncPage.tsx'))
const SettingsPage = lazyWithRetry(() => import('./components/pages/SettingsPage.tsx'))
const HelpPage = lazyWithRetry(() => import('./components/pages/HelpPage.tsx'))

/** 首次使用前也能进入的页面（恢复备份、加入云同步家庭、说明）。 */
const SETUP_EXEMPT = new Set(['backup', 'sync', 'help', 'settings'])

function renderRoute(r: Route): ReactNode {
  const [head, id] = r.parts
  switch (head ?? '') {
    case '':
      return <HomePage />
    case 'search':
      return <SearchPage />
    case 'places':
      return <PlacesPage />
    case 'e':
      return <EntityPage key={id} id={id} />
    case 'items':
      return <ItemsPage />
    case 'add':
      // 参数不同（如扫到另一个新商品码）时重新初始化表单
      return <AddPage key={r.query.toString()} />
    case 'scan':
      return <ScanPage />
    case 'more':
      return <MorePage />
    case 'stocktake':
      return <StocktakePage />
    case 'labels':
      return <LabelsPage />
    case 'label':
      return <LabelPage key={id} id={id} />
    case 'l':
      return <LabelResolvePage key={id} token={id} />
    case 'print':
      return <PrintPage />
    case 'attachments':
      return <AttachmentsPage />
    case 'a':
      return <AttachmentPage key={id} id={id} />
    case 'log':
      return <LogPage />
    case 'backup':
      return <BackupPage />
    case 'sync':
      return <SyncPage />
    case 'settings':
      return <SettingsPage />
    case 'help':
      return <HelpPage />
    default:
      return <HomePage />
  }
}

/** 开启自动同步时：启动、恢复联网、数据变化后 5 秒各同步一次。失败只记录，不打断操作。 */
function useAutoSync() {
  const store = useStore()
  const { version } = useAppState()
  useEffect(() => {
    const run = () => {
      const cfg = getSyncConfig()
      if (cfg?.auto && navigator.onLine) syncNow(store).catch(recordError)
    }
    run()
    window.addEventListener('online', run)
    return () => window.removeEventListener('online', run)
  }, [store])
  useEffect(() => {
    const cfg = getSyncConfig()
    if (!cfg?.auto || !store.dirtyRecords().length) return
    const timer = setTimeout(() => {
      if (navigator.onLine) syncNow(store).catch(recordError)
    }, 5000)
    return () => clearTimeout(timer)
  }, [store, version])
}

function Loading() {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
      <CircularProgress color="secondary" />
    </Box>
  )
}

export function App() {
  const route = useRoute()
  const { household } = useAppState()
  useAutoSync()
  const head = route.parts[0] ?? ''
  const chrome = head !== 'print'
  const needsSetup = !household && !SETUP_EXEMPT.has(head)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [route.path, needsSetup])
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', ...(chrome ? paperTexture : {}) }}>
      <Box
        component="main"
        sx={{
          maxWidth: chrome ? CONTENT_MAX : 'none',
          mx: 'auto',
          pb: chrome && !needsSetup ? 'calc(88px + env(safe-area-inset-bottom))' : 0,
          '@media print': { pb: 0 },
        }}
      >
        <ErrorBoundary key={route.path}>
          <Suspense fallback={<Loading />}>{needsSetup ? <SetupPage /> : renderRoute(route)}</Suspense>
        </ErrorBoundary>
      </Box>
      {chrome && !needsSetup && <BottomNav />}
    </Box>
  )
}
