import { describe, expect, it } from 'vitest'
import en from '../../assets/locales/en.json'
import zh from '../../assets/locales/zh.json'
import { DomainError } from '../core/index.ts'
import { errorText, makeT } from '../context/i18n.tsx'

describe('i18n', () => {
  it('中英文 key 完全一致', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('插值与缺 key 回退', () => {
    const t = makeT('zh')
    expect(t('toast.created', { name: '剪刀' })).toBe('已添加「剪刀」')
    expect(t('no.such.key' as never)).toBe('no.such.key')
  })

  it('DomainError 翻译成人话', () => {
    expect(errorText(makeT('zh'), new DomainError('qty.exceeds', { max: 3 }))).toBe('数量超过库存（最多 3）')
    expect(errorText(makeT('en'), new DomainError('unknown.code'))).toContain('unknown.code')
  })
})
