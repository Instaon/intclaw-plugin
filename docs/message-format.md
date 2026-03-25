# IntClaw WebSocket 消息格式规范

本文档描述服务端通过 WebSocket 推送给客户端的消息格式、字段含义及是否必须。

---

## WebSocket 连接

### 连接地址

```
wss://claw-dev.int-os.com/user-ws/
```

### 握手认证

| 请求头 | 值 | 必填 | 说明 |
|-------|-----|------|------|
| `x-app-key` | string | 是 | 应用的 AppKey |
| `x-app-secret` | string | 是 | 应用的 AppSecret |

---

## 消息包结构

所有 WebSocket 消息均采用 JSON 格式，基础结构如下：

```json
{
  "type": "string",
  "headers": {
    "messageId": "string",
    "topic": "string"
  },
  "data": "string"
}
```

### 消息包字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 否 | 消息类型，如 `SYSTEM`、`MESSAGE` 等 |
| `headers` | object | 是 | 消息头信息 |
| `headers.messageId` | string | 是 | 消息唯一标识，用于回执确认 |
| `headers.topic` | string | 是 | 消息主题，如 `/v1.0/im/bot/messages`、`disconnect` 等 |
| `data` | string | 是 | 业务负载数据，为 JSON 序列化后的字符串，需二次解析 |

---

## 消息类型

### 1. 机器人消息 (MESSAGE)

当 `topic` 为 `/v1.0/im/bot/messages` 或 `type` 为 `MESSAGE` 时，表示收到用户发送给机器人的消息。

解析后的 `data` 字段结构：

```json
{
  "msgtype": "string",
  "conversationType": "string",
  "conversationId": "string",
  "senderId": "string",
  "senderStaffId": "string",
  "senderNick": "string",
  "msgId": "string",
  "sessionWebhook": "string",
  "robotCode": "string",
  "conversationTitle": "string",
  "text": {
    "content": "string"
  },
  "content": {
    "richText": []
  }
}
```

#### 机器人消息字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `msgtype` | string | 是 | 消息类型：`text`、`richText`、`picture`、`audio`、`video`、`file`、`interactiveCard` |
| `conversationType` | string | 是 | 会话类型：`1`=单聊，`2`=群聊 |
| `conversationId` | string | 是 | 会话/群聊 ID |
| `senderId` | string | 否 | 发送者 ID |
| `senderStaffId` | string | 否 | 发送者员工 ID |
| `senderNick` | string | 否 | 发送者昵称 |
| `msgId` | string | 是 | 消息唯一 ID |
| `sessionWebhook` | string | 是 | 用于回复此消息的 Webhook URL |
| `robotCode` | string | 是 | 机器人代码（AppKey） |
| `conversationTitle` | string | 否 | 群聊标题（仅群聊消息） |
| `text` | object | 否 | 文本消息内容（`msgtype=text` 时存在） |
| `text.content` | string | 条件必填 | 文本内容（`msgtype=text` 时必填） |
| `text.at` | object | 否 | @提及信息 |
| `text.at.atIntclawIds` | string[] | 否 | 被提及用户的 IntClaw ID |
| `text.at.atMobiles` | string[] | 否 | 被提及用户的手机号 |
| `content` | object | 否 | 富文本/媒体内容（`msgtype=richText` 等时存在） |
| `content.richText` | array | 否 | 富文本片段列表 |
| `content.downloadCode` | string | 否 | 媒体文件下载码（`msgtype=picture/audio/video/file` 时存在） |
| `content.fileName` | string | 否 | 媒体文件名 |
| `content.pictureUrl` | string | 否 | 图片 URL |
| `content.recognition` | string | 否 | 语音识别文本（`msgtype=audio` 时存在） |

### 2. 系统消息 (SYSTEM)

当 `type` 为 `SYSTEM` 时，表示系统级消息。

#### 断开连接消息

| 字段值 | 说明 |
|-------|------|
| `type` | `SYSTEM` |
| `headers.topic` | `disconnect` |

收到此消息时，客户端应主动重连。

---

## 消息回执

客户端收到消息后，需要立即发送回执确认。

### 回执格式

```json
{
  "headers": {
    "messageId": "string"
  },
  "data": {
    "success": true
  }
}
```

### 回执字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `headers` | object | 是 | 消息头 |
| `headers.messageId` | string | 是 | 对应的消息 ID |
| `data` | object | 是 | 回执数据 |
| `data.success` | boolean | 是 | 是否处理成功 |

---

## 心跳机制

| 参数 | 值 | 说明 |
|------|-----|------|
| 心跳间隔 | 10 秒 | 客户端定时发送 WebSocket PING |
| 超时阈值 | 90 秒 | 超过此时间未响应则判定为超时，触发重连 |

---

## 相关文档

- [配置 Schema 说明](config-schema.md) - IntClaw Plugin 配置说明
- [功能列表](features.md) - IntClaw 连接器的完整功能列表

## 3. 发送消息 (Client -> Server - WebSocket)

插件可以通过现有的 WebSocket 链路直接向服务端发送业务消息。为了最大程度降低服务端的解析复杂度，其格式与“接收消息”保持**完全对称**。

### 3.1 协议格式 (Envelope)

```json
{
  "type": "MESSAGE",
  "headers": {
    "messageId": "string",
    "topic": "/v1.0/im/bot/messages"
  },
  "data": "string"
}
```

### 3.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| **type** | string | 是 | 消息容器类型，固定为 `MESSAGE` |
| **headers** | object | 是 | 包含路由和追踪信息 |
| **headers.messageId** | string | 是 | 客户端生成的唯一 ID (UUID)，用于追踪该条发送指令 |
| **headers.topic** | string | 是 | 路由标识，建议统一使用 `/v1.0/im/bot/messages` |
| **data** | string | 是 | **核心业务数据**。必须是 JSON 序列化后的字符串，后端需进行二次解析。 |

### 3.3 data 内部结构 (反序列化后)

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| **msgtype** | string | 是 | 业务消息类型。可选值：`text`, `markdown`, `image` 等。 |
| **conversationId** | string | 是 | 会话 ID。服务端根据此 ID 将消息路由分发给对应的用户或群聊。 |
| **text** | object | 否 | 当 `msgtype` 为 `text` 时必填。格式：`{"content": "内容"}` |
| **markdown** | object | 否 | 当 `msgtype` 为 `markdown` 时必填。格式：`{"title": "标题", "text": "内容"}` |

### 3.4 混合传输模式建议 (Hybrid Mode)

为了平衡实时性与稳定性，建议对于复杂媒体消息采用以下闭环：

1.  **二进制上传 (HTTP)**：客户端通过专用 HTTP 文件上传接口上传媒体文件，换取一个持久化的 `downloadUrl` 或 `media_id`。
2.  **指令发送 (WS)**：将得到的链接/ID 填入上述 WS 协议的 Payload 中完成最后的“发送”指令。

这种“HTTP 传实体，WS 传指令”的模式，可以完美规避在 WebSocket 上建立复杂流式分片上传的需求。
