import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { makeT, resolveLang } from './context/i18n.tsx'
import { Providers } from './Providers.tsx'
import { captureErrors, recordError } from './lib/errors.ts'
import { getSettings } from './lib/settings.ts'
import { AppStore } from './lib/store.ts'

async function registerServiceWorker() {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return
  try {
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
  } catch (err) {
    recordError(err)
  }
}

async function boot() {
  captureErrors()
  const el = document.getElementById('root')!
  let store: AppStore
  try {
    store = await AppStore.open()
  } catch (err) {
    recordError(err)
    const p = document.createElement('p')
    p.style.cssText = 'padding:24px;font:16px system-ui;color:#2B3A32'
    p.textContent = makeT(resolveLang(getSettings().lang))('boot.dbFailed')
    el.replaceChildren(p)
    return
  }
  // 请求持久化存储，降低浏览器自动清理本地数据的概率（用户可拒绝）
  void navigator.storage?.persist?.().catch(() => undefined)
  createRoot(el).render(
    <StrictMode>
      <Providers store={store}>
        <App />
      </Providers>
    </StrictMode>,
  )
  void registerServiceWorker()
}

void boot()
