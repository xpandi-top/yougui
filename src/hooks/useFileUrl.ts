import { useEffect, useState } from 'react'
import { useStore } from '../context/store.tsx'
import { objectUrlFor } from '../lib/files.ts'
import { ensureLocalFile } from '../lib/sync.ts'

/** 附件字节的对象 URL（本机 IndexedDB；本机没有且云端有时按需下载）。 */
export function useFileUrl(attachmentId: string | null | undefined): { url: string | null; loading: boolean; missing: boolean } {
  const store = useStore()
  const [state, setState] = useState<{ id: string | null; url: string | null; loading: boolean; missing: boolean }>({
    id: null,
    url: null,
    loading: !!attachmentId,
    missing: false,
  })
  useEffect(() => {
    if (!attachmentId) return
    let alive = true
    ensureLocalFile(store, attachmentId)
      .then((f) => {
        if (alive) setState({ id: attachmentId, url: f ? objectUrlFor(attachmentId, f.blob) : null, loading: false, missing: !f })
      })
      .catch(() => alive && setState({ id: attachmentId, url: null, loading: false, missing: true }))
    return () => {
      alive = false
    }
  }, [attachmentId, store])
  if (!attachmentId) return { url: null, loading: false, missing: false }
  if (state.id !== attachmentId) return { url: null, loading: true, missing: false }
  return state
}
