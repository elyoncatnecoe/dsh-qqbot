#!/usr/bin/env node
/**
 * 发布前检查：仓库里不能有带 UTF-8 BOM 的文本文件。
 *
 * 为什么要查：`package.json` 开头多一个 BOM（EF BB BF），JSON 解析器就会报
 * `Unexpected token '\uFEFF'`，插件管理器把包判成 missing，插件的行全部不加载，
 * 表现是「插件装了但完全不生效」，而且没有明显报错。这个坑在 Windows 上尤其常见：
 * 某些编辑器和 `Set-Content -Encoding UTF8` 会默默写 BOM。
 *
 * 用法：node scripts/check-bom.mjs   （CI 或发布前跑）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const EXT = new Set(['.json', '.js', '.mjs', '.cjs', '.ts', '.yml', '.yaml', '.md', '.txt'])
const SKIP = new Set(['node_modules', '.git'])

const offenders = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full)
      continue
    }
    const dot = name.lastIndexOf('.')
    if (dot < 0 || !EXT.has(name.slice(dot))) continue
    const buf = readFileSync(full)
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      offenders.push(relative(ROOT, full))
    }
  }
}

walk(ROOT)

if (offenders.length > 0) {
  console.error('发现带 BOM 的文件（会导致 package.json 解析失败）：')
  for (const f of offenders) console.error('  - ' + f)
  console.error('\n修法：删除文件头 3 字节 EF BB BF，或用不写 BOM 的编辑器另存。')
  process.exit(1)
}

console.log('OK：没有带 BOM 的文件')