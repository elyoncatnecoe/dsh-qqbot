# dsh-qqbot-plus

在 QQ 私聊和群聊里对话 DeepSeek Harness 的机器人插件。基于官方插件 [`@tencent-connect/dsh-qqbot`](https://github.com/tencent-connect/dsh-qqbot) 的独立分支（MIT），**可与官方插件共存**（entry id 不同）。

**[English](README_EN.md) | 简体中文**

## 四个特点

1. **会说话**：内置 TTS 与变调（纯 JS，不用 ffmpeg、不用另装插件），`/voice loli` 一句话换音色。
2. **会主动找你**：私聊可以不定时主动推送（群聊做不到，平台关闭了群主动消息），`/remind 09:00 吃药` 即可安排。
3. **一条指令换人格卡**：`/persona female` / `/persona male`，音色、形象图、人格文案整套切换，按会话独立。
4. **记得聊过什么**：对话落盘成记忆，重启后接着聊，群/私聊各自一份。

> **装完不会用，或者想按自己的风格微调，直接回 DSH 里问助手**——它能读这个包的配置和文档，比翻 README 快。别自己硬猜参数。

## 比官方插件多了什么

| 能力 | 说明 |
|---|---|
| **语音 + 换音色** | 内置 TTS 与变调（纯 JS，无需 ffmpeg、无需额外插件）。`/voice loli` 一句话换声音，7 种预设 |
| **人格套装** | 一个套装 = 音色 + 形象图 + 人格 prompt，`/persona female` 整套切换 |
| **表情包** | 内置 7 张套组，`qqbot_sticker` 按情绪标签挑图；装完即用，不用配置路径 |
| **定时主动私聊** | 到点主动发你私聊，不需要你先说话。`/remind 09:00 吃药` 即可，也可让模型用 `qqbot_push` 推内容。群聊主动被平台关闭，见 [docs/PROACTIVE-DM.zh-CN.md](docs/PROACTIVE-DM.zh-CN.md) |
| **表情复读** | 有人带图 @ 时，按概率把那张图发回去（不是每次都复读，可调参） |
| **会话记忆** | 把对话落盘并在后续注入，跨重启保留 |
| **群聊分段首发** | 长回复先发一小段，缩短首字等待（群聊没有流式接口） |
| **窗口内主动补话** | 被 @ 后在 5 分钟被动窗口里随机补几句，看起来像在聊。**公开版默认关闭**，在配置里把 `proactive.enabled` 设为 `true` 才生效 |

## 安装

见 [docs/INSTALL.zh-CN.md](docs/INSTALL.zh-CN.md)（含注册机器人、扫码绑定全流程）。

最短路径：DSH 左侧「插件」→「添加插件」→ 输入本包名或本地目录 → 安装 → 设置页扫码绑定。

**不挑位置**：装到任意盘、任意目录都可以（Windows / macOS / Linux 通用），插件内部路径都相对包自身或用户主目录解析。

## 功能依赖（装之前先看）

插件免费，但两项功能依赖外部服务：

| 功能 | 依赖 | 缺了会怎样 |
|---|---|---|
| 文字聊天 | 无（用 DSH 已登录的模型） | — |
| **语音 / 换音色** | **DeepSeek 官方 API Key**（TTS 按字符计费） | 语音发不出，文字正常 |
| **识图** | 自己在 `vision.provider` / `vision.model` 填一个支持图片输入的模型 | 识图不可用 |
| 表情包 / 记忆 / 复读 | 无 | — |

语音 Key 的读取顺序：环境变量 `DEEPSEEK_API_KEY` → `~/.dsh/.credentials.yaml`。在 DSH 里用 DeepSeek 账号登录即可自动具备。

## 常用指令

| 指令 | 作用 |
|---|---|
| `/voice` | 列出音色，点按钮或 `/voice loli` 切换 |
| `/voice open` | 主人放开权限，让其他人也能换 |
| `/persona` | 列出人格套装，`/persona male` 一键换音色+形象+prompt |
| `/remind 09:00 吃药` | 定时主动私聊提醒；`/remind list` 查看、`/remind off` 暂停 |
| `/prompt` | 查看当前人格文案；`/prompt male` 切换、`/prompt show female` 只看不切 |
| `/bot-me` | 查看自己的 OpenID（填 `owner.openid` 用） |
| `/new` `/compact` `/model` `/preset` `/stop` `/bot-status` `/bot-help` | 与官方插件一致 |

音色/人格**按会话独立**：群里换成长少年不会影响私聊。

## 主要配置

见 `cordis.patch.yml`，或设置页。常改的几项：

```yaml
persona: { id: female, name: Deepseek }   # female=少女·萝莉音 / male=少年·暗潮音
voice:   { voiceId: stella, semitones: 2 } # 2=萝莉、0=原声、-3=中性
echo:    { probability: 0.5, cooldownMs: 600000 }
memory:  { enabled: true, injectLimit: 12, retentionDays: 30 }
proactive: { enabled: true, maxNudgesPerWindow: 3 }
```

## 已知限制（平台侧，不是插件问题）

- **群里只有被 @ 才会收到消息**，所以「复读整群」「全群记忆」都做不到。
- **群主动推送已关闭**（`40034105`），冷场破冰不可能；只能被动回复。
- 媒体（语音/图片/文件）基本只能在被动窗口内发：群 5 分钟、私聊 60 分钟。
- QQ 头像只能去 [q.qq.com](https://q.qq.com) 控制台换，没有 API。
- 无法撤回他人消息、踢人、禁言、改群资料、拉历史消息。

细节见 [docs/FEATURES.zh-CN.md](docs/FEATURES.zh-CN.md) 和 [docs/TROUBLESHOOTING.zh-CN.md](docs/TROUBLESHOOTING.zh-CN.md)。

## 目录

```
lib/               插件实现（fork + 新增特性）
assets/stickers/   内置表情包（自绘，MIT）
prompts/           人格 prompt 模板（{{name}} 占位）
docs/              安装、平台、特性、排错
```

## 开发与发布

**发布流程**（三步，别省）：

1. 改 `package.json` 的 `version`
2. `npm run release:check` —— BOM 检查 + 脱敏检查 + 语法检查
3. 提交并发 tag（如 `v0.1.1`）

**为什么要 BOM 检查**：Windows 上某些编辑器和 `Set-Content -Encoding UTF8` 会悄悄写 UTF-8 BOM。`package.json` 开头多三个字节，JSON 就解析失败，插件管理器把包判成 `missing`，所有插件行都不加载——现象是「插件装好了却完全不生效」，而且没有明显报错。这个坑真踩过。

**为什么要脱敏检查**：这个包是从线上实例 fork 的，容易把 appId / appSecret / openid / 本机路径带出去。检查会拦下这些模式。

**公开版默认值刻意保守**：`proactive`（群内随机补话）默认 **关**、音色默认 **中性**。想开就在 profile 配置里覆盖，别改包里的默认值——否则等于替所有使用者做决定。

## License

MIT。保留上游 `@tencent-connect/dsh-qqbot` 的版权声明，新增部分同样以 MIT 发布。
`assets/icons/` 下的图标沿用上游包内资源；`assets/stickers/` 的 7 张表情为作者自绘，见该目录下 `LICENSE.md`。