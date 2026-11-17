/**
 * 定时主动消息（提醒）。
 *
 * 私聊与群聊主动消息都可用：私聊直接发；群聊需要 QQ 开放平台（或群主在
 * 客户端机器人设置页）为该群开启「主动消息/主动通知」，未开启时平台返回
 * 40034105（主动消息失败, 无权限）。每条提醒记录自己的 scope + targetId，
 * 因此同一个调度器可以同时给私聊和群聊投递。
 *
 * 调度器每 30 秒检查一次，命中时间就主动发送；不依赖宿主定时任务能力，
 * 也不需要用户会写 cron。
 *
 * 存储：PLUGIN_HOME/reminders.json，原子写。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PLUGIN_HOME } from '../shared/dirs.js';
const FILE = resolve(PLUGIN_HOME, 'reminders.json');
/** 每分钟检查一次；区间给足，避免定时器被拖慢后跳过整分钟 */
const TICK_MS = 30 * 1000;
function todayKey(now) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function parseHHMM(text) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!m)
        return undefined;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59)
        return undefined;
    return { hour: h, minute: min };
}
export class ReminderStore {
    state = { enabled: true, items: [] };
    constructor() {
        this.load();
    }
    load() {
        try {
            if (!existsSync(FILE))
                return;
            const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
            this.state = {
                enabled: parsed?.enabled !== false,
                items: Array.isArray(parsed?.items)
                    ? parsed.items
                        .filter((i) => typeof i?.time === 'string' && typeof i?.text === 'string')
                        // 旧记录只有 targetOpenid（纯私聊），统一补出 scope + targetId
                        .map((i) => ({
                        ...i,
                        scope: i.scope === 'group' ? 'group' : 'c2c',
                        targetId: typeof i.targetId === 'string' ? i.targetId : i.targetOpenid,
                    }))
                    : [],
            };
        }
        catch {
            this.state = { enabled: true, items: [] };
        }
    }
    save() {
        try {
            mkdirSync(dirname(FILE), { recursive: true });
            const tmp = `${FILE}.${process.pid}.tmp`;
            writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
            renameSync(tmp, FILE);
        }
        catch { /* 写失败不影响对话 */ }
    }
    list() {
        return this.state.items;
    }
    get enabled() {
        return this.state.enabled !== false;
    }
    /** 新建提醒；重复（同时间同内容）视为已存在。target = { scope, targetId } */
    add(time, text, target, weekdaysOnly = false) {
        const parsed = parseHHMM(time);
        if (!parsed)
            return { ok: false, reason: 'bad-time' };
        const clean = String(text ?? '').trim();
        if (!clean)
            return { ok: false, reason: 'empty-text' };
        if (this.state.items.some((i) => i.time === time && i.text === clean))
            return { ok: false, reason: 'duplicate' };
        const item = {
            id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
            time,
            text: clean.slice(0, 500),
            scope: target.scope === 'group' ? 'group' : 'c2c',
            targetId: target.targetId,
            weekdaysOnly,
            lastFiredOn: undefined,
        };
        this.state.items.push(item);
        this.save();
        return { ok: true, item };
    }
    remove(id) {
        const before = this.state.items.length;
        this.state.items = this.state.items.filter((i) => i.id !== id);
        if (this.state.items.length !== before) {
            this.save();
            return true;
        }
        return false;
    }
    setEnabled(value) {
        this.state.enabled = value;
        this.save();
    }
    /** 标记某条今天已触发 */
    markFired(id, dayKey) {
        const item = this.state.items.find((i) => i.id === id);
        if (!item)
            return;
        item.lastFiredOn = dayKey;
        this.save();
    }
}
/** 根据当前时间挑出该触发的提醒 */
export function dueReminders(items, now) {
    const dayKey = todayKey(now);
    const hour = now.getHours();
    const minute = now.getMinutes();
    const weekday = now.getDay() >= 1 && now.getDay() <= 5;
    return items.filter((item) => {
        const parsed = parseHHMM(item.time);
        if (!parsed)
            return false;
        if (parsed.hour !== hour || parsed.minute !== minute)
            return false;
        if (item.weekdaysOnly && !weekday)
            return false;
        return item.lastFiredOn !== dayKey;
    });
}
export class ReminderScheduler {
    store;
    bot;
    config;
    logger;
    timer = null;
    disposed = false;
    constructor(deps) {
        this.store = deps.store;
        this.bot = deps.bot;
        this.config = deps.config;
        this.logger = deps.logger;
    }
    start() {
        if (this.timer !== null)
            return;
        this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
        if (typeof this.timer?.unref === 'function')
            this.timer.unref();
        this.logger.info('im-qqbot: 提醒调度器已启动（每 30 秒检查一次）');
    }
    async tick() {
        if (this.disposed || !this.store.enabled)
            return;
        const now = new Date();
        for (const item of dueReminders(this.store.list(), now)) {
            try {
                const scope = item.scope === 'group' ? 'group' : 'c2c';
                const targetId = item.targetId ?? item.targetOpenid;
                await this.bot.sendText({ scope, targetId }, item.text);
                this.store.markFired(item.id, todayKey(now));
                this.logger.info(`im-qqbot: reminder fired ${item.id} at ${item.time} → ${scope}`);
            }
            catch (err) {
                // 失败不标记，下一分钟再试一次；连续失败会被用户看到日志
                this.logger.warn(`im-qqbot: reminder failed ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    dispose() {
        this.disposed = true;
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
let singleton;
/** 进程内单例 */
export function getReminderStore() {
    singleton ??= new ReminderStore();
    return singleton;
}
export { parseHHMM };