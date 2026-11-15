/**
 * 未知斜杠指令兜底。
 *
 * SDK 的 slashCommand 遇到未注册的 `/xxx` 会 `next()` 放行，于是整句话
 * 落到 agent 那里——模型会去翻工作区、调搜索工具，既费 token 又答非所问。
 * 这里在 slash 之后接一层：以 `/` 开头但没被任何指令接住的，直接回提示。
 */
/** 匹配「以斜杠开头且不是纯符号」的消息 */
const SLASH_LIKE = /^[/／][a-zA-Z][\w-]*/;
export function unknownSlashHint(getCommands) {
    return async (ctx, next) => {
        const text = String(ctx.message?.content ?? '').trim();
        if (!SLASH_LIKE.test(text) || ctx.state?.command !== undefined) {
            await next();
            return;
        }
        const typed = text.split(/\s+/)[0] ?? text;
        let names = [];
        try {
            names = getCommands().map((cmd) => cmd.name).filter((n) => typeof n === 'string');
        }
        catch {
            names = [];
        }
        const hint = names.length > 0
            ? `没有 \`${typed}\` 这个指令。\n可用：${names.slice(0, 12).map((n) => `\`/${n}\``).join(' ')}\n完整列表发 \`/bot-help\``
            : `没有 \`${typed}\` 这个指令，发 \`/bot-help\` 看完整列表。`;
        try {
            await ctx.bot.sendText(ctx.replyTarget, hint);
        }
        catch {
            /* 回不了就算了，别让兜底本身炸掉链路 */
        }
        ctx.stop(`unknown-slash:${typed}`);
    };
}