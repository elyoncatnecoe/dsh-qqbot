/**
 * /prompt —— 查看或切换人格文案。
 *
 * 预制文案在 prompts/*.md（带 {{name}} 占位）。同时提供 prompts/*.txt 的无占位版本，
 * 供想「全局覆盖」的人在插件设置页里手动粘贴。
 */
import { getScopePeer, sendMarkdownChunked } from '../shared/index.js';
import { getPersona, PERSONA_IDS, loadPersonaPrompt } from '../features/personas.js';
import { getPrefs } from '../features/prefs.js';
export function promptCommand({ config, logger }) {
    const prefs = getPrefs();
    return {
        name: 'prompt',
        category: 'agent',
        scope: 'all',
        description: '查看或切换人格文案（用法: /prompt | /prompt female | /prompt show male）',
        handler: async (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const raw = (cmdCtx.command?.raw ?? '').trim();
            const args = raw.toLowerCase().split(/\s+/).filter(Boolean);
            const botName = config.persona?.name || 'Deepseek';
            const owner = config.owner?.openid ?? '';
            const isOwner = owner !== '' && peerId === owner;
            const currentId = prefs.peer(scope, peerId).persona ?? config.persona?.id ?? 'female';
            const render = (id) => {
                const persona = getPersona(id);
                if (!persona)
                    return undefined;
                const text = loadPersonaPrompt(persona, botName);
                return [
                    `**人格：${persona.label}（${persona.id}）** · 音色 ${persona.voicePreset} · 形象 ${persona.avatar}`,
                    '',
                    text,
                ].join('\n');
            };
            // 只看不切
            if (args[0] === 'show') {
                const target = args[1] ?? currentId;
                const body = render(target);
                if (body === undefined)
                    return `未知人格：${target}。可选：${PERSONA_IDS.join(' / ')}`;
                await sendMarkdownChunked(cmdCtx, body, config.textChunkLimit);
                return { kind: 'noop' };
            }
            // 切换
            if (args.length > 0) {
                if (!isOwner && !prefs.flag('persona.allowAnyone')) {
                    return '只有主人能切换人格文案（`/prompt show <id>` 可以看任何一套）。';
                }
                const persona = getPersona(args[0]);
                if (persona === undefined)
                    return `未知人格：${args[0]}。可选：${PERSONA_IDS.join(' / ')}`;
                prefs.setPeer(scope, peerId, { persona: persona.id, voicePreset: persona.voicePreset });
                logger.info(`prompt persona switched: ${scope}:${peerId} → ${persona.id}`);
                await sendMarkdownChunked(cmdCtx, render(persona.id), config.textChunkLimit);
                return { kind: 'noop' };
            }
            // 无参数：显示当前这套
            const body = render(currentId) ?? '当前没有人格文案。';
            const others = PERSONA_IDS.filter((i) => i !== currentId);
            const footer = [
                '',
                '---',
                '查看另一套：' + others.map((i) => '`/prompt show ' + i + '`').join(' 或 '),
                '切换：' + PERSONA_IDS.map((i) => '`/prompt ' + i + '`').join(' 或 '),
                '想全局覆盖（对所有会话生效）：把包里 `prompts/global-' + currentId + '.txt` 的内容粘到插件设置页的「个性化提示词」里。',
            ].join('\n');
            await sendMarkdownChunked(cmdCtx, `${body}${footer}`, config.textChunkLimit);
            return { kind: 'noop' };
        },
    };
}
//# sourceMappingURL=prompt.js.map