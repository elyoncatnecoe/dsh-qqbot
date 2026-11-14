import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { SessionManager } from "../session/index.js";
import { handleInbound, createOutboundHandler } from "../transport/index.js";
import { parseStreamFrame } from "../transport/events.js";
import { ReplyLimiter } from "../transport/reply-limiter.js";
import { cacheMsgId, cacheEventId } from "../transport/msgid-cache.js";
import { resolveReplyTarget, sendResolvedMarkdown } from "../transport/reply-target.js";
import { QuestionChannel } from "../features/question-channel.js";
import { ApprovalChannel } from "../features/approval-channel.js";
import { decodeButtonData } from "../features/button-utils.js";
import { buildUserAgent } from "../shared/index.js";
import { setupMiddlewares } from "./middleware-setup.js";
import { startMediaCleanup } from "../media/media-cleaner.js";
import { ensureVisionInputModal, registerDescribeImageTool } from "../media/vision-tool.js";
import { registerSendFileTool } from "../media/send-file-tool.js";
import { DeliverablesDeliverer } from "../transport/deliverables.js";
import { ProactiveChat } from "../features/proactive.js";
import { registerSpeakTool } from "../media/voice-tool.js";
import { registerPushTool } from "../media/push-tool.js";
import { registerStickerTool } from "../media/sticker-tool.js";
import { EchoPolicy, pickEchoImage } from "../features/echo.js";
import { getMemory } from "../features/memory.js";
import { ReminderScheduler, getReminderStore } from "../features/reminders.js";
/**
 * interaction 统一分发器：按 button_data 的顶层 `t` 判别字段，路由到对应
 * channel（question / approval）。QQ 只有一个 interaction 入口，集中路由
 * 避免多通道各自 try 导致误判。
 */
function dispatchInteraction(event, manager) {
    const raw = event.data?.resolved?.button_data;
    if (!raw)
        return false;
    const button = decodeButtonData(raw);
    if (!button)
        return false;
    if (button.t === 'question')
        return manager.questionChannel?.handleInteraction(event) ?? false;
    if (button.t === 'approval')
        return manager.approvalChannel?.handleInteraction(event) ?? false;
    return false;
}
export async function bootstrapGateway(ctx, agents, config, logger) {
    const manager = new SessionManager(ctx, agents, config, logger);
    // ── 群聊主动接话（窗口内破冰，不依赖平台主动推送权限）──
    const proactive = new ProactiveChat({ manager, config: config.proactive, logger });
    // 表情包复读策略（带图 @ 时按概率回发同一张）
    const echoPolicy = new EchoPolicy(config.echo, Math.random);
    // 定时主动私聊：插件内自带调度，不依赖宿主定时任务能力
    const reminderScheduler = new ReminderScheduler({
        store: getReminderStore(),
        bot: undefined,
        config,
        logger,
    });
    // 诊断计数：确认网关是否 READY、有没有收到事件（只读，不参与业务）
    const diag = { startedAt: Date.now(), ready: false, readyAt: 0, rawEvents: 0, lastRawType: '', lastRawAt: 0, messages: 0, lastMessageAt: 0, errors: [], disconnects: [] };
    // 只读状态接口：观察主动接话是否真的触发（不参与发送逻辑）
    ctx.inject(['webServer'], (scoped) => {
        scoped.webServer.register({
            kind: 'exact',
            path: '/qqbot/im-qqbot/proactive',
            handler: (req, res) => {
                if (req.method !== 'GET' && req.method !== 'HEAD') {
                    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
                    res.end('{"error":"method not allowed"}');
                    return;
                }
                const body = JSON.stringify({ proactive: proactive.snapshot(), diag });
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(body);
            },
        });
    });
    // ── 初始化 QQ Bot SDK ──
    const userAgent = buildUserAgent();
    const bot = new QQBot({
        appId: config.appId,
        appSecret: config.appSecret,
        transport: 'websocket',
        baseUrl: process.env.QQBOT_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com',
        tokenBaseUrl: process.env.QQBOT_TOKEN_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com',
        userAgent,
        logger,
    });
    logger.info(`QQBot SDK initialized (UA: ${userAgent})`);
    reminderScheduler.bot = bot;
    // ── 中间件链 ──
    setupMiddlewares(bot, config, manager, logger);
    // ── 入站：经过中间件链后的消息交给 dsh agent ──
    bot.on('message', async (mCtx) => {
        const msg = mCtx.message;
        diag.messages += 1;
        diag.lastMessageAt = Date.now();
        // 记录最近 msgId，供无上下文的出站发送（文件发送显式 target、主动推送等）获取被动回复目标
        cacheMsgId(mCtx.replyTarget.scope, mCtx.replyTarget.targetId, mCtx.replyTarget.msgId);
        // 主动接话需要的入站上下文：群聊 scope/peer 与到达时间
        const scope = msg.kind === 'group' ? 'group' : 'c2c';
        const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId) : msg.senderId;
        const inboundAt = Date.now();
        if (config.debug) {
            logger.debug(`← message (post-middleware): ${JSON.stringify(msg, null, 2).slice(0, 500)}`);
        }
        await handleInbound(mCtx, manager, config, logger);
        // 记忆：记下对方这句（群里只有 @ 得到，口径见文档）
        try {
            getMemory(config.memory).append(scope, peerId, 'user', msg.content ?? '');
        }
        catch { /* 记忆失败不影响对话 */ }
        // 复读：带图 @ 时按概率把那张图发回去（不是每次都复读）
        try {
            const image = pickEchoImage(msg.attachments, mCtx.state?.downloadedFiles);
            const decision = echoPolicy.decide(scope, peerId, image);
            if (decision.echo && image !== undefined) {
                const source = image.localPath !== undefined ? { localPath: image.localPath } : { url: image.url };
                void (async () => {
                    try {
                        await mediaSender.sendImage({ scope, targetId: peerId }, source);
                        echoPolicy.markEchoed(scope, peerId);
                        logger.info(`im-qqbot: echo sticker sent key=${scope}:${peerId}`);
                    }
                    catch (err) {
                        logger.warn(`im-qqbot: echo sticker failed key=${scope}:${peerId}: ${err instanceof Error ? err.message : String(err)}`);
                    }
                })();
            }
            else if (decision.reason !== 'no-image') {
                logger.debug?.(`im-qqbot: echo skipped (${decision.reason}) key=${scope}:${peerId}`);
            }
        }
        catch (err) {
            logger.warn(`im-qqbot: echo decision failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        // 本轮收敛后再考虑主动接话
        proactive.onInboundSettled(scope, peerId, inboundAt);
    });
    // ── 出站：dsh session/event → QQ 消息 ──
    // 获取 tools 服务（工具结果结构化展示），可选
    let toolsRegistry;
    try {
        toolsRegistry = ctx.get('tools');
    }
    catch {
        toolsRegistry = undefined;
    }
    // 发送适配器：将 QQBot 实例适配为 QQBotSender（openStream 参数形态不同）。
    // sendMarkdown 统一做被动回复限额管控：同一 msgId 超限/过期时降级主动推送。
    const replyLimiter = new ReplyLimiter({ limit: 4 });
    proactive.setLimiter(replyLimiter);
    const sender = {
        sendMarkdown: (target, content, opts) => sendResolvedMarkdown(bot, resolveReplyTarget(target, replyLimiter, true), content, opts)
            .finally(() => { proactive.noteSpeak(target.scope, target.targetId); }),
        openStream: (target) => bot.openStream({
            target: {
                scope: target.scope,
                targetId: target.targetId,
                msgId: target.msgId,
            },
        }),
    };
    // ── 附件发送适配器（qqbot_send_file 工具与交付物投递共用） ──
    // 包装 bot：让文件发送也走 msgId 兜底 + 被动回复限额管控。
    // 注意：SDK 文件发送暂不支持 event_id，故 allowEvent=false，跳过 event 候选。
    const mediaSender = {
        sendImage: (target, source) => bot.sendImage(resolveReplyTarget(target, replyLimiter, false), source),
        sendVideo: (target, source) => bot.sendVideo(resolveReplyTarget(target, replyLimiter, false), source),
        sendVoice: (target, source) => bot.sendVoice(resolveReplyTarget(target, replyLimiter, false), source),
        sendFile: (target, source, opts) => bot.sendFile(resolveReplyTarget(target, replyLimiter, false), source, opts),
    };
    // 交付物投递：present 声明的文件在轮末发送到当前会话（outbound 路由触发）
    const deliverablesDeliverer = new DeliverablesDeliverer(sender, mediaSender, config, logger);
    const outbound = createOutboundHandler(manager, sender, config, logger, toolsRegistry, deliverablesDeliverer);
    ctx
        .on('session/event', outbound.routeSessionEvent);
    // ── 出站流式：agent/assistant-stream → 流式帧路由 ──
    // 实时流式走瞬态 agent/assistant-stream（chunk 不进 session log）。
    // 该事件按 agent 作用域派发，根作用域监听器不带 global 会被过滤（同
    // approval/request），帧到达后自行按 agent.id 路由，非 QQ 会话在 router 内忽略。
    ctx
        .on('agent/assistant-stream', (payload) => {
        const parsed = parseStreamFrame(payload);
        if (parsed !== undefined)
            outbound.routeStreamFrame(parsed.agentId, parsed.delta);
    }, { global: true });
    // ── 问答通道（ask_user_question → QQ 文本 + 按钮） ──
    const questionChannel = new QuestionChannel(manager, sender, config, logger);
    manager.questionChannel = questionChannel;
    questionChannel.install(ctx);
    // ── 审批通道（approval/request → QQ 两按钮审批） ──
    const approvalChannel = new ApprovalChannel(manager, sender, config, logger);
    manager.approvalChannel = approvalChannel;
    approvalChannel.install(ctx);
    // ── 按钮点击回调（interaction）：统一分发到问答/审批通道 ──
    bot.on('interaction', async (_iCtx, event) => {
        // scope/targetId 推导对齐消息事件（inbound.ts）：按 scene 判定类型，群用 group_openid，私聊用 user_openid
        const scope = event.scene === 'group' ? 'group' : 'c2c';
        const targetId = scope === 'group' ? (event.group_openid ?? event.user_openid) : event.user_openid;
        // 记录互动事件 id，作为后续被动回复候选（event_id）
        cacheEventId(scope, targetId, event.id);
        const matched = dispatchInteraction(event, manager);
        await bot.acknowledgeInteraction(event.id, matched ? 0 : 3).catch(() => { });
    });
    bot.on('error', (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        diag.errors.push({ at: Date.now(), message: msg });
        if (diag.errors.length > 20)
            diag.errors.shift();
        logger.error(`bot error: ${msg}`);
    });
    // 掉线可观测：willReconnect=false 表示不会再重连（随后 bot.start() 的 Promise 会失败）。
    // disconnected 事件为 SDK 1.0.5+ 新增：旧版 handlers 表缺该键，bot.on 会抛
    // TypeError（profiles 增量安装可能残留旧版 SDK）——降级为跳过监听而非崩溃
    try {
        bot.on('disconnected', (event) => {
            const detail = `code=${event.code}${event.reason ? ` reason=${event.reason}` : ''}`;
            diag.disconnects.push({ at: Date.now(), ...event });
            if (diag.disconnects.length > 20)
                diag.disconnects.shift();
            if (event.willReconnect) {
                logger.warn(`Bot disconnected (${detail}), reconnecting...`);
            }
            else {
                logger.error(`Bot disconnected permanently (${detail}), giving up`);
            }
        });
    }
    catch (err) {
        logger.warn(`qqbot-nodejs SDK 不支持 disconnected 事件（请升级 @tencent-connect/qqbot-nodejs 至 1.0.5+）: ${err instanceof Error ? err.message : String(err)}`);
    }
    bot.on('ready', () => {
        diag.ready = true;
        diag.readyAt = Date.now();
        console.log(`[im-qqbot] Bot ready! appId=${config.appId}`);
    });
    // 原始事件计数：判断网关是否真的在推送（不解析内容）
    try {
        bot.on('rawEvent', (payload) => {
            diag.rawEvents += 1;
            diag.lastRawType = typeof payload?.t === 'string' ? payload.t : '';
            diag.lastRawAt = Date.now();
        });
    }
    catch (err) {
        logger.warn(`qqbot-nodejs SDK 不支持 rawEvent: ${err instanceof Error ? err.message : String(err)}`);
    }
    // ── 富媒体过期清理 ──
    if (config.media.enabled) {
        startMediaCleanup(ctx, config.media.ttlHours, logger);
    }
    // ── 视觉工具注册（qqbot_describe_image，复用 dsh llm + attachments） ──
    ensureVisionInputModal(config.vision, logger);
    registerDescribeImageTool(ctx, config.vision, logger);
    // ── 附件发送工具注册（qqbot_send_file，发送器见上方 mediaSender） ──
    registerSendFileTool(ctx, mediaSender, manager, config, logger);
    // ── 语音发送 / 主动私聊推送 ──
    registerSpeakTool(ctx, mediaSender, manager, config, logger);
    registerPushTool(ctx, bot, config, logger);
    registerStickerTool(ctx, mediaSender, manager, config, logger);
    // ── 生命周期 ──
    ctx
        .effect(() => {
        logger.info(`Starting bot (appId=${config.appId})`);
        reminderScheduler.start();
        bot.start().catch((err) => {
            logger.error(`Bot start failed: ${err instanceof Error ? err.message : String(err)}`);
        });
        return async () => {
            logger.info('Shutting down');
            reminderScheduler.dispose();
            proactive.dispose();
            // 顺序与容错：先收会话，再停网关；任何一步抛错都不能跳过 bot.stop，
            // 否则残留的网关会话会让平台把事件继续投递到这条「已死」的连接上，
            // 新实例虽然连上了却收不到任何事件。
            try {
                await manager.disposeAll();
            }
            catch (err) {
                logger.warn(`manager.disposeAll failed: ${err instanceof Error ? err.message : String(err)}`);
            }
            try {
                await bot.stop();
            }
            catch (err) {
                logger.warn(`bot.stop failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        };
    }, 'im-qqbot.lifecycle');
}
//# sourceMappingURL=bootstrap.js.map