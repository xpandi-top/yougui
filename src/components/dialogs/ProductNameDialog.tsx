import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { displayProductCode, type ProductCode, type ProductDetails } from '../../core/index.ts'
import { useT } from '../../context/i18n.tsx'
import { useProductLookup } from '../../hooks/useProductLookup.ts'
import { LookupHint } from '../ui/LookupHint.tsx'

interface Props {
  product: ProductCode | null
  onClose: () => void
  onSubmit: (name: string, details: ProductDetails | null) => void
}

/** 新商品码命名：自动查询商品名作为建议；用户没输入过时才自动填入。 */
export function ProductNameDialog({ product, onClose, onSubmit }: Props) {
  const t = useT()
  const lookup = useProductLookup(product)
  const [name, setName] = useState('')
  const typed = useRef(false)
  const [applied, setApplied] = useState(false)
  useEffect(() => {
    if (product) {
      setName('')
      setApplied(false)
      typed.current = false
    }
  }, [product])
  useEffect(() => {
    if (lookup.status === 'found' && lookup.info && !typed.current) {
      setName(lookup.info.name)
      setApplied(true)
    }
  }, [lookup])
  return (
    <Dialog open={!!product} onClose={onClose} maxWidth="xs" fullWidth>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          const info = lookup.status === 'found' ? lookup.info : undefined
          onSubmit(name, info ? { name: info.name, brand: info.brand, model: info.model, category: info.category, source: info.source, at: Date.now() } : null)
        }}
      >
        <DialogTitle>{t('scan.unknownProductTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              label={t('field.name')}
              value={name}
              onChange={(e) => {
                typed.current = true
                setApplied(false)
                setName(e.target.value)
              }}
              helperText={product ? t('scan.unknownProductHelp', { code: displayProductCode(product.normalized) }) : ''}
            />
            <LookupHint state={lookup} applied={applied} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!name.trim()}>
            {t('scan.addToList')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
