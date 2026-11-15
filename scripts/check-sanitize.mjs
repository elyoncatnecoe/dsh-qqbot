#!/usr/bin/env node
/**
 * 发布前脱敏检查：仓库里不能出现个人凭据、本机路径、失效的占位。
 *
 * 这个仓库是从本地线上实例 fork 出来的，最容易带出去的就是：
 *   - QQ 机器人 appId / appSecret
 *   - 主人/群的 openid（32 位十六进制）
 *   - 本机绝对路径（Windows 盘符路径）
 *   - GitHub PAT
 *
 * 用法：node scripts/check-sanitize.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SKIP_DIRS = new Set(['node_modules', '.git'])
const TEXT_EXT = new Set(['.json', '.js', '.mjs', '.cjs', '.ts', '.yml', '.yaml', '.md', '.txt'])

/** 每一条：名称、正则、只在这些扩展名里查（空=全部） */
const RULES = [
  { name: 'GitHub PAT', re: /github_pat_[A-Za-z0-9_]{10,}/ },
  { name: '硬编码 appId', re: /appId:\s*"?(?!__FROM_ENV__|\$\{)\d{6,}"?/, ext: ['.yml', '.yaml', '.json'] },
  { name: '硬编码 appSecret', re: /appSecret:\s*(?!__FROM_ENV__|\$\{)\S+/, ext: ['.yml', '.yaml', '.json'] },
  { name: 'openid 形态（32 位大写十六进制）', re: /\b[A-F0-9]{32}\b/, ext: ['.yml', '.yaml'], onlyIfLine: /openid|Allow|allow/i },
  { name: '本机绝对路径（Windows 用户目录）', re: /[A-Za-z]:\\\\Users\\\\[^\\\s]+/ },
  { name: '本机工作区路径', re: /webs[\\/]+rikkamem/i },
  { name: '内联 DeepSeek key', re: /DEEPSEEK_API_KEY:\s*["']?[A-Za-z0-9_-]{20,}/ },
]

const hits = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full)
      continue
    }
    const dot = name.lastIndexOf('.')
    const ext = dot < 0 ? '' : name.slice(dot).toLowerCase()
    if (!TEXT_EXT.has(ext)) continue
    const text = readFileSync(full, 'utf8')
    const lines = text.split('\n')
    for (const rule of RULES) {
      if (rule.ext && !rule.ext.includes(ext)) continue
      lines.forEach((line, i) => {
        if (rule.onlyIfLine && !rule.onlyIfLine.test(line)) return
        if (rule.re.test(line)) {
          hits.push({ file: relative(ROOT, full), line: i + 1, rule: rule.name, sample: line.trim().slice(0, 80) })
        }
      })
    }
  }
}

walk(ROOT)

if (hits.length > 0) {
  console.error('脱敏检查未通过：')
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.rule}]  ${h.sample}`)
  console.error('\n修法：把具体值换成占位（如 __FROM_ENV__）或写进 profile 配置，不要进仓库。')
  process.exit(1)
}

console.log('OK：未发现个人凭据或本机路径')