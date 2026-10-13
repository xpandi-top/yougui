#!/usr/bin/env node
// 检查 zh/en 文案 key 一致、占位符一致；--strict 时有差异即失败。
import { readFileSync } from 'node:fs'

const strict = process.argv.includes('--strict')
const load = (lang) => JSON.parse(readFileSync(new URL(`../assets/locales/${lang}.json`, import.meta.url), 'utf8'))
const zh = load('zh')
const en = load('en')
const problems = []
for (const k of Object.keys(zh)) if (!(k in en)) problems.push(`en 缺少 ${k}`)
for (const k of Object.keys(en)) if (!(k in zh)) problems.push(`zh 缺少 ${k}`)
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
for (const k of Object.keys(zh)) {
  if (k in en && vars(zh[k]) !== vars(en[k])) problems.push(`占位符不一致 ${k}: zh{${vars(zh[k])}} en{${vars(en[k])}}`)
  if (!String(zh[k]).trim()) problems.push(`zh 空文案 ${k}`)
}
if (problems.length) {
  console.error(problems.join('\n'))
  if (strict) process.exit(1)
} else {
  console.log(`i18n ok: ${Object.keys(zh).length} keys`)
}
