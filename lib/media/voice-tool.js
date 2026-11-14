/**
 * qqbot_speak — 发语音消息。
 *
 * 文本 → TTS（stella/tide wav）→ WSOLA 变调（默认 −3 半音 = 中性）→ sendVoice。
 * 可选：同一句再给主人私聊发一份（mirrorToOwner），满足「群里和私聊各发一份」。
 */
import { synthesizeVoice } from './voice.js';
import { getVoicePreset, VOICE_PRESET_IDS } from '../shared/voice-presets.js';
import { getPrefs } from '../features/prefs.js';
import { getPersona } from '../features/personas.js';
export const SPEAK_TOOL_NAME = 'qqbot_speak';
const DESCRIPTION = 'Send a voice message (spoken audio) to the current QQ conversation or a given target. '
    + 'Use it when the user asks you to say something out loud, or when a short spoken line fits better than text. '
    + 'Keep `text` short (under ~150 Chinese characters). '
    + 'Optional `preset` switches the voice on the fly: stella(女声) / tide(男声) / shota(正太) / loli(萝莉) / '
    + 'neutral(中性) / boy(少年) / uncle(大叔). Omit it to use the configured default.';
function parseTarget(input) {
    const idx = input.indexOf(':');
    if (idx <= 0)
        return undefined;
    const scope = input.slice(0, idx);
    const targetId = input.slice(idx + 1);
    if (!targetId || (scope !== 'c2c' && scope !== 'group'))
        return undefined;
    return { scope, targetId };
}
export function registerSpeakTool(ctx, mediaSender, manager, config, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger.warn('im-qqbot: tools 服务不可用，qqbot_speak 未注册');
        return;
    }
    const voice = config.voice ?? {};
    const ownerOpenid = config.owner?.openid ?? '';
    const definition = {
        name: SPEAK_TOOL_NAME,
        description: DESCRIPTION,
        parameters: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要读出来的话，尽量短。' },
                preset: { type: 'string', description: '可选音色预设：stella / tide / shota / loli / neutral / boy / uncle；省略用配置默认。' },
                target: { type: 'string', description: '可选发送目标 "c2c:openid" / "group:openid"，省略则用当前会话。' },
            },
            required: ['text'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    segments: { type: 'array', items: { type: 'object', properties: { target: { type: 'string' }, path: { type: 'string' }, cached: { type: 'boolean' } }, required: ['target', 'path', 'cached'], additionalProperties: false } },
                },
                required: ['segments'],
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: `已发送语音 ${value.segments.length} 条` }],
        },
        async execute(args, exec) {
            const { text, target, preset } = args;
            if (typeof text !== 'string' || text.trim().length === 0)
                throw new Error('qqbot_speak: `text` 不能为空');
            // 预设优先于配置；未知预设直接报错，避免静默用错音色
            const chosen = preset !== undefined && preset !== '' ? getVoicePreset(String(preset)) : undefined;
            if (preset !== undefined && preset !== '' && chosen === undefined) {
                throw new Error(`qqbot_speak: 未知音色 ${preset}，可选：${VOICE_PRESET_IDS.join(' / ')}`);
            }
            let resolved;
            if (target !== undefined && target !== '') {
                resolved = parseTarget(target);
                if (resolved === undefined)
                    throw new Error(`qqbot_speak: target 格式错误，需要 c2c:openid 或 group:openid，收到: ${target}`);
            }
            else if (exec.agent !== undefined) {
                resolved = manager.findByAgent(exec.agent)?.replyTarget;
            }
            if (resolved === undefined)
                throw new Error('qqbot_speak: 无法确定发送目标，请显式传 target');
            // 优先级：显式 preset > 本会话 /voice 设置 > 人格套装 > 全局配置
            const prefs = getPrefs();
            const perPeer = prefs.peer(resolved.scope, resolved.targetId);
            const persona = getPersona(perPeer.persona ?? config.persona?.id);
            const effective = chosen !== undefined
                ? chosen
                : (getVoicePreset(perPeer.voicePreset) ?? getVoicePreset(persona?.voicePreset ?? '') ?? voice);
            const voiceId = effective.voiceId;
            const semitones = effective.semitones;
            const synthesized = await synthesizeVoice(text, {
                voiceId,
                semitones,
                maxChars: voice.maxChars,
            });
            const sent = [];
            const send = async (t) => {
                await mediaSender.sendVoice({ scope: t.scope, targetId: t.targetId }, { localPath: synthesized.path });
                sent.push({ target: `${t.scope}:${t.targetId}`, path: synthesized.path, cached: synthesized.cached });
            };
            await send(resolved);
            // 主人私聊补一份：仅当当前目标不是主人私聊时
            const isOwnerDm = resolved.scope === 'c2c' && ownerOpenid !== '' && resolved.targetId === ownerOpenid;
            if (voice.mirrorToOwner !== false && ownerOpenid !== '' && !isOwnerDm) {
                try {
                    await send({ scope: 'c2c', targetId: ownerOpenid });
                }
                catch (err) {
                    logger.warn(`im-qqbot: mirror voice to owner failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            logger.info(`im-qqbot: qqbot_speak 已发送 ${sent.length} 条（${text.length} 字，${synthesized.semitones} 半音）`);
            return { segments: sent };
        },
    };
    tools.register(definition);
    logger.info('im-qqbot: qqbot_speak 工具已注册');
}
