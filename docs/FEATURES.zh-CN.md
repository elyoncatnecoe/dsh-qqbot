# 特性说明：与官方插件的差异

本包 fork 自 `@tencent-connect/dsh-qqbot@0.5.5`，保留其全部原有能力（扫码绑定、私聊/群聊被动回复、Markdown、白名单、`/new` `/compact` `/model` `/preset` `/stop` 等指令、文件发送、问答与审批按钮），并新增下面这些。

## 新增能力

### 1. 语音 + 换音色（重点）

> **前置条件**：需要 **DeepSeek 官方 API Key**（TTS 走官方接口，按字符计费）。插件读取顺序：环境变量 `DEEPSEEK_API_KEY` → `~/.dsh/.credentials.yaml`（在 DSH 里登录 DeepSeek 账号就会写入）。没有 Key 时语音功能报错，文字聊天不受影响。

- 自带 TTS 调用与 **WSOLA 变调**，纯 JavaScript 实现：**不需要 ffmpeg、不需要装别的插件**
- 7 种预设：`stella`（女声原声）、`shota`（正太）、`loli`（萝莉，默认）、`neutral`（中性）、`tide`（男声原声）、`boy`（少年）、`uncle`（大叔）
- 切换方式：聊天里发 `/voice`，点按钮或 `/voice loli`
- **按会话独立**：群里切成少年不影响私聊
- 权限：默认只有主人（配置里的 `owner.openid`）能切；主人可用 `/voice open` 放开给其他人，`/voice close` 收回
- 工具：`qqbot_speak(text, preset?, target?)`，模型可在对话里按你的口头要求即时切换

> 变调原理：平台 TTS 只给 stella/tide 两个真实音色，其余是「时间伸缩 + 重采样」算出来的音高变化，节奏不变。极端参数会失真，建议 ±6 半音内。

### 2. 人格套装

一个套装同时决定 **音色 + 形象图 + 人格 prompt**：

| 套装 | 音色 | 形象图 | prompt |
|---|---|---|---|
| `female`（默认） | 萝莉 | `assets/stickers/fine.png` | `prompts/persona-female.md` |
| `male` | 暗潮（男声原声） | `assets/stickers/thinking.png` | `prompts/persona-male.md` |

- 切换：`/persona female` / `/persona male`
- 查看或切换文案：`/prompt`（当前这套）、`/prompt show male`（只看不切）、`/prompt male`（切过去）
- 文案在 `prompts/persona-*.md`（带 `{{name}}` 占位）；另附 `prompts/global-*.txt` 是**无占位、名字已填 Deepseek** 的版本，供想「全局覆盖」的人粘进设置页「个性化提示词」——粘了之后按会话切换会被全局设置覆盖
- prompt 里用 `{{name}}` 占位，默认替换成 `Deepseek`，可在 `persona.name` 改
- 同样按会话独立、同样受主人权限控制

> **注意**：QQ 里显示的头像由平台控制，没有换头像的 API。这里的「形象」是插件内部的形象绑定（设置页展示、以及可作为图片发出），真要换 QQ 头像得去控制台手动传。

### 3. 表情包

- 内置 7 张（`assets/stickers/`），装完即用
- 工具 `qqbot_sticker(mood?)`：按标签挑图，如 `thinking` / `tired`，也认中文（累、疑惑、嘲讽…）；不传随机
- 想用自己的图：`sticker.dir` 指向任意目录，文件名即标签
- 绘制的图随包以 MIT 分发，见 `assets/stickers/LICENSE.md`

### 4. 表情复读

有人**带图 @** 机器人时，把那张图原样发回去——但**不是每次都复读**：

- 概率命中（默认 50%）
- 同一会话冷却（默认 10 分钟）
- 图不能太大（默认 2MB 以内）

三个条件都满足才复读。参数：`echo.probability` / `echo.cooldownMs` / `echo.maxBytes`。

> 群里只收得到 @ 自己的消息，所以复读对象只能是「发给它的那张图」，无法复读别人之间的互发。

### 5. 会话记忆

- 把它实际参与的对话落盘到 `~/.dsh-qqbot-plus/memory/`（每会话一个 JSONL）
- 每次对话注入最近 N 条（默认 12），每条截断到 200 字，避免撑爆上下文
- 保留天数可配（默认 30 天，0 = 永久）
- **口径**：群里它只能看到 @ 自己的消息，所以群记忆天然稀疏，不是「全群记忆」

### 6. 群聊分段首发

群聊没有流式接口（`stream_messages` 只对单聊开放），所以长回复原本要等整轮生成完才发。这里改成：生成中先发一小段，剩余轮末补发，减少首字等待。

配置：`groupStream.firstChars`（默认 60 字触发）、`maxSegments`（默认 3 段）。

### 7. 窗口内主动补话

被 @ 之后，平台给 5 分钟/4-5 次的被动回复额度。这里在额度内随机补 1~3 句，让它像在继续聊。

配置：`proactive.minDelayMs` / `maxDelayMs` / `maxNudgesPerWindow`。窗口一关自动停，不做越界尝试。**公开版默认 `enabled: false`**——装完不会在别人群里自己说话，想开再开。

### 8. 定时主动私聊

群主动推送被平台关闭，但**私聊主动可用**。本包内置了一个提醒调度器（每 30 秒检查一次，重启后保留）：

- `/remind 09:00 吃药` —— 每天固定时间主动私聊你
- `/remind weekday 09:00 上班` —— 仅工作日
- `/remind list` / `del` / `off` / `on`
- 内容固定时用它；需要「现算一份内容再发」时，让模型调用 `qqbot_push`

细节、限额与排错见 [PROACTIVE-DM.zh-CN.md](PROACTIVE-DM.zh-CN.md)。

## 识图依赖（原有功能，但需要自己配）

`qqbot_describe_image` 是上游就有的能力，本包未改动其实现，但**必须自己指定一个能看图的模型**才可用：

```yaml
vision:
  enabled: true
  provider: <你 DSH 里的 provider 名>
  model: <该 provider 下支持 image 输入的模型 id>
```

- provider 名字因人而异（取决于自建/第三方网关），文档无法给通用值
- 选错会报 `no adapter registered for provider "..."` 或「模型看不了图」
- 判断标准：模型在 DSH 模型列表里标注了支持图片输入

## 平台限制（改代码也做不到）

| 想做的事 | 结果 |
|---|---|
| 群主动推送（没人 @ 也发言） | `40034105 主动消息失败, 无权限`（平台 2025-04-21 起关闭） |
| 互动召回消息 `is_wakeup` | `40034123 不支持召回消息` |
| 群成员列表 | `11253 应用无接口访问权限` |
| 入群申请列表/审批 | 需先把机器人设为群管理员 |
| 读群历史消息 / @全体 / 踢人 / 禁言 / 改群资料 | 无接口 |
| 群聊流式 | 只支持单聊 |
| 改 QQ 头像 | 只能控制台手动 |

**可用但有限**：单聊主动推送 ✅、撤回自己消息 ✅、群基本信息 ✅。

## 跨平台与路径

插件不假设安装位置或盘符，Windows / macOS / Linux 通用：

- 内置表情包：相对包自身目录解析（`import.meta.url`），装到哪都在
- 记忆、偏好、媒体缓存：写在用户主目录下的 `.dsh-qqbot-plus/`，每个用户各自独立
- 需要用户自填的只有两处：`sticker.dir`（想换表情包时）和 `sendFile.extraRoots`（想发包外文件时）

## 实现说明（给研究代码的人）

- 改动都在 `lib/`；上游代码结构未大改，便于后续跟官方版本对比合并
- 新增模块：`lib/features/{prefs,personas,echo,memory}.js`、`lib/shared/voice-presets.js`、`lib/media/{voice,voice-tool,sticker-tool,push-tool}.js`、`lib/commands/{voice,persona}.js`
- 注入消息的 `source` 必须用内置 `{kind:'user'}`；自定义 kind 会在落盘时报 `format v4 message requires a producer-owned source kind`
- 插件卸载时 `await bot.stop()`：不 await 会留下死会话，新实例连上了却收不到事件