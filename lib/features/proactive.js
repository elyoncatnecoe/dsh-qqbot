/**
 * 群聊主动接话（窗口内随机调度）。
 *
 * 平台约束（实测）：
 * - 群聊只推 GROUP_AT_MESSAGE_CREATE，即**只有被 @ 才收得到事件**；
 * - 每条入站消息带来 5 分钟被动回复窗口，插件 replyLimiter 限 4 次；
 * - 超过窗口/次数再发就会落到「主动消息」，平台拒绝（40034105）。
 *
 * 因此这里做的是「把一次 @ 的额度用满、摊开」：收到消息并回完之后，在剩余窗口内
 * 随机安排若干次主动发言，间隔抖动，次数受 replyLimiter 剩余额度约束。看起来像
 * 它在群里持续接话；窗口一关就自然停下，不做任何越界尝试。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { getCachedReplyIds } from '../transport/msgid-cache.js';
/** 群被动回复窗口，与 msgid-cache 的 TTL_GROUP 一致 */
const GROUP_WINDOW_MS = 5 * 60 * 1000;
/** 触发时留的窗口余量：太靠近 5 分钟边界时消息可能刚好过期 */
const WINDOW_SAFETY_MS = 45 * 1000;
function peerKey(scope, peerId) {
    return `${scope}:${peerId}`;
}
/** [min, max) 区间取整随机 */
function randInt(min, max) {
    if (max <= min)
        return min;
    return min + Math.floor(Math.random() * (max - min));
}
export class ProactiveChat {
    manager;
    config;
    logger;
    limiter;
    /** 每个群最近一次「机器人自己发出去」的时间 */
    spokeAt = new Map();
    /** 每个群在途的调度任务（新一轮入站会重置） */
    timers = new Map();
    disposed = false;
    stats = {
        build: 4,
        planned: 0,
        fired: 0,
        skippedWindow: 0,
        skippedExpiry: 0,
        skippedBudget: 0,
        skippedAlreadyReplied: 0,
        skippedNoSession: 0,
        skippedBusy: 0,
        failed: 0,
        lastFireAt: 0,
    };
    constructor(deps) {
        this.manager = deps.manager;
        this.config = deps.config;
        this.logger = deps.logger;
        this.limiter = deps.limiter;
    }
    /** 发送适配器记录一次对外发送（判断「这轮说没说话」） */
    noteSpeak(scope, targetId) {
        if (scope !== 'group')
            return;
        this.spokeAt.set(peerKey(scope, targetId), Date.now());
    }
    /** replyLimiter 晚于本对象创建，装配后补进来 */
    setLimiter(limiter) {
        this.limiter = limiter;
    }
    /** 取消该群所有在途调度 */
    clearTimers(key) {
        const timers = this.timers.get(key);
        if (!timers)
            return;
        for (const timer of timers)
            clearTimeout(timer);
        timers.clear();
        this.timers.delete(key);
    }
    /**
     * 入站收敛后调用：按剩余额度在窗口内随机排若干次主动发言。
     */
    onInboundSettled(scope, peerId, inboundAt) {
        if (this.disposed || this.config.enabled !== true)
            return;
        if (scope !== 'group')
            return;
        const key = peerKey(scope, peerId);
        // 新一轮入站 = 新窗口新额度，旧的待发计划作废（避免重复抢同一批额度）
        this.clearTimers(key);
        const record = this.manager.getSessionRecord(scope, peerId);
        const msgId = record?.replyTarget?.msgId;
        if (msgId === undefined) {
            this.logger.debug?.(`im-qqbot: proactive skipped (no msgId) key=${key}`);
            return;
        }
        // 额度：limit 4 - 已用。留 1 次余量给「用户追问后真正的回复」
        const limit = this.limiter?.checkLimit(msgId);
        const remaining = limit?.remaining ?? this.maxNudges();
        const budget = Math.max(0, Math.min(this.maxNudges(), remaining - 1));
        if (budget <= 0) {
            this.logger.debug?.(`im-qqbot: proactive skipped (no budget) key=${key}`);
            return;
        }
        // 随机决定这次到底说几句（1..budget），避免每条都是固定次数
        const count = randInt(Math.min(1, budget), budget + 1);
        const minDelay = this.minDelay();
        const maxDelay = Math.min(this.maxDelay(), GROUP_WINDOW_MS - WINDOW_SAFETY_MS);
        const offsets = [];
        for (let i = 0; i < count; i += 1) {
            // 越靠后的越晚，整体摊在窗口里；再加抖动
            const base = minDelay + ((maxDelay - minDelay) * i) / Math.max(1, count - 1 || 1);
            offsets.push(Math.round(base + (Math.random() - 0.5) * (maxDelay - minDelay) * 0.25));
        }
        offsets.sort((a, b) => a - b);
        const set = new Set();
        this.timers.set(key, set);
        for (const [index, offset] of offsets.entries()) {
            this.stats.planned += 1;
            const timer = setTimeout(() => {
                set.delete(timer);
                void this.fire(scope, peerId, inboundAt, index === 0);
            }, Math.max(1000, offset));
            if (typeof timer?.unref === 'function')
                timer.unref();
            set.add(timer);
        }
        this.logger.info(`im-qqbot: proactive planned ${count} nudge(s) key=${key} offsets=${offsets.join(',')}ms budget=${budget}`);
    }
    async fire(scope, peerId, inboundAt, isFirst) {
        if (this.disposed)
            return;
        const key = peerKey(scope, peerId);
        const cached = getCachedReplyIds(scope, peerId);
        if (cached.length === 0) {
            this.stats.skippedWindow += 1;
            this.logger.debug?.(`im-qqbot: proactive skipped (window closed) key=${key}`);
            return;
        }
        if (Date.now() - inboundAt > GROUP_WINDOW_MS - WINDOW_SAFETY_MS) {
            this.stats.skippedExpiry += 1;
            this.logger.debug?.(`im-qqbot: proactive skipped (window near expiry) key=${key}`);
            return;
        }
        const record = this.manager.getSessionRecord(scope, peerId);
        if (record === undefined) {
            this.stats.skippedNoSession += 1;
            return;
        }
        const msgId = record.replyTarget?.msgId;
        if (msgId !== undefined && this.limiter?.checkLimit(msgId).allowed === false) {
            this.stats.skippedBudget += 1;
            this.logger.debug?.(`im-qqbot: proactive skipped (reply budget exhausted) key=${key}`);
            return;
        }
        // 「仅在这轮没说话时才接」只约束第一次；后续几次本来就是主动补话
        if (isFirst && this.config.onlyWhenSilent !== false) {
            const spoke = this.spokeAt.get(key) ?? 0;
            if (spoke >= inboundAt) {
                this.stats.skippedAlreadyReplied += 1;
                return;
            }
        }
        if (record.agent.status !== 'idle') {
            this.stats.skippedBusy += 1;
            this.logger.debug?.(`im-qqbot: proactive skipped (agent busy: ${record.agent.status}) key=${key}`);
            return;
        }
        try {
            record.agent.followup(createUserMessage({
                content: [{ type: 'text', text: this.pickPrompt() }],
                // 必须用内置 user producer：v4 会话格式只接受已注册的 source kind
                source: { kind: 'user' },
            }));
            this.stats.fired += 1;
            this.stats.lastFireAt = Date.now();
            this.logger.info(`im-qqbot: proactive nudge fired key=${key}`);
        }
        catch (err) {
            this.stats.failed += 1;
            this.logger.warn(`im-qqbot: proactive nudge failed key=${key}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    minDelay() {
        if (Number.isFinite(this.config.minDelayMs))
            return this.config.minDelayMs;
        return Number.isFinite(this.config.delayMs) ? this.config.delayMs : 30000;
    }
    maxDelay() {
        if (Number.isFinite(this.config.maxDelayMs))
            return this.config.maxDelayMs;
        return Math.max(this.minDelay() + 60000, 240000);
    }
    maxNudges() {
        return Number.isFinite(this.config.maxNudgesPerWindow)
            ? Math.max(0, this.config.maxNudgesPerWindow)
            : 3;
    }
    /** 多条提醒文案轮换，避免每次都是同一句指令被模型复读 */
    pickPrompt() {
        const pool = Array.isArray(this.config.prompts) && this.config.prompts.length > 0
            ? this.config.prompts
            : [this.config.prompt];
        const usable = pool.filter((p) => typeof p === 'string' && p.length > 0);
        if (usable.length === 0)
            return '';
        return usable[randInt(0, usable.length)];
    }
    snapshot() {
        let pending = 0;
        for (const set of this.timers.values())
            pending += set.size;
        return {
            build: 4,
            enabled: this.config.enabled === true,
            minDelayMs: this.minDelay(),
            maxDelayMs: this.maxDelay(),
            maxNudgesPerWindow: this.maxNudges(),
            onlyWhenSilent: this.config.onlyWhenSilent !== false,
            pendingTimers: pending,
            peers: [...this.spokeAt.keys()],
            ...this.stats,
        };
    }
    dispose() {
        this.disposed = true;
        for (const key of [...this.timers.keys()])
            this.clearTimers(key);
        this.spokeAt.clear();
    }
}
//# sourceMappingURL=proactive.js.map