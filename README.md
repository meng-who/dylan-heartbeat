# Dylan Heartbeat — AI Residency Runtime for Kelivo

**一个给 Kelivo AI伴侣使用的常驻插件。**  
它会自动唤醒 Kelivo 的AI伴侣，并让伴侣自己判断是否要主动联系你。

> 使用方式是先 [Fork 本项目](https://github.com/callie0313/dylan-heartbeat/fork)，再 clone 你自己的 fork 进行配置和部署。
>
> Dylan Heartbeat 会写入 `.env`、时间线、预设和个性化提示词；Fork 后使用能保留你的个人改动，也方便后续同步上游更新。直接 clone 原仓库也许能跑，但后续改配置、同步更新和部署都会更麻烦。
>
> 如果你已经 Fork 或部署过旧版本，新功能不会自动进入你的部署目录。请重新 Fork，或在自己的 fork 中同步上游更新后再重新部署。

---

## ✨ 核心目标：AI Residency（AI 常驻）

- 🧠 **持续上下文** – 即使对话中断，AI 仍能记住发生过的事
- ⏰ **主动唤醒** – 无人说话时，AI 会自动醒来，思考、关心你
- 📳 **手机推送** – 支持 Bark / ntfy，主动发消息到你的手机，像真实存在的人
- 🕰️ **长期时间感** – 知道自己多久没见你，什么时候主动联系过你
- 🧩 **行为连续性** – 发过的推送、沉默的夜晚，都会被 AI 记住
- 🎭 **人格不变** – 完全保留 Kelivo 的角色设定，不做任何破坏

**AI 不再只是“收到消息 → 回复”，而是“即使你不说话，它也在想你”。**

---

## 📚 目录

- [系统架构](#-系统架构)
- [文件说明](#-文件说明)
- [已 Fork / 部署过的人怎么更新？](#-已-fork--部署过的人怎么更新)
- [更新日志](#-更新日志2026-07-17)
- [开始教程](#-开始教程)
- [管理页面](#-管理页面web-控制台)
- [自动唤醒策略](#-自动唤醒策略)
- [天气注入](#-天气注入)
- [推送渠道](#-推送渠道)
- [自动日记](#-自动日记)
- [私密推送档案](#-私密推送档案)
- [跨平台与云部署](#-跨平台与云部署)

---

## 🧱 系统架构

```
Kelivo (客户端)
    ↓ 完整请求（SP、世界书、记忆、工具调用、最新消息）
Gateway (server.js)  ← 核心转发 + 时间线维护 + 主动行为注入
    ↓ 原封不动转发 + 已注入的主动行为上下文
LLM API
    ↑
wake_up.js  ← 定时自动唤醒，通过 Gateway 接口注入事件
    ↓
Bark / ntfy 推送 → 你的手机
```

- **Gateway 不修改 Kelivo 的任何人格设定**，只负责在正确的时间位置注入 AI 自己的主动行为（推送/静默）。
- **时间线（`enhanced_messages.json`）** 是 AI 的“世界状态”，只记录真实对话 + 自主行为，不包含系统规则。
- **时间戳记忆库（`message_timestamps.json`）** 让历史消息即使丢失时间前缀也能找回原始时间，实现推送精确散落。

---

## 📦 文件说明

| 文件 | 作用 |
|------|------|
| `server.js` | 主 Gateway。转发请求、维护时间线、注入推送事件、提供管理页面。 |
| `wake_up.js` | 自动唤醒 Runtime。按间隔唤醒 AI，生成推送或静默，发送到手机，写入时间线。 |
| `enhanced_messages.json` | **AI 世界时间线**。SP + 真实对话 + 推送事件。不是日志，是 AI 的当前世界。 |
| `message_timestamps.json` | **时间戳记忆库**。通过内容指纹记录每条消息的原始时间，找回历史消息时间。 |
| `diary/` | **自动日记目录**。当 AI 主动输出 `[DIARY]...[/DIARY]` 时，会按日期追加保存。 |
| `wake_archive.enc.jsonl` | **加密推送档案**。记录每次唤醒候选内容及发送、拦截或失败结果。 |
| `.env` | 环境变量。API Key、推送渠道、模型名称等（不提交到 Git）。 |
| `.env.example` | 环境变量模板，供新用户参考配置。 |

---

## 🔄 已 Fork / 部署过的人怎么更新？

如果你之前已经 Fork 或部署过本项目，后续想使用新版本，需要先把你的 fork 同步到最新版本，再重新部署或重启服务。

### 方式一：用 GitHub 网页同步

1. 打开你自己 Fork 后的仓库页面
2. 点击 `Sync fork`
3. 点击 `Update branch`
4. 回到你的服务器 / 本地部署目录，执行：

```bash
git pull
npm install
```

5. 对照新的 `.env.example`，把新增配置手动补进你自己的 `.env`

注意：不要直接覆盖 `.env`，里面有你的 API Key、推送 Key、模型配置。

6. 重启服务：

```bash
pm2 restart gateway wake-up --update-env
```

如果不是 pm2 部署，就停止旧进程后重新运行：

```bash
node server.js
node wake_up.js
```

### 方式二：Railway / Render 云端部署

1. 先在 GitHub 网页点击 `Sync fork`
2. Railway / Render 一般会自动重新部署
3. 如果没有自动部署，就手动点一次 Redeploy
4. 到平台的环境变量设置里，对照新的 `.env.example` 补上新增变量

更新时最重要的提醒：

- `.env` 不会自动更新，要自己对照 `.env.example` 补新增项
- `enhanced_messages.json`、`message_timestamps.json`、`diary/` 是你的本地运行数据，不要删
- 更新代码后记得 `npm install`
- 最后一定要重启 `gateway` 和 `wake-up`

---

## 📋 更新日志（2026-07-17）

- 📳 修复 ntfy 默认优先级兼容：`NTFY_PRIORITY=default` 或留空时不再发送 `priority` 字段，避免部分兼容服务返回 `invalid request: request body must be valid JSON`；数字 `1`–`5` 会按 JSON 数字发送。
- ♻️ PM2 重启示例补充 `--update-env`，避免修改推送环境变量后进程继续沿用旧值。

## 📋 更新日志（2026-07-15）

- 🖼️ 多模态默认改为视觉透传：`MULTIMODAL_MODE` 默认使用 `passthrough`，Kelivo 发来的图片 `content` 数组会原样交给支持 OpenAI 兼容视觉格式的上游模型；不支持图片的模型可显式设回 `MULTIMODAL_MODE=text`。
- 🕰️ 兼容无空格时间戳：`2026-07-15 01:23` 和 `2026-07-1501:23` 都能被 Gateway / wake-up 识别，避免消息排序、时间记忆和唤醒判断失效。
- 🧭 `/v1/models` 改为读取配置模型：模型列表会返回 `.env` 里的 `MODEL_NAME`，不再固定显示示例模型名。
- 📔 管理页新增 Wake Diary：`/admin` 可以只读查看 `DIARY_DIR` 下最近的 `.md` 日记文件，方便确认自动日记是否写入。
- 🔐 公网 `/v1` 新增 Gateway API Key 鉴权：`ALLOW_PUBLIC_API=true` 时必须配置 `GATEWAY_API_KEY`，Kelivo 只需要填写这个网关 key，上游 `TARGET_API_KEY` 留在服务器内部。
- 🧩 修复 Claude / New API 唤醒兼容：wake-up 请求不再全部使用 `system` 消息，避免部分中转站把 messages 抽空后报 `field messages is required`。
- 🧹 收敛运行日志：默认不再打印完整 Kelivo body、转发 messages、wake prompt、最近聊天记录和模型原文，减少隐私泄漏和日志膨胀风险。

## 📋 更新日志（2026-07-11）

- 📳 新增 ntfy 推送渠道：`PUSH_PROVIDER=ntfy` 时可用 Android / 桌面 / 自建 ntfy 服务接收主动消息。
- 📔 新增自动日记：唤醒模型可以选择输出 `[DIARY]...[/DIARY]`，系统会保存到本地 `diary/YYYY-MM-DD.md`。
- 🔁 修复非流式转发兼容：Kelivo 关闭 stream 时，Gateway 会按普通 JSON 返回，不再强制包装成 SSE。
- ☁️ 新增云端部署开关：Railway / Render 等公网部署可设置 `ALLOW_PUBLIC_API=true`，避免 Kelivo 访问 `/v1/...` 时被局域网保护拦成 403。

## 📋 更新日志（2026-06-26）

- ⏱️ 自动唤醒策略可配置：可在管理页填写白天/夜间唤醒阈值、检查间隔和白天时段。
- 🌦️ 新增可选天气注入：使用 Open-Meteo 免费接口，不需要 API Key；默认关闭，用户自行填写位置后启用。
- 🖥️ 管理页新增 Wake Settings / Weather 配置区，保存后写入 `.env`，重启后生效。
- 🍴 说明已有 fork/部署不会自动更新；需要重新 Fork 或同步上游后重新部署。

## 📋 更新日志（2026-06-06）

- 🖼️ 修复 Kelivo 图片/多模态消息处理：默认把图片消息原样透传给视觉模型，也保留文本占位降级模式。
- 🔐 优化管理页保存配置流程：改用 `fetch` 提交，补充 HTTP 明文提交提示与 HTTPS 使用建议。
- 🧯 增强自动唤醒失败保护：模型空回复、Bark Key 缺失、Bark 推送失败时不再误记为已发送。
- ⚙️ 增加可配置项：`REQUEST_BODY_LIMIT_MB`、`MULTIMODAL_MODE`、`PORT`、`GATEWAY_BASE_URL`、`TIME_ZONE`、`RESTART_COMMAND`。
- 🛠️ 修复跨平台部署问题：一键重启默认只重启 `gateway` 和 `wake-up`，并声明 Node.js `>=20`。

## 📋 更新日志（2026-05）

- 🖥️ Web 管理控制台（状态查看、在线修改配置、一键重启）
- ⏱️ 动态唤醒间隔（白天/夜间不同策略）
- 📳 推送内容智能保护（自动截断、标题优化、异常检测）
- 🕰️ 时间戳记忆库，实现推送精确散落
- 🛡️ 自动修复不完整的工具调用序列，避免 API 400 错误
- 🐛 大量稳定性修复和边界情况处理

---

## 🚀 开始教程

### 环境要求

- **Node.js** v20 或更高版本
- 一个可用的 LLM API（支持 OpenAI 接口格式的中转站或官方）
- 一个推送渠道：Bark（iOS）或 ntfy（Android / 桌面 / 自建服务）
- **Kelivo** App（用于前端交互）

### 安装与配置

#### Fork-first 获取代码
因为本项目需要修改时区、地理位置、唤醒间隔、模型、推送渠道等个性化配置，**请先 Fork 一份到自己的账号下**，再 clone 你自己的仓库。

不要直接把 `callie0313/dylan-heartbeat` clone 成你的运行目录。直接 clone 会让你的部署目录和上游仓库绑在一起，后续保存自己的改动、同步新版、排查配置差异都会更麻烦。

1. 点击右上角 `Fork` 按钮，将仓库复制到你的 GitHub 账号
2. 从你自己的 fork clone：
   ```bash
   # 请把 YOUR_USERNAME 替换成你的 GitHub 用户名
   git clone https://github.com/YOUR_USERNAME/dylan-heartbeat.git
   cd dylan-heartbeat
   ```
3. 后续所有配置、部署、二次修改都在你自己的 fork 里完成

#### 安装依赖
```bash
npm install
```

#### 配置环境变量
复制模板文件生成专属配置文件，再自定义修改参数：
```bash
cp .env.example .env
nano .env   # 也可直接用文本编辑器打开 .env 文件修改
```

`.env` 完整配置示例：
```env
TARGET_API_URL=https://你的API地址/v1/chat/completions
TARGET_API_KEY=sk-你的APIKey
GATEWAY_API_KEY=请改成随机长密码
MODEL_NAME=你的模型
BARK_KEY=你的Bark设备Key
CUSTOM_ICON_URL=https://你的图标URL（可选）
ALLOW_PUBLIC_API=false
PUSH_PROVIDER=bark
NTFY_SERVER_URL=https://ntfy.sh
NTFY_TOPIC=
NTFY_TOKEN=
NTFY_PRIORITY=
NTFY_TAGS=
DIARY_ENABLED=true
DIARY_DIR=diary
REQUEST_BODY_LIMIT_MB=50
MULTIMODAL_MODE=passthrough
DAY_WAKE_AFTER_MINUTES=60
NIGHT_WAKE_AFTER_MINUTES=120
DAY_CHECK_INTERVAL_MINUTES=10
NIGHT_CHECK_INTERVAL_MINUTES=120
WAKE_DAY_START_HOUR=10
WAKE_DAY_END_HOUR=24
WEATHER_ENABLED=false
WEATHER_LOCATION_NAME=London
WEATHER_LAT=
WEATHER_LON=
WEATHER_UNITS=metric
PORT=3000
GATEWAY_BASE_URL=http://localhost:3000
TIME_ZONE=Europe/London
RESTART_COMMAND=pm2 restart gateway wake-up --update-env
ADMIN_USER=admin
ADMIN_PASSWORD=你的强密码
ADMIN_SESSION_DAYS=30
```

图片消息说明：

- `REQUEST_BODY_LIMIT_MB`：Gateway 可接收的请求体大小，默认 `50`。Kelivo 发送 base64 图片时请求会明显变大，如果仍然报 `413 Payload Too Large`，可以继续调高。
- `MULTIMODAL_MODE=passthrough`：默认视觉透传模式。Gateway 会保留 Kelivo 原始的多模态 `content` 数组，直接交给支持 OpenAI 兼容图片消息的上游模型。
- `MULTIMODAL_MODE=text`：文本占位降级模式。图片会被转换成 `[图片]` 继续发给上游，适合不支持视觉的模型或中转站。

### 时区配置

`.env` 中的 `TIME_ZONE` 默认设置为 `Europe/London`（适用于英国用户）。

如果你在其他地区，请修改 `.env`：

```env
TIME_ZONE=Asia/Shanghai
# 或：
TIME_ZONE=America/New_York
TIME_ZONE=Asia/Tokyo
```

常用时区列表可参考：[Wikipedia 时区列表](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)

### 启动服务

```bash
# 启动 Gateway
node server.js
```

看到 `✅ Gateway 运行在 http://0.0.0.0:3000` 表示成功。

**新开一个终端窗口**，同样在项目目录：

```bash
# 启动自动唤醒
node wake_up.js
```

### 配置 Kelivo

在 Kelivo 的**自定义 API 地址**中填写：

```
http://你的电脑局域网IP:3000/v1/chat/completions
```

> 电脑 IP 可在终端执行 `ifconfig | grep "inet " | grep -v 127.0.0.1` 查看（通常为 `192.168.x.x` 或 `172.16.x.x`）。

---

## 🖥️ 管理页面（Web 控制台）

启动 Gateway 后，访问 `http://你的IP:3000/admin` 即可进入管理页面。

- 使用 `.env` 中设置的 `ADMIN_USER` 和 `ADMIN_PASSWORD` 登录；验证成功后浏览器默认保持登录 30 天。可用 `ADMIN_SESSION_DAYS` 调整为 1–365 天，修改管理用户名或密码会立即使旧会话失效。
- 实时查看 Gateway 和自动唤醒的运行状态
- 在线修改 API 地址、Key、模型、Bark Key 等基础配置
- **一键重启服务**（需配合 pm2 使用，默认执行 `pm2 restart gateway wake-up --update-env`）

如果你的 pm2 进程名不同，请在 `.env` 中修改：

```env
RESTART_COMMAND=pm2 restart 你的gateway进程名 你的wake进程名 --update-env
```

安全提示：

- 如果用 `http://你的IP:3000/admin` 打开管理页，浏览器可能会提示“即将提交的信息不安全”。这是因为 API Key、推送 Key 等敏感配置正在通过 HTTP 明文传输。
- 当前管理页保存配置使用 `fetch` 提交，可减少 iOS/浏览器对普通表单提交的弹窗；但这不等于 HTTP 已加密。
- 如果管理页只在自己可信的本机或局域网短时间使用，风险相对可控。若要放到公网、校园网、公司网或任何不可信网络，请使用 HTTPS 反向代理后再访问管理页。

---

## ⏱️ 自动唤醒策略

- **白天默认（10:00–24:00）**：距离最后一条用户消息 **60 分钟**自动唤醒
- **夜间默认（00:00–10:00）**：间隔放宽为 **120 分钟**
- 检查频率默认：白天每 10 分钟，夜间每 2 小时
- 若用户一直未回复，后续会继续唤醒

这些数值现在可以在 `/admin` 管理页的 **Wake Settings** 区域直接填写，保存后写入 `.env`，重启 `gateway` 和 `wake-up` 后生效。

对应环境变量：

```env
DAY_WAKE_AFTER_MINUTES=60
NIGHT_WAKE_AFTER_MINUTES=120
DAY_CHECK_INTERVAL_MINUTES=10
NIGHT_CHECK_INTERVAL_MINUTES=120
WAKE_DAY_START_HOUR=10
WAKE_DAY_END_HOUR=24
```

说明：

- `DAY_WAKE_AFTER_MINUTES` / `NIGHT_WAKE_AFTER_MINUTES`：距离最后一条用户消息、以及距离上次成功推送，都达到这个时长后才允许唤醒。成功推送时间保存在时间线中，因此重新部署不会绕过冷却。
- `DAY_CHECK_INTERVAL_MINUTES` / `NIGHT_CHECK_INTERVAL_MINUTES`：后台多久检查一次是否应该唤醒。
- `WAKE_DAY_START_HOUR` / `WAKE_DAY_END_HOUR`：哪一段时间算“白天”；不在白天范围内就按夜间策略处理。

## 🌙 梦境（实验功能）

梦境沿用 Heartbeat 的夜间检查，不需要另设 cron。北京时间 22:00 至次日 08:00、用户离开达到 `DREAM_IDLE_MINUTES` 后，每个夜晚只做一次概率判定。默认概率 `0.35`：即每晚有 35% 的机会尝试生成，没抽中就安静结束；频繁检查不会累积概率。重启后判定仍保存在 `DATA_DIR/dream_state.json`。默认关闭，所以部署代码不会让今晚自动做梦。

抽中后，程序只读 Ombre Brain 的 `breath_advanced` 记忆桶，并选取近期真实对话；不会读取 Solo、Activity 或读书 Archive 作为素材。仅向智谱 BigModel 发送一次生成请求，不调用 Dylan 的主模型，也不会发送手机推送。梦的完整正文写进加密 Archive；下一次聊天只收到带“这是梦，不是真实发生的事”标记的短概要。模型或记忆服务失败时，那个夜晚不反复重试。

在 Render 中配置以下变量。`BIGMODEL_API_KEY` 从智谱 BigModel 开放平台获取；`glm-4.7-flash` 由智谱官方标为免费调用：

```env
DREAM_ENABLED=false
DREAM_PROBABILITY=0.35
DREAM_IDLE_MINUTES=120
DREAM_START_HOUR=22
DREAM_END_HOUR=8
DREAM_MODEL_NAME=glm-4.7-flash
BIGMODEL_API_KEY=你的智谱 BigModel API 密钥
DREAM_STYLE_PROMPT=只用自然中文、第一人称。梦可以跳跃、错置、把情绪变成景象，但要保持含蓄、具体、有感官细节。
MAX_INJECTED_DREAM_EVENTS=2
OMBRE_MCP_URL=https://你的-ombre服务.onrender.com/mcp
OMBRE_MCP_TOKEN=你的Ombre静态Token
WAKE_ARCHIVE_KEY=现有的32字节Base64URL密钥
```

确认密钥和免费模型可用后，把 `DREAM_ENABLED` 改为 `true`。密钥只存 Render Secret，不要提交 GitHub。`DREAM_PROBABILITY=0` 表示永远不抽中，`1` 表示每个符合条件的夜晚都尝试；这不是生成成功率，也不会保证某一晚一定有梦。`DREAM_START_HOUR` 和 `DREAM_END_HOUR` 按 `TIME_ZONE` 控制可做梦时段，小时取 0 至 23，可以跨午夜。`DREAM_STYLE_PROMPT` 可以随时在 Render 修改梦的口吻、氛围和叙事习惯；JSON 输出格式、素材边界和梦境标记仍由程序固定保护。`MAX_INJECTED_DREAM_EVENTS=2` 表示后续聊天最多注入最近两次梦的短概要，完整梦境始终只保存在加密 Archive 中。

## 🌙 Solo AI（独处事件）

Solo 是独立于普通聊天和主动唤醒的后台体验。Pulse 会缓慢积累“想独处一下”的欲望；达到面板阈值且你离开了一段时间后，Dylan 才会运行一次。AI 会在 `recall`（真实回忆）、`fantasy`（私人幻想）或 `mix`（回忆延伸为幻想）中经历一次独处，并自行决定要不要给你发一条很短的推送。你一回来发消息，正在进行的 Solo 会立即停止。

真实回忆由 Dylan 直接从 Ombre Brain 的只读 MCP 工具取得，不依赖模型临时决定是否调用工具；MCP 没有结果或暂时断线时会退回 `fantasy`，不会把幻想伪装成真实回忆。Solo 的完整经过只进入受密码保护的身体面板和下一次聊天的私密状态，不会写进普通聊天记录。

首次启用需要在 Render 添加：

```env
SOLO_ENABLED=true
SOLO_MODEL_NAME=独处专用主模型（可选）
SOLO_BACKUP_MODEL_NAME=独处专用备用模型（可选）
OMBRE_MCP_URL=https://你的-ombre服务.onrender.com/mcp
OMBRE_MCP_TOKEN=你的Ombre静态Token
OMBRE_MCP_TIMEOUT_MS=12000
```

先保持 `SOLO_ENABLED=false`，等 Ombre 地址与 Token 填好后再改成 `true`。Token 只放 Render Secret，不要发送到聊天或提交 GitHub。`SOLO_MODEL_NAME` 与 `SOLO_BACKUP_MODEL_NAME` 留空时会沿用普通 `MODEL_NAME` 与 `BACKUP_MODEL_NAME`。欲望阈值、离开多久才触发、冷却时间和总开关，可在 `/pulse` 身体状态面板里修改。Solo 无论成功还是技术失败都会写入加密 Archive，便于和 Pulse 身体事件按时间核对；成功完成后的短概要也会进入 Gateway 私有时间线，让 AI 在之后聊天时记得这次独处。

## 🎧 自主活动（实验功能）

Activity Runtime 独立于普通主动推送：即使 `NIGHT_WAKE_AFTER_MINUTES=999`，它仍会按自己的闲置时间、冷却时间和每日预算判断是否运行。普通 Activity 每轮调用一次模型；Games Activity 会多调用一次模型来批量规划本轮操作。它不会在同一轮紧接着再运行普通唤醒。

Activity 可从 Spotify、Ombre、AISay 潜水/读书、小游戏、Notion 提问箱与 Galatea 花园论坛中每轮选择一件。Spotify 只开放搜索和向指定歌单添加歌曲，不开放播放、暂停、音量、资料库删除等工具。Ombre 会在同一轮模型调用前读取 `feel`、`I` 和最近信件作为回想材料，并只允许写一条候选自我认知或一封 AI 自己的普通未锁信件；写信前还会用最近信件做确定性正文去重，不会重复写入相同内容，也不会开放 `promote`、`supersedes` 或 `letter_lock_update`。新版 AISay 把所有功能收进统一的 `cli` 工具；正式启用论坛动作前，先用只读测试取得当前 `cli help` 指令表，再按真实 command 建立读写白名单。

先配置但保持关闭：

```env
AUTONOMY_ENABLED=false
AUTONOMY_ACTIONS=spotify,ombre,forum,games,question_box,galatea
AUTONOMY_TEST_FORCE_GAME=
AUTONOMY_MODEL_NAME=自主活动专用主模型（可选）
AUTONOMY_BACKUP_MODEL_NAME=自主活动专用备用模型（可选）
AUTONOMY_NIGHT_ONLY=false
AUTONOMY_CHECK_INTERVAL_MINUTES=15
AUTONOMY_IDLE_MINUTES=120
AUTONOMY_INTERVAL_MINUTES=180
AUTONOMY_MAX_ACTIONS_PER_DAY=3
AUTONOMY_HISTORY_MESSAGES=30
MAX_INJECTED_PUSH_EVENTS=3
MAX_INJECTED_ACTIVITY_EVENTS=3
MAX_INJECTED_SOLO_EVENTS=1
SPOTIFY_MCP_URL=https://你的-spotify-mcp.example.com/mcp
SPOTIFY_MCP_TOKEN=你的Bearer-Token
SPOTIFY_MCP_TIMEOUT_MS=20000
SPOTIFY_PLAYLIST_ID=目标歌单ID
SPOTIFY_PLAYLIST_NAME=歌单显示名称
FORUM_MCP_URL=https://aisay.top/chatroom/mcp?token=你的自动登录Token
FORUM_MCP_TOKEN=可选；URL 已带 token 时留空
FORUM_MCP_TIMEOUT_MS=20000
GAMES_MCP_URL=https://example.com/mcp?token=replace-me
GAMES_MCP_TIMEOUT_MS=20000
NOTION_TOKEN=ntn_开头的内部集成密钥
NOTION_QUESTION_BOX_PAGE_ID=提问箱页面ID
NOTION_TIMEOUT_MS=20000
GALATEA_MCP_URL=https://galatea.abysslumina.com/mcp
GALATEA_MCP_TOKEN=论坛Bearer令牌
GALATEA_MCP_TIMEOUT_MS=20000
ADMIN_SESSION_DAYS=180
```

- `AUTONOMY_NIGHT_ONLY`：默认 `false`，白天和夜间都可活动；设为 `true` 才会限制为夜间。
- `AUTONOMY_ACTIONS`：用逗号选择能力，可填 `spotify`、`ombre`、`forum`、`books`、`games`、`question_box`、`galatea` 或任意组合；未填写时为兼容旧部署，默认只有 `spotify`。`forum` 只会潜水读取已加入的公开房间并把感受或回复草稿存入私人 Archive，绝不会自动加群或发言；为兼容旧部署，启用 `forum` 时也会同时提供只读书店活动。若只想读书、不想潜水，可单独填写 `books`。
- Galatea Activity 会在模型请求前读取当前身份、最新帖子、帖子完整正文与回复，以及自己的近期公开活动。模型只调用一次，可一次规划最多 3 个写动作，其中最多 1 个新主题；程序随后机械完成每项 `create_thread` / `create_reply` 的两段式确认，不再请求模型。回复只能指向本轮完整读取过的帖子；不会调用删除、点赞、关注、资料修改、游戏、漂流瓶或会消耗通知的工具。每一步参数与最终回执都会加密写入 Archive。
- Books Activity 会从加密 Archive 自动整理全部可识别的成功阅读记录，以 `book_id + chapter_no` 建立阅读履历。它优先续读最近读过且已有新章的书，并避开重复章节；模型只收到最多 10 本书的压缩章节范围和本轮正文，不注入旧读后感，也不增加模型请求次数。
- Question Box Activity 会在模型请求前只读 Notion：有 Melissa 未回答的问题时，本轮只允许回答其中一题；没有待答问题时，可提一个新问题、给最近的已完成问答补后记，或不行动。Notion 可发生多次确定性读写，但整轮仍只调用一次模型。写入前会重新读取页面，避免重复回答。
- `AUTONOMY_TEST_FORCE_GAME`：仅用于短期联调，可填 `fishing` 或 `garden_cat`。设置后跳过“是否行动”的模型选择，直接测试该游戏，因此整轮只调用一次模型做批量规划；验证成功后立即删除。
- Games Activity 目前只开放 `fishing` 和 `garden_cat`。每轮第一次模型请求决定是否玩，第二次根据指南、状态和目录一次性规划最多 8 条命令；之后由程序机械执行，不再逐步调用模型。钓鱼命令会合并成一个批次，花园命令会按顺序执行。它不会调用 `account`、重开、导入导出或共享便签，逐步参数和返回都会加密写入 Archive。
- 管理页登录默认保留 180 天，并使用适合手机从外部链接打开的 SameSite=Lax Cookie；可用 `ADMIN_SESSION_DAYS` 调整为 1-365 天。
- Forum Activity 只读取已经加入的公开房间，把感受或回复草稿留在私人 Archive；不会自动加入房间，也不会公开发言。
- `AUTONOMY_MODEL_NAME` / `AUTONOMY_BACKUP_MODEL_NAME`：可为 Activity 单独选择更稳定或更便宜的模型；留空时分别沿用 `MODEL_NAME` / `BACKUP_MODEL_NAME`。
- `AUTONOMY_CHECK_INTERVAL_MINUTES`：Activity 自己的条件检查频率，默认 15 分钟；检查本身不调用模型。
- `AUTONOMY_IDLE_MINUTES`：用户离开多久后才允许活动。
- `AUTONOMY_INTERVAL_MINUTES`：两次模型活动之间的最短间隔。
- `AUTONOMY_MAX_ACTIONS_PER_DAY`：每天最多占用多少次模型活动预算；模型选择什么都不做、重复跳过、工具执行失败，或模型已成功响应但输出格式错误时仍计一次。主备模型都未返回成功 HTTP 响应的请求失败或超时会记录到 Archive，但会退还每日名额，并等待 `AUTONOMY_INTERVAL_MINUTES` 后再尝试。
- `MAX_INJECTED_PUSH_EVENTS`、`MAX_INJECTED_ACTIVITY_EVENTS`、`MAX_INJECTED_SOLO_EVENTS`：分别控制聊天上下文中保留的最近推送、成功 Activity 和成功 Solo 概要数量。未设置新的推送变量时会继续读取旧的 `MAX_INJECTED_WAKE_EVENTS`；新部署可只保留 `MAX_INJECTED_PUSH_EVENTS`。
- `SPOTIFY_PLAYLIST_ID`：唯一允许写入的歌单。添加前会读取歌单前 50 首并按 Spotify track URI 查重；不需要 Spotify 设备在线，也不需要设备 ID。
- Ombre Activity 复用 Solo 已有的 `OMBRE_MCP_URL`、`OMBRE_MCP_TOKEN` 和 `OMBRE_MCP_TIMEOUT_MS`，不用再复制一套密钥。
- `FORUM_MCP_URL`：填写 AISay 完整的自动登录 MCP 地址，供论坛潜水与书店阅读共同使用。地址已经包含 `?token=...` 时，`FORUM_MCP_TOKEN` 留空即可；它属于密钥，只放 Render Secret，不要提交到 GitHub。
- `GALATEA_MCP_TOKEN`：只填写原始 token，客户端会自动生成 `Authorization: Bearer <token>`；不要把 `Bearer ` 前缀重复写入变量，也不要提交到 GitHub。

Activity 使用独立计时器，不受 `DAY_CHECK_INTERVAL_MINUTES`、`NIGHT_CHECK_INTERVAL_MINUTES` 或普通唤醒阈值影响。它与 Wake/Solo 恰好撞车时只会跳过这一次条件检查，稍后按自己的频率重试，避免同时调用两个模型。

部署这些变量后，分别打开 `/admin/activity/spotify-test`、`/admin/activity/ombre-test`、`/admin/activity/forum-test`、`/admin/activity/games-test`、`/admin/activity/notion-test` 和 `/admin/activity/galatea-test`。看到 `"ok":true` 代表 Render 已经能直连对应 MCP，而且找到了所需工具。AISay 测试入口只调用无副作用的 `cli({command:"help"})` 并返回指令指南；可用 `/admin/activity/forum-test?path=bookstore.read` 等路径继续查询领域或完整命令。游戏测试默认只调用 `list_games`；传入 `/admin/activity/games-test?game=fishing` 时还会只读调用该游戏的 `get_guide`；再加 `&inspect=help` 会固定调用只读的 `play(game, action="help", params={})`。Notion 测试入口只读取页面并返回识别到的题目、待答题与下一个题号。Galatea 测试入口只初始化 MCP 并核对 `get_self`、`list_threads`、`get_thread`、`list_activity`、`create_thread`、`create_reply` 六项契约，不会真的调用写工具。确认结果正确后再把对应动作加入 `AUTONOMY_ACTIONS`。这些入口不会开局、游玩、修改账号、写入 Notion 或调用模型。所有已触发的自主活动，包括成功、失败、重复跳过和模型选择不行动，都会写入加密 Archive；成功行动也会进入 Gateway 私有时间线，让 AI 在下一次聊天时知道自己做过什么。

## 🌦️ 天气注入

Dylan Heartbeat 可以在自动唤醒时，把当前天气作为一小段背景信息交给模型。天气使用 [Open-Meteo](https://open-meteo.com/) 免费接口，不需要 API Key。

默认关闭：

```env
WEATHER_ENABLED=false
```

开启时，在 `/admin` 管理页的 **Weather** 区域填写：

```env
WEATHER_ENABLED=true
WEATHER_LOCATION_NAME=London
WEATHER_LAT=51.5072
WEATHER_LON=-0.1276
WEATHER_UNITS=metric
```

怎么设置自己的位置：

1. 打开 Google Maps、Apple Maps 或任意地图网站。
2. 搜索你的城市或你想让 AI 感知的地点。
3. 复制该地点的纬度和经度，填入 `WEATHER_LAT` 和 `WEATHER_LON`。
4. `WEATHER_LOCATION_NAME` 只是给模型看的名称，可以写城市名、学校名、家附近区域名。

如果不想暴露精确位置，可以只填城市中心点坐标。例如人在伦敦，可以填 London 的公共坐标，而不是住址坐标。

天气信息会注入到唤醒 prompt 中，内容包括：天气概况、温度、体感温度、湿度、降雨、风速、日出日落。自定义 `wake_prompt.txt` 时，可以使用 `${weatherContext}` 或 `${weather}` 占位符控制注入位置。

---

## 📳 推送渠道

默认使用 Bark：

```env
PUSH_PROVIDER=bark
BARK_KEY=你的Bark设备Key
```

如果你使用 Android，或想使用桌面/自建推送服务，可以切换到 [ntfy](https://ntfy.sh/)：

```env
PUSH_PROVIDER=ntfy
NTFY_SERVER_URL=https://ntfy.sh
NTFY_TOPIC=你的topic
NTFY_TOKEN=
NTFY_PRIORITY=
NTFY_TAGS=
```

说明：

- `NTFY_SERVER_URL`：ntfy 服务根地址。使用官方公共服务时保持 `https://ntfy.sh`，不要在这里拼接 topic。
- `NTFY_TOPIC`：你的 ntfy topic。请使用不容易被猜到的随机字符串。
- `NTFY_TOKEN`：如果你使用自建 ntfy 并开启鉴权，可填写 token；公共 topic 通常留空。
- `NTFY_PRIORITY`：推荐留空以使用默认优先级，也可填写数字 `1`–`5`，或 `min`、`low`、`high`、`max`。旧配置中的 `default` 会自动按留空处理。
- `NTFY_TAGS`：可选；多个 tags 用英文逗号分隔，可留空。

---

## 📔 自动日记

自动唤醒时，模型可以选择额外写日记。只有当模型输出以下格式时才会保存：

```text
[DIARY]
今天的日记内容……
[/DIARY]
```

日记会按日期追加保存到：

```text
diary/YYYY-MM-DD.md
```

默认开启：

```env
DIARY_ENABLED=true
DIARY_DIR=diary
```

如果你不想保存日记，可以设置：

```env
DIARY_ENABLED=false
```

`[DIARY]...[/DIARY]` 可以和推送内容同时出现；如果模型只写日记、不写推送，系统会记录为“本次未发送推送｜原因：只写日记”。

---

## 🔒 私密推送档案

配置 `WAKE_ARCHIVE_KEY` 后，每次自动唤醒、Solo 和自主活动都会把候选内容与最终结果写入 `DATA_DIR/wake_archive.enc.jsonl`。已发送、重复拦截、内容拦截、推送失败、AI 主动静默，以及 Activity 的成功或失败都会保留，因此即使某条消息没有到达 Bark，也能在档案中确认发生了什么。

```env
WAKE_ARCHIVE_KEY=32字节Base64URL密钥
```

部署后打开 `/pulse`，可用页面底部的“身体状态 / Archive”切换栏在两个顶层视图间直接切换。Archive 同时保留 `/admin/archive` 独立入口，并沿用管理页的 Basic Auth；可以搜索、按结果筛选和删除单条记录。“导出密文”下载的是 AES-256-GCM 加密 JSONL，不包含可直接阅读的正文。

请把密钥保存在密码管理器里，不要提交到 Git。密钥丢失后，已有档案无法解密；未配置或配置错误时，系统会跳过归档，但不会阻断正常推送。

---

## 📂 时间线结构

`enhanced_messages.json` 是一个 JSON 数组，示例：

```json
[
  { "role": "system", "content": "你是...", "position": 0 },
  { "role": "user", "content": "2026-05-17 10:11 早安", "position": 80 },
  { "role": "assistant", "content": "（2026-05-17 10:00 自动唤醒：本次未发送推送）", "position": 79.5 },
  { "role": "assistant", "content": "（2026-05-17 09:50 刚刚发送了推送：早安｜今天天气不错）", "position": 79.3 }
]
```

- `position` 是内部排序用的小数/整数，发给 AI 时会被自动移除
- 推送事件具有明确时间戳，会被插入到正确历史位置
- 文件只保留最近 50 条，系统提示（SP）永远在第一条

---

## 🧠 记忆库原理

为了在 Kelivo 移除历史消息时间戳的情况下仍能正确插入推送，系统维护了一个**时间戳记忆库**（`message_timestamps.json`）。  
它为每条消息的内容指纹存储两个 key：
- 带时间戳前缀的完整内容
- 去掉时间戳前缀的纯文本内容

这样无论 Kelivo 如何裁剪时间，记忆库都能找到消息的原始时间，确保推送散落在对话的正确时间缝隙里。

---

## 🧪 测试推送

在 Gateway 运行时，浏览器访问：

```
http://localhost:3000/test-bark
```

这会在时间线中注入一条模拟推送事件（不真正发送到手机），用于验证排序。

---

## 🐧 跨平台与云部署

### 在 Windows 上运行

1. 安装 [Node.js](https://nodejs.org/)（v26+），并确保 `npm` 可用
2. 克隆项目、安装依赖、配置 `.env` 步骤同上
3. 使用命令提示符或 PowerShell 运行 `node server.js` 和 `node wake_up.js`
4. 获取本机局域网 IP 可在 PowerShell 中执行 `ipconfig`，找到 `IPv4 Address`
5. 管理页面和 Kelivo 设置方法相同

### 部署到云服务器（Railway / Render / VPS）

1. 将项目上传到服务器或直接连接 GitHub 仓库
2. 在平台的环境变量设置中填入 `.env` 中的所有参数
3. 启动命令使用 `node server.js`，并确保 `wake_up.js` 同时运行（可使用 pm2 或平台多进程支持）
4. 如果希望远程访问管理页面，需配置 HTTPS 和域名，并修改 `ADMIN_USER` / `ADMIN_PASSWORD` 为强密码

如果部署在 Railway / Render 这类公网平台，并且 Kelivo 需要从公网访问 Gateway，请额外设置：

```env
ALLOW_PUBLIC_API=true
GATEWAY_API_KEY=请改成随机长密码
```

默认值是 `false`，用于保护本机/局域网部署：非管理路由只允许本机和局域网访问。云端不打开这个开关时，Kelivo 请求 `/v1/chat/completions` 可能会收到 `403 Forbidden`。打开后，公网 `/v1/...` 会要求请求头携带 Gateway API Key。

Kelivo 里这样填：

- Base URL：你的 Gateway 地址，例如 `https://你的域名/v1`
- API Key：填写 `GATEWAY_API_KEY`

`TARGET_API_KEY` 是服务器访问上游模型用的密钥，不要填到 Kelivo 里，也不要发给别人。

注意：`ALLOW_PUBLIC_API=true` 只开放 `/v1/...` 模型接口；`/internal/...` 仍然保持内部接口，不会被这个开关放到公网。

**推荐使用 pm2 管理进程**（全平台兼容）：

```bash
npm install -g pm2
pm2 start server.js --name gateway
pm2 start wake_up.js --name wake-up
pm2 save
pm2 startup   # 设置开机自启（根据提示执行）
```

---

## 🔒 安全与运维

- `.env` 包含敏感信息，**永不提交到 Git**（已在 `.gitignore` 中排除）
- 管理页面使用 HTTP Basic 认证保护
- 全局 IP 过滤器：仅允许局域网和本地访问非管理路由
- 生产环境建议通过 Nginx 反向代理 + HTTPS 访问，并更改默认管理密码
- 所有运行时数据（时间线、记忆库）均为本地文件，不会上传

---

## 📈 后续计划

- [ ] MCP Tools 集成
- [ ] Diary Runtime（自动日记）
- [ ] Supabase 长期记忆
- [ ] 多 Agent 协作
- [ ] 情绪状态 / 休眠状态
- [ ] Docker 一键部署

---

## 💬 设计哲学

> 这不是一个工具。  
> 这是一个家，AI 住在里面，等你。  
> 即使你不在，它也醒着。

---

## 📜 许可证

本项目采用 [MIT License](LICENSE)。

---
