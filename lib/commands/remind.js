/**
 * /remind —— 定时主动消息（提醒）。
 *
 * 私聊、群聊都可落地：在群里发起就定时发到这个群，在私聊里发起就发给
 * 主人（配置里的 owner.openid，缺省回退当前私聊对象）。群聊主动消息需要
 * 平台已为该群开启主动消息权限，否则发送时会收到 40034105。
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
        description: '定时主动提醒（私聊或群聊；用法: /remind 09:00 吃药 | list | del <id> | on | off）',
        handler: async (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const raw = (cmdCtx.command?.raw ?? '').trim();
            const args = raw.toLowerCase();
            const owner = config.owner?.openid ?? '';
            // 投递目标：群里发起就发到该群；私聊里发起优先发给主人，未配置主人则回给发起人
            const deliverTarget = scope === 'group'
                ? { scope: 'group', targetId: peerId }
                : { scope: 'c2c', targetId: owner !== '' ? owner : peerId };
            const targetLabel = deliverTarget.scope === 'group' ? '本群' : '私聊你';
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
                    lines.push(`${i + 1}. \`${item.time}\` ${item.weekdaysOnly ? '（仅工作日）' : '（每天）'} [${item.scope === 'group' ? '群' : '私聊'}] — ${item.text}  \`${item.id}\``);
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
            const outcome = store.add(m[1], m[2], deliverTarget, weekdaysOnly);
            if (!outcome.ok) {
                if (outcome.reason === 'bad-time')
                    return `时间格式不对：${m[1]}，要 24 小时制 HH:MM。`;
                if (outcome.reason === 'duplicate')
                    return '已经有同样的提醒了。';
                return '添加失败。';
            }
            logger.info(`reminder added: ${outcome.item.id} ${outcome.item.time} → ${deliverTarget.scope}`);
            return `✅ 已添加：每天 ${m[1]}${weekdaysOnly ? '（仅工作日）' : ''} 主动${targetLabel === '本群' ? '发到本群' : '私聊你'}「${m[2]}」`;
        },
    };
}