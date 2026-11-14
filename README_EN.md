# dsh-qqbot-plus

A QQ bot plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh), forked from the official [`@tencent-connect/dsh-qqbot`](https://github.com/tencent-connect/dsh-qqbot) (MIT). It runs under its own entry id, so it **can coexist** with the official plugin.

## Four highlights

1. **It can talk** — built-in TTS plus WSOLA pitch shifting, pure JavaScript. No extra plugin, no ffmpeg. Seven voices (`stella` / `loli` / `shota` / `neutral` / `tide` / `boy` / `uncle`); `/voice loli` switches instantly, `/voice` shows clickable buttons. Voice choice is **per conversation**; the default is `loli`.
2. **It can message you first** — proactive **private** messages are allowed by the platform, so `/remind 09:00 take your pills` will DM you on time. Group proactive messages are **impossible** (platform closed them in 2025, error `40034105`); the docs explain why and what to use instead.
3. **One command swaps a persona card** — `/persona female` or `/persona male` switches **voice + avatar image + persona prompt** together. `/prompt` shows the current text; `/prompt show male` previews without switching.
4. **It remembers the conversation** — messages are persisted per session under `~/.dsh-qqbot-plus/memory/` and the last 12 are injected back into the prompt, so context survives restarts. Groups and DMs keep separate memories.

> **Not sure how to configure it, or want it tuned to your style? Ask your DSH assistant.** It can read this package's config and docs, which beats guessing at parameters.

## Extras

- **7 bundled stickers** (`assets/stickers/`, self-drawn, MIT) sent by emotional tag via `qqbot_sticker`; bring your own directory with `sticker.dir`.
- **Sticker echo**: when someone mentions the bot with an image, it may send that same image back — probability-based with a per-conversation cooldown, not every time.
- **Group reply segmentation**: sends the first chunk early so readers are not left waiting for a full turn (QQ has no group streaming endpoint).
- **Window-aware nudges**: after being mentioned, it may add one or two short follow-ups inside the 5-minute passive window.
- **Unknown-command hint**: a mistyped `/comand` gets a helpful reply instead of being handed to the model.

## Install

See [docs/INSTALL.zh-CN.md](docs/INSTALL.zh-CN.md) (Chinese, beginner-oriented: install → register bot → QR bind → first message).

Short version: DSH sidebar → **Plugins** → **Add plugin** → point at this package or its npm name → install → scan the QR from the plugin settings.

The package does not care where it is installed (any drive, any OS); all paths resolve relative to the package itself or the user's home directory.

## Commands

| Command | What it does |
|---|---|
| `/voice` | List voices and switch (buttons or `/voice loli`) |
| `/voice open` | Owner grants other users permission to switch |
| `/persona` | List persona cards, `/persona male` switches |
| `/prompt` | Show current persona text; `/prompt male` switches; `/prompt show female` previews |
| `/remind 09:00 …` | Scheduled proactive DM; `/remind list` / `off` / `on` |
| `/bot-me` | Show your OpenID (needed for `owner.openid`) |
| `/new` `/compact` `/model` `/preset` `/stop` `/bot-status` `/bot-help` | Same as the official plugin |

Voice and persona are **per conversation**: switching in a group does not affect DMs.

## Configuration

See `cordis.patch.yml` or the settings page.

```yaml
persona: { id: female, name: Deepseek }    # female = loli voice / male = tide voice
voice:   { voiceId: stella, semitones: 2 } # 2 = loli, 0 = natural, -3 = neutral
echo:    { probability: 0.5, cooldownMs: 600000 }
memory:  { enabled: true, injectLimit: 12, retentionDays: 30 }
proactive: { enabled: true, maxNudgesPerWindow: 3 }
owner:   { openid: "" }                     # required for proactive DMs and owner-only commands
```

## Dependencies

The plugin itself is free, but two features call external services:

| Feature | Needs | Without it |
|---|---|---|
| **Voice / voice switching** | **DeepSeek official API key** (TTS is billed per character; read from `DEEPSEEK_API_KEY` or `~/.dsh/.credentials.yaml`) | Voice fails, plain text still works |
| **Image understanding** | A vision-capable model configured in `vision.provider` / `vision.model` | Image understanding unavailable |
| Stickers / memory / reminders | nothing | — |

## Platform limits (not fixable by code)

- Group chats only deliver events **when the bot is mentioned**; it cannot see other messages.
- Group proactive messages are disabled by the platform (`40034105`); recall messages unsupported (`40034123`).
- Media (voice/image/file) generally only sends inside the passive window: 5 minutes for groups, 60 minutes for DMs.
- No group member list (`11253`), no history fetch, no kick/mute/rename, no QQ avatar API.
- Join-request approval requires the bot to be a group admin (`11703`).

Details: [docs/FEATURES.zh-CN.md](docs/FEATURES.zh-CN.md) and [docs/TROUBLESHOOTING.zh-CN.md](docs/TROUBLESHOOTING.zh-CN.md) (Chinese).

## License

MIT, retaining the upstream copyright notice. Stickers under `assets/stickers/` are original artwork released under the same license (see that directory's `LICENSE.md`); icons under `assets/icons/` come from the upstream package.