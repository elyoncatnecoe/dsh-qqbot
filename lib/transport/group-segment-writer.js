/**
 * 群聊「分段首发」写入器。
 *
 * 背景：QQ 开放平台只对单聊开放 stream_messages（SDK 的 openStream 对非 c2c
 * 直接抛错），群聊没有流式端点，原插件在群聊里只能等整轮生成完再一次性发送。
 *
 * 这里做的是体感优化，而非流式：回复还在生成时，一旦累积到阈值就先发一小段
 * （尽量在句末断句），剩下的等下一段或轮末再发。每段都是一条独立的被动回复，
 * 受平台的「每条消息最多回复 5 次」与插件 replyLimiter(4) 约束，所以默认只
 * 切 3 段，留一段余量。
 *
 * 与 StreamingWriter 的区别：不 openStream、不做全量替换，只做「发出去就不再改」。
 */
/** 断句边界：中英文句末标点与换行 */
const BOUNDARY = /[。！？!?；;…\n]/
export class GroupSegmentWriter {
    pending = '';
    segments = 0;
    lastAt = 0;
    timer = null;
    finished = false;
    failed = false;
    chain = Promise.resolve();
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /** 追加增量文本，达到阈值后安排一次分段发送 */
    append(delta) {
        if (this.finished || this.failed)
            return;
        this.pending += delta;
        this.schedule();
    }
    /** 重置累积文本（LLM 重试的新 attempt）：已发出的段不回收，只丢弃未发内容 */
    reset() {
        if (this.finished)
            return;
        this.pending = '';
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    /** 安排一次延迟发送：距上次发送不足 minIntervalMs 时等一等，避免瞬间连发 */
    schedule() {
        if (this.finished || this.failed || this.timer !== null)
            return;
        if (this.segments >= this.deps.maxSegments)
            return;
        if (this.pending.trim().length < this.deps.firstChars)
            return;
        const wait = Math.max(0, this.deps.minIntervalMs - (Date.now() - this.lastAt));
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flushPartial();
        }, wait);
        // 不阻塞进程退出
        if (typeof this.timer?.unref === 'function')
            this.timer.unref();
    }
    /** 切出并发送一段（保留剩余继续累积） */
    flushPartial() {
        if (this.finished || this.failed)
            return;
        if (this.segments >= this.deps.maxSegments)
            return;
        const text = this.pending;
        if (text.trim().length < this.deps.firstChars)
            return;
        const cut = pickCut(text, this.deps.firstChars);
        const part = text.slice(0, cut).trim();
        if (!part)
            return;
        this.pending = text.slice(cut);
        this.segments += 1;
        this.lastAt = Date.now();
        this.send(part);
        if (this.pending.trim().length >= this.deps.firstChars)
            this.schedule();
    }
    /** 串行发送一段，失败即停止后续分段（避免连续 40034005 打满日志） */
    send(text) {
        this.chain = this.chain.then(async () => {
            if (this.failed)
                return;
            try {
                await this.deps.bot.sendMarkdown(this.deps.target, text);
                this.deps.logger.debug?.(`im-qqbot: group segment sent (chars=${text.length}, n=${this.segments})`);
            }
            catch (err) {
                this.failed = true;
                this.deps.logger.warn(`im-qqbot: group segment failed, stop segmenting: ${err instanceof Error ? err.message : String(err)}`);
            }
        });
    }
    /** 轮末收尾：把剩余文本作为最后一段发掉 */
    async finish() {
        if (this.finished)
            return;
        this.finished = true;
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const rest = this.pending.trim();
        this.pending = '';
        if (rest && !this.failed)
            this.send(rest);
        await this.chain;
    }
    /** 中止（异常/取消）：清掉定时器，剩余不再发送 */
    abort() {
        if (this.finished)
            return;
        this.finished = true;
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.pending = '';
    }
}
/**
 * 选切点：优先在 firstChars 之前最近的句末标点处断开，避免把句子切一半；
 * 但标点太靠前（不足下限）时宁可按长度硬切，否则首段会太短没信息量。
 */
function pickCut(text, minChars) {
    const limit = Math.min(text.length, Math.max(1, minChars));
    if (text.length <= limit)
        return text.length;
    const floor = Math.max(1, Math.floor(limit * 0.4));
    for (let i = limit - 1; i >= floor; i -= 1) {
        if (BOUNDARY.test(text[i]))
            return i + 1;
    }
    return limit;
}
//# sourceMappingURL=group-segment-writer.js.map