# 项目服务端交互数据格式分析报告

项目主要通过 **WebSocket** 进行长连接交互（接收消息），并通过 **HTTP/Webhook** 进行短连接交互（发送消息/AI Card 交互）。所有交互数据均采用 **JSON** 格式。

## 1. 入向交互 (服务端 -> 插件)
主要采用 **WebSocket Stream** 模式。

- **协议**: WebSocket (`ws` 模块)
- **认证**: 握手时通过 Header 传输 `x-app-key` 与 `x-app-secret`
- **默认地址**: `wss://claw-dev.int-os.com/user-ws/`
- **消息包结构**:
  ```json
  {
    "type": "SYSTEM",     // 消息类型，普通消息可忽略
    "headers": {
      "messageId": "...",  // 消息唯一 ID
      "topic": "..."       // 主题，如 disconnect
    },
    "data": "JSON_STRING"  // 实际业务负载，为 JSON 序列化后的字符串
  }
  ```
- **Payload 详情 (解析后的 `data`)**:
  包含 `msgtype` (text/markdown), `conversationId`, `senderId`, `sessionWebhook` (用于回复的 URL) 等字段。

---

## 2. 出向交互 (插件 -> 服务端)
主要分为普通消息回复、主动推送和 AI Card 流式交互。

### A. 普通消息回复 (Webhook)
- **协议**: HTTP POST
- **认证**: Header 带 `x-acs-intclaw-access-token`
- **格式**: 符合钉钉机器人风格的消息结构
  ```json
  {
    "msgtype": "markdown",
    "markdown": {
      "title": "标题",
      "text": "内容"
    },
    "at": { "userIds": [...], "isAtAll": false }
  }
  ```

### B. AI Card 流式响应 (AI Card API)
针对流式输出场景，项目会调用特定的 AI Card 接口进行状态管理和内容更新。

1. **创建卡片**: `POST /v1.0/card/instances` 并调用 [deliver](file:///Users/bianhui/Documents/Code/yinta-chajian/src/reply-dispatcher.ts#396-562) 接口投放。
2. **流式更新**: `PUT /v1.0/card/instances` 采用 Patch 方式逐步更新卡片文本内容。
3. **结束卡片**: 最终写入 `FINISHED` 状态标志。

---

## 3. 辅助交互
- **心跳机制**: 每 10s 发送一次原生 WebSocket PING，90s 无响应视为超时并重连。
- **确认机制**: 收到消息后，通过 WebSocket 发送回执 JSON：
  ```json
  {
    "headers": { "messageId": "..." },
    "data": { "success": true }
  }
  ```
