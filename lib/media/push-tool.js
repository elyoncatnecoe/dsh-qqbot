/**
 * qqbot_push — 主动发文本（私聊 + 群聊）。
 *
 * 私聊主动实测可用；群聊主动需要 QQ 开放平台开通「主动消息」权限，
 * 未开通时平台返回 40034105（主动消息失败, 无权限）。本工具不再硬拦截，
 * 而是真实调用并把平台错误原样抛出，便于开通权限后直接生效。
 */
export const PUSH_TOOL_NAME = 'qqbot_push';
const DESCRIPTION = 'Proactively send a plain-text message to a QQ chat outside a reply window. '
    + 'Use it for scheduled reminders, task-completion notices, or anything the user should be told without asking first. '
    + 'Private chat (c2c) always works; group targets require the bot to have the platform "proactive message" permission, '
    + 'otherwise the platform rejects with 40034105.';
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
export function registerPushTool(ctx, bot, config, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger.warn('im-qqbot: tools 服务不可用，qqbot_push 未注册');
        return;
    }
    const ownerOpenid = config.owner?.openid ?? '';
    const definition = {
        name: PUSH_TOOL_NAME,
        description: DESCRIPTION,
        parameters: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要发送的文本（Markdown 允许）。' },
                target: { type: 'string', description: '可选 "c2c:openid" 或 "group:groupOpenid"；省略则发给配置里的主人私聊。' },
            },
            required: ['text'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: { target: { type: 'string' }, messageId: { type: 'string' } },
                required: ['target'],
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: `已主动发送 → ${value.target}` }],
        },
        async execute(args) {
            const { text } = args;
            if (typeof text !== 'string' || text.trim().length === 0)
                throw new Error('qqbot_push: `text` 不能为空');
            let target = args.target !== undefined && args.target !== '' ? parseTarget(args.target) : undefined;
            if (args.target !== undefined && args.target !== '' && target === undefined)
                throw new Error(`qqbot_push: target 格式错误，需要 c2c:openid，收到: ${args.target}`);
            if (target === undefined) {
                if (ownerOpenid === '')
                    throw new Error('qqbot_push: 未配置 owner.openid，且未显式传 target');
                target = { scope: 'c2c', targetId: ownerOpenid };
            }
            // 不带 msgId = 主动消息（群聊需平台「主动消息」权限，否则 40034105）
            const result = await bot.sendText({ scope: target.scope, targetId: target.targetId }, text);
            const targetLabel = `${target.scope}:${target.targetId}`;
            logger.info(`im-qqbot: qqbot_push 已发送 → ${targetLabel} (${text.length} 字)`);
            return {
                target: targetLabel,
                ...(result?.id !== undefined ? { messageId: result.id } : {}),
            };
        },
    };
    tools.register(definition);
    logger.info('im-qqbot: qqbot_push 工具已注册');
}