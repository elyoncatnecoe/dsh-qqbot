/**
 * 会话记忆 —— 把「它实际参与过的对话」落盘，跨会话注入。
 *
 * 注意口径：群里它只收得到 @ 自己的消息，所以群记忆天然稀疏，不是全群记忆。
 *
 * 存储：PLUGIN_HOME/memory/<scope>-<短哈希>.jsonl，每行一条 {role,text,at}。
 * 读取：注入最近 N 条（默认 12），每条截断，避免撑爆上下文。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { PLUGIN_HOME } from '../shared/dirs.js';
const MEMORY_ROOT = resolve(PLUGIN_HOME, 'memory');
const MAX_LINE_CHARS = 200;
const MAX_FILE_LINES = 200;
function fileFor(scope, peerId) {
    const hash = createHash('sha1').update(`${scope}:${peerId}`).digest('hex').slice(0, 10);
    return join(MEMORY_ROOT, `${scope}-${hash}.jsonl`);
}
function readLines(file) {
    if (!existsSync(file))
        return [];
    try {
        return readFileSync(file, 'utf8').split('\n').filter(Boolean);
    }
    catch {
        return [];
    }
}
export class MemoryStore {
    config;
    constructor(config) {
        this.config = config;
    }
    get enabled() {
        return this.config?.enabled !== false;
    }
    /** 追加一条记忆（写盘，忽略错误：记忆不该拖垮对话） */
    append(scope, peerId, role, text) {
        if (!this.enabled)
            return;
        const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_CHARS);
        if (!clean)
            return;
        try {
            mkdirSync(MEMORY_ROOT, { recursive: true });
            const file = fileFor(scope, peerId);
            const lines = readLines(file);
            lines.push(JSON.stringify({ role, text: clean, at: Date.now() }));
            const kept = lines.slice(-MAX_FILE_LINES);
            writeFileSync(file, `${kept.join('\n')}\n`, 'utf8');
        }
        catch {
            /* 记忆失败不影响对话 */
        }
    }
    /** 最近 N 条（已按保留天数过滤） */
    recent(scope, peerId, limit = 12) {
        if (!this.enabled)
            return [];
        const days = Number.isFinite(this.config?.retentionDays) ? this.config.retentionDays : 30;
        const cutoff = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
        const entries = [];
        for (const line of readLines(fileFor(scope, peerId))) {
            try {
                const parsed = JSON.parse(line);
                if (typeof parsed?.text !== 'string')
                    continue;
                if (cutoff > 0 && typeof parsed.at === 'number' && parsed.at < cutoff)
                    continue;
                entries.push({ role: parsed.role === 'assistant' ? 'assistant' : 'user', text: parsed.text, at: parsed.at });
            }
            catch { /* 跳过坏行 */ }
        }
        return entries.slice(-Math.max(1, limit));
    }
    /** 渲染成注入用的文本；没有记忆返回空串 */
    render(scope, peerId, limit = 12, botName = 'Deepseek') {
        const entries = this.recent(scope, peerId, limit);
        if (entries.length === 0)
            return '';
        const lines = [`# 你与这个会话的历史记忆（最近 ${entries.length} 条，供参考，不必逐条复述）`, ''];
        for (const e of entries) {
            const who = e.role === 'assistant' ? botName : '对方';
            lines.push(`- ${who}：${e.text}`);
        }
        return lines.join('\n');
    }
}
let singleton;
export function getMemory(config) {
    singleton ??= new MemoryStore(config);
    return singleton;
}