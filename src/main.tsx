import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { makeT, resolveLang } from './context/i18n.tsx'
import { Providers } from './Providers.tsx'
import { captureErrors, recordError } from './lib/errors.ts'
import { initPwa } from './lib/pwa.ts'
import { getSettings } from './lib/settings.ts'
import { AppStore } from './lib/store.ts'

/** 正式网址以 http 打开时跳转到 https（摄像头与 PWA 需要安全上下文）；本机与局域网地址不受影响。 */
function upgradeToHttps(): boolean {
  const pub = (import.meta.env.VITE_PUBLIC_URL as string | undefined) ?? ''
  if (location.protocol !== 'http:' || !pub.startsWith('https://')) return false
  try {
    if (new URL(pub).hostname !== location.hostname) return false
  } catch {
    return false
  }
  location.replace(`https://${location.host}${location.pathname}${location.search}${location.hash}`)
  return true
}

async function boot() {
  if (upgradeToHttps()) return
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
  void initPwa()
}

void boot()
