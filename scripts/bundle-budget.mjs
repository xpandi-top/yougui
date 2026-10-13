#!/usr/bin/env node
// 体积预算（gzip）：首屏 JS、单个最大文件、precache 总量。超出即失败。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = new URL('../dist/', import.meta.url).pathname
const BUDGET = {
  initialJsGzip: 260 * 1024, // index.html 直接引用的 JS（含 vendor）
  largestFileGzip: 170 * 1024,
  distTotal: 4 * 1024 * 1024,
}

const files = []
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else files.push(p)
  }
}
walk(DIST)
const gz = (p) => gzipSync(readFileSync(p)).length
const html = readFileSync(join(DIST, 'index.html'), 'utf8')
const initial = [...html.matchAll(/(?:src|href)="[^"]*?(assets\/[^"]+\.js)"/g)].map((m) => join(DIST, m[1]))
const initialGz = initial.reduce((n, p) => n + gz(p), 0)
const jsFiles = files.filter((f) => f.endsWith('.js'))
const largest = jsFiles.map((p) => ({ p, g: gz(p) })).sort((a, b) => b.g - a.g)[0]
const total = files.reduce((n, p) => n + statSync(p).size, 0)

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
const rows = [
  ['首屏 JS（gzip）', initialGz, BUDGET.initialJsGzip],
  [`最大文件 ${largest.p.replace(DIST, '')}（gzip）`, largest.g, BUDGET.largestFileGzip],
  ['dist 总量', total, BUDGET.distTotal],
]
let ok = true
for (const [name, v, max] of rows) {
  const pass = v <= max
  ok &&= pass
  console.log(`${pass ? '✓' : '✗'} ${name}: ${kb(v)} / ${kb(max)}`)
}
if (!ok) process.exit(1)
