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

describe('附件默认名称', () => {
  it('相机默认名改用物品名；有意义的文件名保留；独立照片用时间', async () => {
    const { defaultAttachmentName, isGenericFileName } = await import('../lib/files.ts')
    for (const n of ['image.jpg', 'IMG_1234.HEIC', 'PXL_20261013_120301.jpg', 'photo (2).png', 'DSC0001.JPG', '截屏2026-10-13 12.00.01.png']) expect(isGenericFileName(n), n).toBe(true)
    expect(isGenericFileName('costco-receipt.pdf')).toBe(false)
    expect(defaultAttachmentName('image.jpg', true, '生抽酱油', '照片 10/13')).toBe('生抽酱油')
    expect(defaultAttachmentName('costco-receipt.pdf', false, '生抽酱油', '文档')).toBe('costco-receipt')
    expect(defaultAttachmentName('scan.pdf', false, '电钻', '文档')).toBe('电钻')
    expect(defaultAttachmentName('image.jpg', true, undefined, '照片 10/13 12:00')).toBe('照片 10/13 12:00')
  })
})
