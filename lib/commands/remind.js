/**
 * /remind —— 定时主动私聊（提醒）。
 *
 * 群主动消息被平台关闭，私聊主动可用，所以这个功能只在私聊里落地，
 * 且固定发给主人（配置里的 owner.openid）。
 */
import { getScopePeer, sendMarkdownChunked } from '../shared/index.js';
import { ownerOrOpen } from './voice.js';
import { getReminderStore } from '../features/reminders.js';
export function remindCommand({ config, logger }) {
    const store = getReminderStore();
    return {
        name: 'remind',
        category: 'agent',
        scope: 'all',
        authorized: ownerOrOpen(config, 'remind.allowAnyone'),
        description: '定时主动私聊提醒（用法: /remind 09:00 吃药 | list | del <id> | on | off）',
        handler: async (cmdCtx) => {
            const { peerId } = getScopePeer(cmdCtx);
            const raw = (cmdCtx.command?.raw ?? '').trim();
            const args = raw.toLowerCase();
            const owner = config.owner?.openid ?? '';
            if (owner === '')
                return '还没配置主人 openid（`owner.openid`），无法确定要把提醒发给谁。';
            // 列表
            if (!args || args === 'list') {
                const items = store.list();
                if (items.length === 0) {
                    return store.enabled
                        ? '还没有提醒。加一条：`/remind 09:00 吃药`'
                        : '提醒已关闭（`/remind on` 恢复）。';
                }
                const lines = [`### ⏰ 提醒（${store.enabled ? '开启' : '关闭'}）`, ''];
                for (const [i, item] of items.entries()) {
                    lines.push(`${i + 1}. \`${item.time}\` ${item.weekdaysOnly ? '（仅工作日）' : '（每天）'} — ${item.text}  \`${item.id}\``);
                }
                lines.push('', '删除：`/remind del <序号或 id>`；暂停全部：`/remind off`');
                await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
                return { kind: 'noop' };
            }
            if (args === 'on' || args === 'off') {
                store.setEnabled(args === 'on');
                return args === 'on' ? '✅ 提醒已开启。' : '✅ 提醒已暂停（记录保留）。';
            }
            if (args.startsWith('del ')) {
                const key = raw.slice(4).trim();
                const items = store.list();
                const byId = items.find((i) => i.id === key);
                const byIndex = /^\d+$/.test(key) ? items[Number(key) - 1] : undefined;
                const target = byId ?? byIndex;
                if (!target)
                    return `没找到这条提醒：${key}`;
                store.remove(target.id);
                logger.info(`reminder removed: ${target.id}`);
                return `✅ 已删除：\`${target.time}\` ${target.text}`;
            }
            // 新增：支持 "09:00 内容" 或 "weekday 09:00 内容"
            let rest = raw;
            let weekdaysOnly = false;
            if (/^weekday\s+/i.test(rest)) {
                weekdaysOnly = true;
                rest = rest.replace(/^weekday\s+/i, '');
            }
            const m = /^(\d{1,2}:\d{2})\s+([\s\S]+)$/.exec(rest);
            if (!m) {
                return [
                    '用法：',
                    '- `/remind 09:00 吃药` 每天 9 点提醒',
                    '- `/remind weekday 09:00 上班` 仅工作日',
                    '- `/remind list` 查看',
                    '- `/remind del <序号或 id>` 删除',
                    '- `/remind off` / `/remind on` 暂停 / 恢复',
                ].join('\n');
            }
            const outcome = store.add(m[1], m[2], owner, weekdaysOnly);
            if (!outcome.ok) {
                if (outcome.reason === 'bad-time')
                    return `时间格式不对：${m[1]}，要 24 小时制 HH:MM。`;
                if (outcome.reason === 'duplicate')
                    return '已经有同样的提醒了。';
                return '添加失败。';
            }
            logger.info(`reminder added: ${outcome.item.id} ${outcome.item.time}`);
            return `✅ 已添加：每天 ${m[1]}${weekdaysOnly ? '（仅工作日）' : ''} 主动私聊你「${m[2]}」`;
        },
    };
}