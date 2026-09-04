# Dylan Pulse

给 Kelivo + Dylan Heartbeat 增加心跳、体温、呼吸、感官状态和可见状态条的独立 Cloudflare Worker。

它不修改 Dylan Heartbeat，也不接管主动推送：

```text
Kelivo → Dylan Pulse → 现有 Dylan Gateway → 模型 API
                     ←                    ←
```

普通聊天时，Pulse 会：

1. 从最新用户消息识别情绪和身体接触。
2. 根据上次状态和经过时间更新心率、体温、呼吸与四类感官。
3. 把详细状态作为隐藏的 `<pulse_state>` 注入系统提示。
4. 将请求交给现有 Dylan Gateway。
5. 在模型回复顶部添加一行可见状态：

```text
♡ 84 bpm · 36.9°C · 呼吸平稳 · 拥抱余温
```

下一轮转发前，Pulse 会移除旧状态条，避免污染 Dylan 时间线和模型记忆。

## 安全设计

- Dylan、模型 API 和主动推送代码均不需要修改。
- Pulse 的 D1 读取或计算失败时，请求会原样转给 Dylan。
- Kelivo 使用单独的 `PULSE_CLIENT_KEY`，不会接触模型真实 API Key。
- Dylan 的 `GATEWAY_API_KEY` 只保存在 Cloudflare Secret 中。
- 身体面板使用独立密码和加密签名的登录 Cookie。
- 超过 6 MB 的图片/多模态请求会直接透传，避免解析大体积 base64；该轮不注入身体状态和状态条。

## 需要准备什么

不需要把任何密钥发给 Codex。部署时只需要你自己准备：

1. 现有 Dylan Gateway 的公网地址，例如 `https://dylan-example.onrender.com`。
2. Dylan Render 环境变量中的 `GATEWAY_API_KEY`。
3. 自己新设三个随机密码：
   - `PULSE_CLIENT_KEY`：填写到 Kelivo。
   - `DASHBOARD_PASSWORD`：打开身体面板时使用。
   - `SESSION_SECRET`：只给面板 Cookie 签名，不需要记忆或输入 Kelivo。

Pulse 不需要模型供应商的 `TARGET_API_KEY`。

## 部署到 Cloudflare

### 1. 安装依赖并登录

需要 Node.js 20 或更新版本。

```powershell
npm install
npx wrangler login
```

### 2. 创建 D1

```powershell
npx wrangler d1 create pulse-state
```

命令会显示一个 `database_id`。打开 `wrangler.jsonc`，把：

```json
"database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

替换为刚得到的 ID。

创建表：

```powershell
npx wrangler d1 migrations apply pulse-state --remote
```

### 3. 安全保存五个配置

逐条运行。命令会让你在终端里粘贴值，值不会写进仓库：

```powershell
npx wrangler secret put PULSE_CLIENT_KEY
npx wrangler secret put DYLAN_GATEWAY_BASE_URL
npx wrangler secret put DYLAN_GATEWAY_KEY
npx wrangler secret put DASHBOARD_PASSWORD
npx wrangler secret put SESSION_SECRET
```

填写说明：

| Secret | 填什么 |
|---|---|
| `PULSE_CLIENT_KEY` | 新生成的长随机密码 |
| `DYLAN_GATEWAY_BASE_URL` | 现有 Dylan 地址，不需要加 `/v1/chat/completions` |
| `DYLAN_GATEWAY_KEY` | 现有 Dylan 的 `GATEWAY_API_KEY` |
| `DASHBOARD_PASSWORD` | 你打开身体面板时输入的密码 |
| `SESSION_SECRET` | 另一条至少 32 字符的随机字符串 |

### 4. 部署

```powershell
npm run deploy
```

成功后会得到类似地址：

```text
https://dylan-pulse.<你的子域>.workers.dev
```

健康检查：

```text
https://dylan-pulse.<你的子域>.workers.dev/healthz
```

身体面板：

```text
https://dylan-pulse.<你的子域>.workers.dev/body
```

## Kelivo 配置

保留原 Dylan 供应商，不要删除。再新增一个供应商：

| 字段 | 填写 |
|---|---|
| 类型 | OpenAI |
| 名称 | Dylan Pulse |
| API Key | `PULSE_CLIENT_KEY` 的值 |
| Base URL | `https://dylan-pulse.<你的子域>.workers.dev/v1` |
| API 路径 | `/chat/completions` |
| Use Responses API | 关闭 |

模型名称保持与原 Dylan 供应商一致。

先新建一个测试会话发送：

```text
抱抱你
```

正常结果应当同时满足：

- 回复顶部出现 `♡ ... bpm` 状态条。
- 打开 `/body` 能看到心率、体温、呼吸、感官残留和最近身体事件。
- 切回原 Dylan 供应商仍可正常聊天。

## 本地测试

核心测试不需要 Cloudflare 登录：

```powershell
npm test
```

测试覆盖：

- 拥抱触发触觉、情绪和心率变化。
- 感官状态随时间衰减。
- 隐藏状态只注入一次。
- 旧状态条进入 Dylan 前会被移除。
- 普通 JSON 回复添加状态条。
- SSE 流式回复添加状态条且不重复。
- D1 故障时原请求仍会发给 Dylan。
- 错误的 Kelivo Pulse Key 会被拒绝。

## 当前范围

第一版有：

- 心率、体温、呼吸。
- 触觉、听觉、嗅觉、味觉。
- 开心、亲近、兴奋、紧张、生气、难过、受惊、平静。
- 时间衰减和昼夜基础心率。
- 隐藏身体状态、可见状态条、私密监控页面。

第一版没有：

- Dylan 主动推送状态。
- Solo、玩具、主动碎碎念。
- 完整 1120 条身体语料池。
- 视觉感官。

这些功能可以在基础版本稳定后单独增加，不影响现有 Dylan。
