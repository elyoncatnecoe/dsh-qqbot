/**
 * /voice —— 查看、切换语音音色；主人可开放权限给其他人。
 *
 * 作用域按会话（群/私聊各自独立），落盘在 prefs.json。
 */
import { getScopePeer, sendMarkdownChunked } from '../shared/index.js';
import { VOICE_PRESETS, VOICE_PRESET_IDS, getVoicePreset } from '../shared/voice-presets.js';
import { getPrefs } from '../features/prefs.js';
/** 主人本人，或已被主人开放权限 */
export function ownerOrOpen(config, flagName) {
    const prefs = getPrefs();
    const owner = config.owner?.openid ?? '';
    return (cmdCtx) => {
        const { peerId } = getScopePeer(cmdCtx);
        if (owner !== '' && peerId === owner)
            return true;
        return prefs.flag(flagName);
    };
}
export function voiceCommand({ config, logger }) {
    const prefs = getPrefs();
    return {
        name: 'voice',
        category: 'agent',
        scope: 'all',
        authorized: ownerOrOpen(config, 'voice.allowAnyone'),
        description: '查看或切换语音音色（用法: /voice [预设|reset|open|close]）',
        handler: async (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const args = (cmdCtx.command?.raw ?? '').trim().toLowerCase();
            const isOwner = (config.owner?.openid ?? '') !== '' && peerId === config.owner.openid;
            if (!args) {
                const current = prefs.peer(scope, peerId).voicePreset ?? config.voice?.voiceId ?? 'loli';
                const lines = ['### 🔊 语音音色', ''];
                lines.push(`**当前:** ${current}`);
                lines.push('', '**可切换:**');
                for (const id of VOICE_PRESET_IDS) {
                    lines.push(`<qqbot-cmd-input text="/voice ${id}" show="/voice ${id} · ${VOICE_PRESETS[id].label}"/>`);
                }
                lines.push('', '重置: `/voice reset`');
                if (isOwner) {
                    lines.push(`开放给其他人: \`/voice open\`（当前${prefs.flag('voice.allowAnyone') ? '已开放' : '仅主人可用'}）`);
                }
                await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
                return { kind: 'noop' };
            }
            if (args === 'open' || args === 'close') {
                if (!isOwner)
                    return '只有主人能开放这个权限。';
                prefs.setFlag('voice.allowAnyone', args === 'open');
                return args === 'open' ? '✅ 已开放：本群/本私聊的所有人都能切换音色。' : '✅ 已收回：恢复为仅主人可切换。';
            }
            if (args === 'reset' || args === 'default') {
                prefs.clearPeer(scope, peerId, 'voicePreset');
                const fallback = config.voice?.voiceId ?? 'loli';
                logger.info(`voice pref reset: ${scope}:${peerId}`);
                return `✅ 已重置音色为默认：${fallback}`;
            }
            const preset = getVoicePreset(args);
            if (preset === undefined)
                return `未知音色：${args}\n可选：${VOICE_PRESET_IDS.join(' / ')}`;
            prefs.setPeer(scope, peerId, { voicePreset: args, voiceId: preset.voiceId, semitones: preset.semitones });
            logger.info(`voice pref set: ${scope}:${peerId} → ${args}`);
            return `✅ 音色已切换：${args}（${VOICE_PRESETS[args].label}）`;
        },
    };
}