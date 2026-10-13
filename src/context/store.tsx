import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { AppStore, StoreState } from '../lib/store.ts'

const Ctx = createContext<AppStore | null>(null)

export function StoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useStore(): AppStore {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider missing')
  return s
}

export function useAppState(): StoreState {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

export function useSnap() {
  return useAppState().snap
}
