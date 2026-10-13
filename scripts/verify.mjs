#!/usr/bin/env node
// 质量门禁：任何一步失败立即停止。用法：npm run verify [-- --skip-worker]
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const skipWorker = process.argv.includes('--skip-worker')
const steps = [
  ['i18n 一致性', 'node', ['scripts/i18n-check.mjs', '--strict']],
  ['core 边界类型检查', 'npx', ['tsc', '-p', 'tsconfig.core.json']],
  ['测试代码类型检查', 'npx', ['tsc', '-p', 'tsconfig.test.json', '--noEmit']],
  ['单元/组件测试', 'npx', ['vitest', 'run']],
  ['类型检查 + 生产构建', 'npm', ['run', 'build']],
  ['体积预算', 'node', ['scripts/bundle-budget.mjs']],
]
if (!skipWorker && existsSync('worker/node_modules')) {
  steps.push(['worker 类型检查', 'npm', ['--prefix', 'worker', 'run', 'typecheck']])
  steps.push(['worker 测试', 'npm', ['--prefix', 'worker', 'test']])
} else if (!skipWorker) {
  console.log('（跳过 worker：先运行 npm --prefix worker install）')
}

for (const [name, cmd, args] of steps) {
  console.log(`\n▶ ${name}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, VITE_API_URL: process.env.VITE_API_URL ?? '' } })
  if (r.status !== 0) {
    console.error(`\n✗ ${name} 失败`)
    process.exit(r.status ?? 1)
  }
}
console.log('\n✓ verify 全部通过')
