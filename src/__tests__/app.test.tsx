import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '../App.tsx'
import { Providers } from '../Providers.tsx'
import { updateSettings } from '../lib/settings.ts'
import { AppStore } from '../lib/store.ts'

let store: AppStore

beforeEach(async () => {
  updateSettings({ lang: 'zh' })
  location.hash = '#/'
  store = await AppStore.open(`ui-${Date.now()}-${Math.random()}`)
})
afterEach(() => store.close())

describe('应用冒烟', () => {
  it('首次使用 → 建家庭与房间 → 首页显示房间', async () => {
    render(
      <Providers store={store}>
        <App />
      </Providers>,
    )
    expect(await screen.findByText('先建几个房间')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    })
    expect(await screen.findByText('家里的位置')).toBeTruthy()
    expect(await screen.findByText('书房')).toBeTruthy()
    expect(store.getState().household?.name).toBe('我的家')
    // 预设房间带房间图标（rooms-*）
    const icons = Object.values(store.getState().snap.entities).map((e) => [e.name, e.iconKey])
    expect(icons).toEqual(expect.arrayContaining([['书房', 'rooms-study'], ['厨房', 'rooms-kitchen']]))
  })
})
