# 安装指南（小白向）

从零开始：装插件 → 注册机器人 → 扫码绑定 → 在 QQ 里说话。

> **装完不会用，或者想改风格/加功能，直接回 DSH 里问助手。** 它能读这个包的配置项和文档，比自己翻参数快，也不容易改坏。

---

## 零、先搞清楚哪些功能要额外准备

插件本身不收费，但**两个功能依赖外部服务**，装之前先确认：

| 功能 | 依赖 | 不准备会怎样 |
|---|---|---|
| 文字聊天 | DSH 里已登录的模型（无需额外配置） | — |
| **语音（`qqbot_speak`、`/voice`）** | **DeepSeek 官方 API Key** | 报「未找到 DEEPSEEK_API_KEY」，语音发不出（文字不受影响） |
| **识图（`qqbot_describe_image`）** | 一个**能看图的模型**，并在 `vision.provider` / `vision.model` 里填好 | 报 `no adapter registered` 或「模型看不了图」 |
| 表情包 | 无（包内自带 7 张） | — |
| 记忆 / 复读 / 主动补话 | 无 | — |

### 语音：需要 DeepSeek 官方 API Key（按量计费）

语音是把文字发给 DeepSeek 官方 TTS 接口（`https://api.deepseek.com/v1/tools/tts`）合成音频，**按字符计费**。所以必须有官方 Key，插件按下面顺序查找：

1. 环境变量 `DEEPSEEK_API_KEY`
2. `~/.dsh/.credentials.yaml` 里的 `DEEPSEEK_API_KEY`

**最简单的方法**：在 DSH 里用 DeepSeek 账号登录（设置 → 账号），凭据会写进上面那个文件，插件自动就能用。没有官方 Key 的人可以正常聊天，只是不能用语音。

### 识图：需要一个能看图的模型

插件通过 DSH 的模型调用能力识图，所以要自己指定一个**支持图片输入**的模型：

```yaml
vision:
  enabled: true
  provider: <你 DSH 里配置的 provider>
  model: <该 provider 下支持 image 的模型 id>
```

不同人的 provider 名字不一样（取决于自己接的网关），所以文档给不了通用值。判断标准：该模型在 DSH 模型列表里标注了支持图片输入。

---

## 一、装插件

### 方式 A：DSH 桌面版（推荐）

1. 打开 DeepSeek Harness，点左侧栏的 **插件**
2. 点 **添加插件**
3. 输入本仓库所在目录的绝对路径，或已发布到 npm 的包名
   - 路径随便放哪都行，**不要求特定盘符**：`<你的目录>/dsh-qqbot-plus`
   - Windows 形如 `C:\Users\<你>\dsh-qqbot-plus`；macOS/Linux 形如 `/Users/<你>/dsh-qqbot-plus`
4. 点 **安装并立即启动**
5. 装好后在插件列表里能看到 **QQ 机器人 Plus**

> 如果你已经装了官方 `@tencent-connect/dsh-qqbot`，两者可以共存，但**同一个机器人同时启用两个插件会互相抢事件**（同 appId 会开两条 WebSocket）。只留一个启用即可。

### 方式 B：命令行

```bash
npx @deepseek-ai/dsh plugin --profile <你的profile> add /path/to/dsh-qqbot-plus
npx @deepseek-ai/dsh --profile <你的profile>
```

---

## 二、注册 QQ 机器人

1. 打开 [q.qq.com](https://q.qq.com)，用手机 QQ 扫码登录
2. **创建机器人** → 选「公域」类型（私域对群消息限制更严）
3. 记下 **AppID** 和 **AppSecret**（开发设置 → 接入凭证）
4. 需要开启的项：
   - **开发设置 → 事件订阅**：勾上 **群聊 @ 消息**（`GROUP_AT_MESSAGE_CREATE`）和 **C2C 消息**（`C2C_MESSAGE_CREATE`）
     → 不勾的话机器人能连上但收不到任何消息，且**不会报错**
   - **沙箱配置 → 测试人员**：机器人上线前只有名单里的 QQ 号能触发它，把你的号加进去
   - **IP 白名单**：留空即可（留空 = 允许所有来源）
5. 想在群里干活：把机器人**拉进群**，并且**在群设置里把它设为管理员**（入群审批等功能需要）

---

## 三、绑定到插件

插件装了但没绑定时，会进入扫码流程：

1. DSH 设置页 → **QQ 机器人**（或插件详情页）
2. 用手机 QQ 扫码 → 确认授权
3. 凭据自动保存到 profile，下次启动不用再扫

手动填也可以：同一页面填 AppID + AppSecret 保存。

> 绑定时会把扫码用的那个 QQ 号自动加入私聊白名单。

---

## 四、第一次说话

1. 私聊机器人发一句「在吗」——应该会有回复
2. 发 `/bot-me`，它会回你的 **OpenID**；把这串填进配置 `owner.openid`（之后才能主动私聊你）
3. `22:30` 测试主动推送：发 `/remind 22:30 该睡了`，到点它会主动私聊你（不用你先说话）
4. 想让它发语音：说「用语音说一句」或让它调用 `qqbot_speak`
5. 想换音色：发 `/voice`，点列表里的按钮（或 `/voice loli`）
6. 想换人格：发 `/persona male`（少年·暗潮音），或者 `/persona female`（少女·萝莉音）
7. 想看 / 切换人格文案：发 `/prompt` 看当前这套，`/prompt male` 切换，`/prompt show female` 只看不切
8. 想对**所有会话**统一用某套文案：把 `prompts/global-female.txt`（或 `global-male.txt`）的正文粘进插件设置页「个性化提示词」的两个框
7. 群里：**必须 @ 它**才会响应（平台限制，不是配置问题）

> 主动推送的完整玩法（三种安排方式、限额、为什么群里做不到）见 [PROACTIVE-DM.zh-CN.md](PROACTIVE-DM.zh-CN.md)。

---

## 五、可选：调成你喜欢的样子

| 想改 | 改哪里 |
|---|---|
| 机器人名字 | `persona.name`（默认 `Deepseek`，会替换人格 prompt 里的 `{{name}}`） |
| 默认音色 | `voice.voiceId` + `voice.semitones` |
| 复读频率 | `echo.probability`（0 关、1 每次都复读） |
| 记忆条数/天数 | `memory.injectLimit`、`memory.retentionDays` |
| 群聊补话次数 | `proactive.maxNudgesPerWindow` |
| 自定义表情包 | 把图片放一个目录，`sticker.dir` 指过去（文件名=标签） |

---

## 六、卡住了？

先看 [TROUBLESHOOTING.zh-CN.md](TROUBLESHOOTING.zh-CN.md)，里面按错误码列了最常见的情况。

最常见的一条：**机器人连上了，但发消息完全没反应** → 99% 是事件订阅没勾，或者你的号不在沙箱测试人员里。