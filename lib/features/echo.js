/**
 * 表情包复读 —— 有人 @ 机器人并带图时，偶尔把那张图原样发回去。
 *
 * 刻意「不总是」复读：小图、冷却期内未复读、概率命中，三者都满足才发。
 * 群里只能看到 @ 自己的消息，所以复读对象天然只有「发给它的那张图」。
 */
/** 每次判断的随机源可注入，便于测试 */
export class EchoPolicy {
    config;
    lastEchoAt = new Map();
    random;
    constructor(config, random = Math.random) {
        this.config = config;
        this.random = random;
    }
    get enabled() {
        return this.config?.enabled !== false;
    }
    /** 判断这条消息要不要复读；返回原因便于日志 */
    decide(scope, peerId, image) {
        if (!this.enabled)
            return { echo: false, reason: 'disabled' };
        if (!image)
            return { echo: false, reason: 'no-image' };
        const maxBytes = Number.isFinite(this.config?.maxBytes) ? this.config.maxBytes : 2 * 1024 * 1024;
        if (typeof image.size === 'number' && image.size > maxBytes)
            return { echo: false, reason: 'too-large' };
        const cooldown = Number.isFinite(this.config?.cooldownMs) ? this.config.cooldownMs : 10 * 60 * 1000;
        const last = this.lastEchoAt.get(`${scope}:${peerId}`) ?? 0;
        if (Date.now() - last < cooldown)
            return { echo: false, reason: 'cooldown' };
        const probability = Number.isFinite(this.config?.probability) ? this.config.probability : 0.5;
        if (this.random() > probability)
            return { echo: false, reason: 'dice' };
        return { echo: true, reason: 'hit' };
    }
    /** 记一次复读，用于冷却 */
    markEchoed(scope, peerId) {
        this.lastEchoAt.set(`${scope}:${peerId}`, Date.now());
    }
}
/** 从附件里挑一张符合条件的图片（表情类：小尺寸 png/jpg/gif/webp） */
export function pickEchoImage(attachments, downloaded) {
    if (!Array.isArray(attachments) || attachments.length === 0)
        return undefined;
    const byName = new Map((downloaded ?? []).map((d) => [d.filename, d]));
    for (const att of attachments) {
        const type = String(att.content_type ?? '').toLowerCase();
        if (!type.startsWith('image/'))
            continue;
        const local = byName.get(att.filename)?.localPath;
        return { filename: att.filename, localPath: local, url: att.url, size: att.size };
    }
    return undefined;
}