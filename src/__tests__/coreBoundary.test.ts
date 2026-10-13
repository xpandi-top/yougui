import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// core/ 只放纯逻辑：禁止依赖框架、浏览器存储与构建工具。
const FORBIDDEN = [/from ['"]react/, /from ['"]@mui/, /from ['"]@emotion/, /from ['"]idb['"]/, /from ['"]\.\.\/(lib|components|hooks|context)/, /import\.meta/, /\blocalStorage\b/, /\bindexedDB\b/, /\bdocument\./, /\bwindow\./]

describe('core 边界', () => {
  const dir = join(__dirname, '..', 'core')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    it(`${f} 不引用框架或浏览器 API`, () => {
      // 去掉注释再检查（注释里可以提到这些名字）
      const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      for (const re of FORBIDDEN) expect(src, `${f} 命中 ${re}`).not.toMatch(re)
    })
  }
})
