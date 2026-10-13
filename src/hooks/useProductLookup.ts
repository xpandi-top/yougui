import { useEffect, useState } from 'react'
import type { ProductCode } from '../core/index.ts'
import { useI18n } from '../context/i18n.tsx'
import { lookupProduct, type ClientLookup } from '../lib/lookup.ts'
import { useSettings } from '../lib/settings.ts'

export type LookupState = ClientLookup | { status: 'idle' } | { status: 'loading' }

/** 商品码变化时查询商品名建议；关闭设置时保持 disabled。 */
export function useProductLookup(product: ProductCode | null): LookupState & { code?: string } {
  const { lang } = useI18n()
  const { productLookup } = useSettings()
  const code = product?.normalized
  const [state, setState] = useState<LookupState & { code?: string }>({ status: 'idle' })
  useEffect(() => {
    if (!product) {
      setState({ status: 'idle' })
      return
    }
    let alive = true
    setState({ status: 'loading', code: product.normalized })
    void lookupProduct(product, lang).then((r) => alive && setState({ ...r, code: product.normalized }))
    return () => {
      alive = false
    }
  }, [code, lang, productLookup]) // eslint-disable-line react-hooks/exhaustive-deps
  return state.code === code || state.status === 'idle' ? state : { status: 'loading', code }
}
