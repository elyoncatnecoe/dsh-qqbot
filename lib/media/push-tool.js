/**
 * qqbot_push — 主动发文本（私聊专用，供定时推送调用）。
 *
 * 群主动推送被平台关闭（40034105），私聊主动可用（实测通过），所以本工具
 * 默认只允许 c2c；传 group 目标会直接拒绝并给出原因，避免无谓的失败调用。
 */
export const PUSH_TOOL_NAME = 'qqbot_push';
const DESCRIPTION = 'Proactively send a plain-text message to a QQ single chat (no reply window needed). '
    + 'Use it for scheduled reminders, task-completion notices, or anything the user should be told without asking first. '
    + 'Group targets are not supported: the platform disables proactive group messages.';
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
                target: { type: 'string', description: '可选 "c2c:openid"；省略则发给配置里的主人私聊。' },
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
            if (target.scope === 'group')
                throw new Error('qqbot_push: 平台已关闭群主动消息（40034105），只能发私聊');
            // 不带 msgId = 主动消息
            const result = await bot.sendText({ scope: 'c2c', targetId: target.targetId }, text);
            const targetLabel = `c2c:${target.targetId}`;
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