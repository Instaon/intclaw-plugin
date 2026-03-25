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
