# Open Responses over WebSocket

本文档定义 `/ws/chat` 使用的业务消息格式。WebSocket 上传输的内容是**标准 JSON 对象本身**，不再额外包一层 `MESSAGE / headers / data` envelope。

## 1. 总览

- 用户侧发送：标准 request 对象。
- 助手侧发送：标准 `response.*` 流式事件，或完整 `response` 对象。
- 会话路由：统一使用 `metadata.session_id`。
- MQ 路由：网关会把 `session_id`、`sender_id`、`sender_type` 等路由元数据封装到 MQ 消息中，但这些字段不是 WebSocket 业务协议的一部分。

## 2. 用户请求对象

### 2.1 完整请求示例

```json
{
  "model": "your-model",
  "stream": true,
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "你好，介绍一下你自己"
        }
      ]
    }
  ],
  "metadata": {
    "session_id": "sess_123456"
  }
}
```

### 2.2 字段说明

- `model`: 目标模型标识。由调用方决定具体值。
- `stream`: 是否要求流式返回。
  - `true`: 期望收到一系列 `response.*` 事件。
  - `false`: 期望收到完整 `response` 对象。
- `input`: 输入数组。当前对话消息应放在这个数组里。
- `metadata`: 扩展元数据。
- `metadata.session_id`: 当前消息所属会话 ID。`/ws/chat` 路由必填。

## 3. Input Item 结构

`input` 数组中的每一项都是一个输入 item。最常见的是 `message`。

### 3.1 message item 示例

```json
{
  "type": "message",
  "role": "user",
  "content": [
    {
      "type": "input_text",
      "text": "你好，介绍一下你自己"
    }
  ]
}
```

### 3.2 字段说明

- `type`: item 类型。普通用户消息使用 `"message"`。
- `role`: 发送者角色。用户输入固定为 `"user"`。
- `content`: 内容分片数组。

### 3.3 input_text part 示例

```json
{
  "type": "input_text",
  "text": "你好，介绍一下你自己"
}
```

字段说明：

- `type`: 输入内容类型。文本输入使用 `"input_text"`。
- `text`: 用户输入的文本内容。

## 4. 非流式输出对象

当请求中的 `stream` 为 `false` 时，助手侧可以直接返回完整 `response` 对象。

### 4.1 完整响应示例

```json
{
  "id": "resp_123",
  "object": "response",
  "status": "completed",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "你好，我是一个 AI 助手。"
        }
      ]
    }
  ],
  "output_text": "你好，我是一个 AI 助手。",
  "metadata": {
    "session_id": "sess_123456"
  }
}
```

### 4.2 字段说明

- `id`: response 全局唯一 ID。
- `object`: 固定为 `"response"`。
- `status`: 响应状态。成功完成时为 `"completed"`。
- `output`: 输出 item 数组。
- `output_text`: 文本输出的聚合结果，便于直接消费。
- `metadata`: 扩展元数据。
- `metadata.session_id`: 响应所属会话 ID。

## 5. 输出 Item 结构

### 5.1 assistant message 示例

```json
{
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "output_text",
      "text": "你好，我是一个 AI 助手。"
    }
  ]
}
```

字段说明：

- `type`: item 类型。普通回答使用 `"message"`。
- `role`: 输出角色。助手输出固定为 `"assistant"`。
- `content`: 输出内容分片数组。

### 5.2 output_text part 示例

```json
{
  "type": "output_text",
  "text": "你好，我是一个 AI 助手。"
}
```

字段说明：

- `type`: 输出内容类型。文本输出使用 `"output_text"`。
- `text`: 当前完整文本内容。

## 6. 流式输出事件

当请求中的 `stream` 为 `true` 时，助手侧通过一系列 `response.*` 事件持续输出。

### 6.1 response.created

表示响应已创建，客户端可以用它初始化 response 状态。

```json
{
  "type": "response.created",
  "response": {
    "id": "resp_123",
    "object": "response",
    "status": "in_progress",
    "metadata": {
      "session_id": "sess_123456"
    }
  }
}
```

字段说明：

- `type`: 固定为 `"response.created"`。
- `response`: 顶层 response 对象的初始快照。
- `response.id`: response ID。
- `response.object`: 固定为 `"response"`。
- `response.status`: 初始状态，通常为 `"in_progress"`。
- `response.metadata.session_id`: 会话 ID。

### 6.2 response.output_text.delta

表示一段文本增量。

```json
{
  "type": "response.output_text.delta",
  "response_id": "resp_123",
  "delta": "你好，"
}
```

字段说明：

- `type`: 固定为 `"response.output_text.delta"`。
- `response_id`: 所属 response ID。
- `delta`: 本次新增的文本片段。

### 6.3 response.output_text.done

表示文本输出已完成。

```json
{
  "type": "response.output_text.done",
  "response_id": "resp_123",
  "text": "你好，我是一个 AI 助手。"
}
```

字段说明：

- `type`: 固定为 `"response.output_text.done"`。
- `response_id`: 所属 response ID。
- `text`: 最终完整文本。

### 6.4 response.completed

表示整个流式响应已经完成。

```json
{
  "type": "response.completed",
  "response": {
    "id": "resp_123",
    "object": "response",
    "status": "completed",
    "output": [
      {
        "type": "message",
        "role": "assistant",
        "content": [
          {
            "type": "output_text",
            "text": "你好，我是一个 AI 助手。"
          }
        ]
      }
    ],
    "output_text": "你好，我是一个 AI 助手。",
    "metadata": {
      "session_id": "sess_123456"
    }
  }
}
```

字段说明：

- `type`: 固定为 `"response.completed"`。
- `response`: 完整的最终 response 对象。
- `response.status`: 固定为 `"completed"`。
- `response.output`: 最终输出数组。
- `response.output_text`: 最终文本。
- `response.metadata.session_id`: 所属会话 ID。

### 6.5 response.failed

表示响应失败。

```json
{
  "type": "response.failed",
  "response": {
    "id": "resp_123",
    "object": "response",
    "status": "failed",
    "error": {
      "code": "model_error",
      "message": "Upstream model provider failed"
    },
    "metadata": {
      "session_id": "sess_123456"
    }
  }
}
```

字段说明：

- `type`: 固定为 `"response.failed"`。
- `response.status`: 固定为 `"failed"`。
- `response.error`: 失败信息。
- `response.error.code`: 错误码。
- `response.error.message`: 错误描述。
- `response.metadata.session_id`: 所属会话 ID。

## 7. 完整交互示例

### 7.1 一问一答

请求：

```json
{
  "model": "your-model",
  "stream": false,
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "你好，介绍一下你自己"
        }
      ]
    }
  ],
  "metadata": {
    "session_id": "sess_123456"
  }
}
```

响应：

```json
{
  "id": "resp_123",
  "object": "response",
  "status": "completed",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "你好，我是一个 AI 助手。"
        }
      ]
    }
  ],
  "output_text": "你好，我是一个 AI 助手。",
  "metadata": {
    "session_id": "sess_123456"
  }
}
```

### 7.2 一问一答（流式）

请求：

```json
{
  "model": "your-model",
  "stream": true,
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "你好，介绍一下你自己"
        }
      ]
    }
  ],
  "metadata": {
    "session_id": "sess_123456"
  }
}
```

响应事件流：

```json
{"type":"response.created","response":{"id":"resp_123","object":"response","status":"in_progress","metadata":{"session_id":"sess_123456"}}}
{"type":"response.output_text.delta","response_id":"resp_123","delta":"你好，"}
{"type":"response.output_text.delta","response_id":"resp_123","delta":"我是一个 AI 助手。"}
{"type":"response.output_text.done","response_id":"resp_123","text":"你好，我是一个 AI 助手。"}
{"type":"response.completed","response":{"id":"resp_123","object":"response","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"你好，我是一个 AI 助手。"}]}],"output_text":"你好，我是一个 AI 助手。","metadata":{"session_id":"sess_123456"}}}
```

## 8. `/ws/chat` 路由约束

- 用户输入请求必须携带 `metadata.session_id`。
- 助手输出事件应尽量在 `response.created` 或 `response.completed.response.metadata` 中携带 `session_id`。
- 对于中间流式事件，如果没有重复带 `metadata.session_id`，网关会基于 `response_id` 关联到已知会话。
- 不再支持旧的 `MESSAGE / headers / data` 包装作为标准协议格式。
