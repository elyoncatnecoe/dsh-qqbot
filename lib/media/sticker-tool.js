/**
 * qqbot_sticker — 发表情包（本地图片）。
 *
 * 目录里的图片就是表情库，文件名即语义标签（fine / mocking / pray / sleeping /
 * thinking / tired / wonder）。模型传 mood 时按标签匹配，匹配不到就随机挑一张。
 * 发送走 sendImage（平台侧渲染成图片消息），不占用文本长度。
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { bundledStickerDir } from '../features/personas.js';
export const STICKER_TOOL_NAME = 'qqbot_sticker';
const DESCRIPTION = 'Send a reaction sticker (a local image) to the current QQ conversation. '
    + 'Pass `mood` to pick a matching sticker by tag, or omit it for a random one. '
    + 'Use it when a picture reaction says more than text — short and common in group chat.';
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
/** 中文/近义词 → 文件名标签，方便模型直接用中文表达情绪 */
const ALIASES = {
    好: 'fine',
    可以: 'fine',
    ok: 'fine',
    行: 'fine',
    嘲讽: 'mocking',
    嘲笑: 'mocking',
    阴阳: 'mocking',
    鄙视: 'mocking',
    祈祷: 'pray',
    拜托: 'pray',
    求: 'pray',
    许愿: 'pray',
    睡: 'sleeping',
    困: 'sleeping',
    晚安: 'sleeping',
    思考: 'thinking',
    想: 'thinking',
    琢磨: 'thinking',
    累: 'tired',
    疲惫: 'tired',
    麻了: 'tired',
    疑惑: 'wonder',
    奇怪: 'wonder',
    问号: 'wonder',
    好奇: 'wonder',
};
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
/** 列出目录里的图片（不递归，只认图片扩展名） */
function listStickers(dir) {
    if (!dir || !existsSync(dir))
        return [];
    try {
        return readdirSync(dir)
            .filter((name) => IMAGE_EXTS.has(extname(name).toLowerCase()))
            .map((name) => join(dir, name))
            .filter((path) => {
            try {
                return statSync(path).isFile();
            }
            catch {
                return false;
            }
        });
    }
    catch {
        return [];
    }
}
/** 按标签挑一张：精确 > 包含 > 随机 */
function pickSticker(files, mood) {
    if (files.length === 0)
        return undefined;
    const raw = String(mood ?? '').trim().toLowerCase();
    if (raw) {
        const tag = ALIASES[raw] ?? raw;
        const exact = files.find((f) => basename(f, extname(f)).toLowerCase() === tag);
        if (exact)
            return exact;
        const partial = files.find((f) => basename(f).toLowerCase().includes(tag));
        if (partial)
            return partial;
    }
    return files[Math.floor(Math.random() * files.length)];
}
export function registerStickerTool(ctx, mediaSender, manager, config, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger.warn('im-qqbot: tools 服务不可用，qqbot_sticker 未注册');
        return;
    }
    const sticker = config.sticker ?? {};
    // 未配置目录时用包内自带表情套组，装完即用
    const stickerDir = typeof sticker.dir === 'string' && sticker.dir.trim() !== '' ? sticker.dir.trim() : bundledStickerDir();
    const definition = {
        name: STICKER_TOOL_NAME,
        description: DESCRIPTION,
        parameters: {
            type: 'object',
            properties: {
                mood: { type: 'string', description: '表情标签，如 fine / mocking / pray / sleeping / thinking / tired / wonder，也接受中文（好/累/疑惑…）；省略则随机。' },
                target: { type: 'string', description: '可选 "c2c:openid" / "group:openid"，省略则用当前会话。' },
            },
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    sticker: { type: 'string' },
                    target: { type: 'string' },
                    available: { type: 'array', items: { type: 'string' } },
                },
                required: ['sticker', 'target', 'available'],
                additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: `已发送表情包 ${value.sticker}` }],
        },
        async execute(args, exec) {
            if (sticker.enabled === false)
                throw new Error('qqbot_sticker: 表情包功能已关闭');
            const files = listStickers(stickerDir);
            if (files.length === 0)
                throw new Error(`qqbot_sticker: 表情目录里没有可用图片（${sticker.dir ?? '未配置 dir'}）`);
            let resolved;
            const explicit = args.target;
            if (explicit !== undefined && explicit !== '') {
                resolved = parseTarget(explicit);
                if (resolved === undefined)
                    throw new Error(`qqbot_sticker: target 格式错误，需要 c2c:openid 或 group:openid，收到: ${explicit}`);
            }
            else if (exec.agent !== undefined) {
                resolved = manager.findByAgent(exec.agent)?.replyTarget;
            }
            if (resolved === undefined)
                throw new Error('qqbot_sticker: 无法确定发送目标，请显式传 target');
            const picked = pickSticker(files, args.mood);
            await mediaSender.sendImage({ scope: resolved.scope, targetId: resolved.targetId }, { localPath: picked });
            const available = files.map((f) => basename(f, extname(f)));
            logger.info(`im-qqbot: qqbot_sticker 已发送 ${basename(picked)} → ${resolved.scope}:${resolved.targetId}`);
            return { sticker: basename(picked), target: `${resolved.scope}:${resolved.targetId}`, available };
        },
    };
    tools.register(definition);
    logger.info(`im-qqbot: qqbot_sticker 工具已注册（dir=${sticker.dir ?? '未配置'}）`);
}