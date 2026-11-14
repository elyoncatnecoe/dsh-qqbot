/**
 * /persona —— 切换人格套装（音色 + 形象图 + 人格 prompt 一起变）。
 */
import { getScopePeer, sendMarkdownChunked } from '../shared/index.js';
import { PERSONAS, PERSONA_IDS, getPersona, personaSummary } from '../features/personas.js';
import { getPrefs } from '../features/prefs.js';
import { ownerOrOpen } from './voice.js';
export function personaCommand({ config, logger }) {
    const prefs = getPrefs();
    return {
        name: 'persona',
        category: 'agent',
        scope: 'all',
        authorized: ownerOrOpen(config, 'persona.allowAnyone'),
        description: '查看或切换人格套装（用法: /persona [female|male|reset|open|close]）',
        handler: async (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const args = (cmdCtx.command?.raw ?? '').trim().toLowerCase();
            const isOwner = (config.owner?.openid ?? '') !== '' && peerId === config.owner.openid;
            if (!args) {
                const current = prefs.peer(scope, peerId).persona ?? config.persona?.id ?? 'female';
                const lines = ['### 🎭 人格套装', ''];
                lines.push(`**当前:** ${current}（${config.persona?.name ?? 'Deepseek'}）`);
                lines.push('', '**可切换:**');
                for (const id of PERSONA_IDS) {
                    lines.push(`<qqbot-cmd-input text="/persona ${id}" show="/persona ${PERSONAS[id].label} · ${id}"/>`);
                }
                lines.push('', '重置: `/persona reset`');
                if (isOwner) {
                    lines.push(`开放给其他人: \`/persona open\`（当前${prefs.flag('persona.allowAnyone') ? '已开放' : '仅主人可用'}）`);
                }
                await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
                return { kind: 'noop' };
            }
            if (args === 'open' || args === 'close') {
                if (!isOwner)
                    return '只有主人能开放这个权限。';
                prefs.setFlag('persona.allowAnyone', args === 'open');
                return args === 'open' ? '✅ 已开放：所有人都能切换人格。' : '✅ 已收回：恢复为仅主人可切换。';
            }
            if (args === 'reset' || args === 'default') {
                prefs.clearPeer(scope, peerId, 'persona');
                prefs.clearPeer(scope, peerId, 'voicePreset');
                return '✅ 已重置为默认人格。';
            }
            const persona = getPersona(args);
            if (persona === undefined)
                return `未知人格：${args}\n可选：${PERSONA_IDS.join(' / ')}`;
            prefs.setPeer(scope, peerId, { persona: persona.id, voicePreset: persona.voicePreset });
            logger.info(`persona set: ${scope}:${peerId} → ${persona.id} (${personaSummary(persona)})`);
            return `✅ 已切换：${persona.label}\n音色 ${persona.voicePreset}，形象 ${persona.avatar}。`;
        },
    };
}