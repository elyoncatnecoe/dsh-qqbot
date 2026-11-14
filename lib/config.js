/**
 * dsh-im-qqbot 插件配置 Schema
 */
import Schema from '@deepseek-ai/schemastery';
/** 访问控制子 Schema（独立导出：config 路由的服务端校验复用） */
export const AccessControlSchema = Schema.object({
    c2cMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('C2C访问模式（默认开放）'),
    c2cAllow: Schema.array(Schema.string()).default([]).description('C2C白名单（QQ OpenID）'),
    groupMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('群聊访问模式（默认开放：群自带进群门槛 + @bot 触发）'),
    groupAllow: Schema.array(Schema.string()).default([]).description('群聊白名单（群 OpenID）'),
});
/** 群聊主动接话子 Schema（独立导出：config 路由的服务端校验复用） */
export const ProactiveSchema = Schema.object({
    enabled: Schema.boolean().default(true).description('群聊主动接话：每收到一条群消息（平台只在被 @ 时推送），在 5 分钟被动回复窗口内随机补几句'),
    minDelayMs: Schema.number().default(30000).description('第一次主动补话的最短延迟(ms)'),
    maxDelayMs: Schema.number().default(240000).description('最后一次主动补话的最晚延迟(ms)，会被窗口余量截断'),
    maxNudgesPerWindow: Schema.number().default(3).description('一个窗口内最多补几次（平台每条消息限 4-5 次回复，超出会被拒）'),
    onlyWhenSilent: Schema.boolean().default(false).description('仅当这轮没说话时才补第一句（后续几句不受限）'),
    prompts: Schema.array(Schema.string()).default([
        '（群聊提醒）你可以顺势再补一句：接个梗、追问一句、或说点自己的看法。不要重复刚才的话，要具体，不要留空。',
        '（群聊提醒）如果这个话题还有下文，补一句；觉得没什么可说就用一句轻松的话带过，别沉默。',
        '（群聊提醒）再补一句短的。可以是吐槽、补充、或者主动问一句。不要重复上一条。',
    ]).description('主动补话的提示文案池，随机轮换'),
    prompt: Schema.string().description('兼容旧配置的单条提示（prompts 为空时使用）'),
}).default({
    enabled: true,
    minDelayMs: 30000,
    maxDelayMs: 240000,
    maxNudgesPerWindow: 3,
    onlyWhenSilent: false,
}).description('群聊主动接话配置');
export const OwnerSchema = Schema.object({
    openid: Schema.string().default('').description('主人的私聊 openid，主动推送的默认目标'),
}).description('主人信息');
export const VoiceSchema = Schema.object({
    enabled: Schema.boolean().default(true).description('是否允许 qqbot_speak 发语音'),
    voiceId: Schema.string().default('stella').description('TTS 原始音色：stella(女) / tide(男)'),
    semitones: Schema.number().default(2).description('变调半音：2=萝莉（默认）、0=原声、−3=中性'),
    mirrorToOwner: Schema.boolean().default(true).description('在群里发语音时，同一条再给主人私聊补一份'),
    maxChars: Schema.number().default(300).description('单条语音最大字符数'),
}).description('语音合成配置');
export const StickerSchema = Schema.object({
    enabled: Schema.boolean().default(true).description('是否允许 qqbot_sticker 发表情包'),
    dir: Schema.string().default('').description('表情包图片目录（png/jpg/gif/webp），文件名即语义标签'),
}).description('表情包配置');
export const PersonaSchema = Schema.object({
    id: Schema.string().default('female').description('默认人格套装：female（少女·萝莉音） / male（少年·暗潮音）'),
    name: Schema.string().default('Deepseek').description('机器人名字，替换人格 prompt 里的 {{name}}'),
}).description('人格套装配置');
export const EchoSchema = Schema.object({
    enabled: Schema.boolean().default(true).description('带图 @ 时偶尔把那张图原样发回去（复读）'),
    probability: Schema.number().default(0.5).description('复读概率 0~1，越小越少复读'),
    cooldownMs: Schema.number().default(600000).description('同一会话两次复读的最小间隔(ms)'),
    maxBytes: Schema.number().default(2097152).description('超过这个大小的图不复读'),
}).description('表情包复读配置');
export const MemorySchema = Schema.object({
    enabled: Schema.boolean().default(true).description('落盘会话记忆并在后续对话里注入'),
    injectLimit: Schema.number().default(12).description('每次注入最近多少条记忆'),
    retentionDays: Schema.number().default(30).description('记忆保留天数，0=永久'),
}).description('会话记忆配置');

export const MediaSchema = Schema.object({
        enabled: Schema.boolean().default(true).description('是否启用富媒体理解（图片/视频下载 + 工具分析）'),
        maxMB: Schema.number().default(200).description('富媒体下载大小上限(MB)'),
        ttlHours: Schema.number().default(24).description('富媒体存活时长(小时)，0=永不过期'),
    }).default({
        enabled: true,
        maxMB: 200,
        ttlHours: 24,
    }).description('富媒体理解配置');
export const VisionSchema = Schema.object({
        enabled: Schema.boolean().default(false).description('是否启用视觉理解（qqbot_describe_image 工具）'),
        provider: Schema.string().default('').description('视觉模型 provider（dsh 注册的 llm adapter，如 pi-ai）'),
        model: Schema.string().default('').description('视觉模型 id（如 qwen-vl-max）'),
        defaultPrompt: Schema.string().default('Describe this image in detail.').description('默认描述 prompt'),
        maxBytes: Schema.number().default(10 * 1024 * 1024).description('图片字节上限'),
        maxTokens: Schema.number().default(1024).description('输出 token 上限'),
        timeoutMs: Schema.number().default(120000).description('视觉调用超时(ms)'),
    }).default({
        enabled: false,
        provider: '',
        model: '',
        defaultPrompt: 'Describe this image in detail.',
        maxBytes: 10 * 1024 * 1024,
        maxTokens: 1024,
        timeoutMs: 120000,
    }).description('视觉理解配置');
export const SendFileSchema = Schema.object({
        restrictPaths: Schema.boolean().default(true).description('是否启用路径白名单（默认 true，仅允许 media + cwd + extraRoots）'),
        extraRoots: Schema.array(Schema.string()).default([]).description('额外允许访问的根目录'),
        sendPresentedFiles: Schema.boolean().default(true).description('是否将 present 声明的交付文件发送到当前会话'),
        maxFiles: Schema.number().default(4).description('单轮最多投递的交付文件数'),
    }).default({
        restrictPaths: true,
        extraRoots: [],
        sendPresentedFiles: true,
        maxFiles: 4,
    }).description('附件发送配置');
export const ConfigSchema = Schema.object({
    appId: Schema.string().default('').description('QQ 机器人 AppID'),
    appSecret: Schema.string().default('').description('QQ 机器人 AppSecret'),
    provider: Schema.string().description('LLM provider name'),
    model: Schema.string().description('Model name'),
    preset: Schema.string().description('Agent preset id'),
    cwd: Schema.string().description('Agent working directory (default ~/.dsh-qqbot/workspace)'),
    requireMention: Schema.boolean().default(true).description('群聊是否需要@bot触发'),
    groupPrompt: Schema.string().description('群聊额外system prompt'),
    directPrompt: Schema.string().description('私聊额外system prompt'),
    textChunkLimit: Schema.number().default(4500).description('单条消息最大字符数'),
    streaming: Schema.boolean().default(true).description('是否启用流式输出（群聊始终不启用）'),
    sessionIdleTimeout: Schema.number().default(30 * 60 * 1000).description('会话闲置超时(ms)'),
    maxQueue: Schema.number().default(20).description('并发队列最大长度'),
    processingTimeoutMs: Schema.number().default(30 * 60 * 1000).description('处理超时(ms)，超时中断当前 LLM 调用'),
    askTimeoutMs: Schema.number().default(5 * 60 * 1000).description('待答问题超时(ms)，超时自动拒绝并提示'),
    historyLimit: Schema.number().default(10).description('群历史缓冲条数'),
    access: AccessControlSchema.default({
        c2cMode: 'open',
        c2cAllow: [],
        groupMode: 'open',
        groupAllow: [],
    }).description('访问控制'),
    showToolResults: Schema.boolean().default(false).description('是否展示工具调用成功结果（错误始终展示）'),
    debug: Schema.boolean().default(false),
    media: MediaSchema,
    vision: VisionSchema,
    sendFile: SendFileSchema,
    groupStream: Schema.object({
        enabled: Schema.boolean().default(true).description('群聊分段首发：回复生成中先发一小段，降低首字等待（群聊没有真流式端点）'),
        firstChars: Schema.number().default(60).description('首段至少累积多少字符才发'),
        maxSegments: Schema.number().default(3).description('最多切几段（含末段），受平台「每条消息最多回复 5 次」约束，建议 2-3'),
        minIntervalMs: Schema.number().default(800).description('两段之间的最小间隔(ms)，避免瞬间连发'),
    }).default({
        enabled: true,
        firstChars: 60,
        maxSegments: 3,
        minIntervalMs: 800,
    }).description('群聊分段首发配置'),
    proactive: ProactiveSchema,
    owner: OwnerSchema.default({ openid: '' }),
    voice: VoiceSchema,
    sticker: StickerSchema,
    persona: PersonaSchema,
    echo: EchoSchema,
    memory: MemorySchema,
});
//# sourceMappingURL=config.js.map
