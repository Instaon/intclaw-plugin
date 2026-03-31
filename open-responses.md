- 传输方式：服务端与插件之间通过 WebSocket 进行双向异步通信。事件语义遵循 Open Responses 规范。
- 事件粒度：所有流式行为都映射为“语义事件”，而不是原始 token/字节片段，例如 `response.in_progress`、`response.output_text.delta` 等。
- 终止信号：当整个响应生命周期结束后，服务端应发送最终状态事件（如 `response.completed` / `response.failed`）。

***

## 2. 顶层 Response 对象（静态模型）

服务器内部可以维护一个顶层 Response 状态对象，事件都是对其的增量变更。一个典型结构示例（伪 JSON Schema）： [community.openai](https://community.openai.com/t/open-responses-for-the-open-source-community/1371770)

```json
{
  "id": "resp_123",
  "status": "in_progress",
  "output": {
    "items": [
      {
        "id": "item_1",
        "type": "message",
        "status": "in_progress",
        "role": "assistant",
        "content": [
          {
            "type": "output_text",
            "status": "in_progress",
            "text": ""
          }
        ]
      }
    ]
  },
  "error": null,
  "metadata": {}
}
```

字段说明： [community.openai](https://community.openai.com/t/open-responses-for-the-open-source-community/1371770)
- `id`: Response 全局唯一 ID，由你的服务生成。  
- `status`: 响应整体状态，典型值：`"queued"`, `"in_progress"`, `"completed"`, `"failed"`, `"incomplete"`。  
- `output.items[]`: 输出条目列表，每个条目就是一个 Item（消息、工具调用、推理过程等）。  
- `error`: 失败时的错误信息。  
- `metadata`: 扩展字段，可放 trace id 等。

***

## 3. Item 对象结构

Item 是响应输出的基本单元，每个 Item 有自己独立的生命周期。 [jangwook](https://jangwook.net/zh/blog/zh/openai-open-responses-agentic-standard/)

```json
{
  "id": "item_1",
  "type": "message",
  "status": "in_progress",
  "role": "assistant",
  "content": [
    {
      "type": "output_text",
      "status": "in_progress",
      "text": ""
    }
  ]
}
```

公共字段： [openresponses](https://www.openresponses.org/specification)
- `id`: item 唯一 ID。  
- `type`:  
  - `"message"`：普通对话消息。  
  - `"function_call"`：工具调用。  
  - `"function_call_output"`：工具返回。  
  - `"reasoning"`：可选的可见推理内容。  
- `status`: `"in_progress"`, `"completed"`, `"incomplete"`, `"failed"` 等。  
- `content[]`: 内容分片列表（常见是 `output_text`）。

示例：`message` 类型。 [jangwook](https://jangwook.net/zh/blog/zh/openai-open-responses-agentic-standard/)

```json
{
  "id": "item_1",
  "type": "message",
  "role": "assistant",
  "status": "in_progress",
  "content": [
    {
      "type": "output_text",
      "status": "in_progress",
      "text": ""
    }
  ]
}
```

***

## 4. Content Part 结构

Content Part 是 Item 里的更细粒度结构，比如文本的一段。 [community.openai](https://community.openai.com/t/open-responses-for-the-open-source-community/1371770)

```json
{
  "type": "output_text",
  "status": "in_progress",
  "text": "",
  "annotations": [],
  "logprobs": null
}
```

字段说明： [openresponses](https://www.openresponses.org/specification)
- `type`: 对于模型输出常见为 `"output_text"`。  
- `status`: 典型值 `"in_progress"` / `"completed"`；用于在流式结束时标记本段内容已写完。  
- `text`: 当前累计文本。  
- `annotations` / `logprobs`: 可选元数据。

***

事件是你真正通过 WebSocket 推送给客户端的“消息”。为了保证协议对称性，每个事件都作为 `data` 字符串嵌套在标准的 WebSocket Envelope 中。

常用事件类别：

- 状态机事件（State events）  
  - `response.in_progress`  
  - `response.completed`  
  - `response.failed`  
- 结构变更事件（Structure events）  
  - `response.output_item.added`  
- 内容增量事件（Delta events）  
  - `response.output_text.delta`  
  - 可选：`response.content_part.done`（内容片段完成） [openresponses](https://www.openresponses.org/specification)

***

## 6. 事件字段定义

下面用“事件类型 + data JSON”的形式描述协议字段。所有事件的 `data` 都应至少包含 `response_id`，用于客户端关联。 [github](https://github.com/vinhnx/VTCode/blob/main/docs/protocols/OPEN_RESPONSES.md)

### 6.1 response.in_progress

表示 Response 从 `queued` 进入 `in_progress`。 [openresponses](https://www.openresponses.org/specification)

```json
{
  "type": "response.in_progress",
  "response_id": "resp_123",
  "status": "in_progress",
  "timestamp": "2026-03-25T08:00:00Z"
}
```

- `status`: 必须为 `"in_progress"`。  
- 触发时机：模型开始实际生成内容前或第一个 token 产生时。

### 6.2 response.output_item.added

表示一个新的 Item 被加入到输出中（比如开始生成一条 assistant 消息）。 [docs.openclaw](https://docs.openclaw.ai/experiments/plans/openresponses-gateway)

```json
{
  "type": "response.output_item.added",
  "response_id": "resp_123",
  "item": {
    "id": "item_1",
    "type": "message",
    "status": "in_progress",
    "role": "assistant",
    "content": [
      {
        "type": "output_text",
        "status": "in_progress",
        "text": ""
      }
    ]
  },
  "index": 0,
  "timestamp": "2026-03-25T08:00:01Z"
}
```

- `item`: 完整的 Item 初始结构。  
- `index`: 该 Item 在 `output.items` 中的位置。  
- 客户端应创建本地 Item 并加入列表。

### 6.3 response.output_text.delta

这是流式文本生成的核心事件，用来追加文本内容。 [docs.openclaw](https://docs.openclaw.ai/experiments/plans/openresponses-gateway)

```json
{
  "type": "response.output_text.delta",
  "response_id": "resp_123",
  "item_id": "item_1",
  "content_index": 0,
  "delta": {
    "text": "Hello, "
  },
  "timestamp": "2026-03-25T08:00:02Z"
}
```

字段说明： [docs.openclaw](https://docs.openclaw.ai/experiments/plans/openresponses-gateway)
- `item_id`: 要更新的 Item。  
- `content_index`: Item.content 数组里要更新的那个 part 下标。  
- `delta.text`: 增量文本（追加到现有 `text` 之后）。  

客户端更新逻辑等价于：

```ts
items[item_id].content[content_index].text += delta.text;
```

后续多次发送不同 `delta`，直到文本生成完成。 [openresponses](https://www.openresponses.org/specification)

### 6.4 response.content_part.done（可选）

可选：标记某个 content part 已完成，不再有新的 delta。 [openresponses](https://www.openresponses.org/specification)

```json
{
  "type": "response.content_part.done",
  "response_id": "resp_123",
  "item_id": "item_1",
  "content_index": 0,
  "status": "completed",
  "timestamp": "2026-03-25T08:00:03Z"
}
```

- `status`: 一般为 `"completed"`。  
- 客户端可将对应 content part 的状态更新为完成。

### 6.5 response.completed

表示整个 Response 已成功完成，不会再有新的 Items 或 delta。 [docs.openclaw](https://docs.openclaw.ai/experiments/plans/openresponses-gateway)

```json
{
  "type": "response.completed",
  "response_id": "resp_123",
  "status": "completed",
  "timestamp": "2026-03-25T08:00:04Z"
}
```

- 服务端应在发送该事件后适时关闭流。  
- 客户端将顶层 Response.status 更新为 `"completed"`。

### 6.6 response.failed

当响应过程中出现不可恢复错误时发送。 [openresponses](https://www.openresponses.org/specification)

```json
{
  "type": "response.failed",
  "response_id": "resp_123",
  "status": "failed",
  "error": {
    "code": "MODEL_ERROR",
    "message": "Upstream model provider failed",
    "details": null
  },
  "timestamp": "2026-03-25T08:00:05Z"
}
```

- `status`: `"failed"`。  
- `error`: 标准化错误对象。  
- 发送后应终结连接；客户端更新整体状态为失败。

***

## 7. WebSocket 传输封装示例

在 WebSocket 链路上，每一个 Open Responses 事件都需要按照**对称协议**进行封装。`data` 字段必须是事件对象的 JSON 字符串。

### 7.1 单个事件封装示例 (以 Delta 为例)

```json
{
  "type": "MESSAGE",
  "headers": {
    "messageId": "msg_001",
    "topic": "/v1.0/im/bot/messages"
  },
  "data": "{\"type\":\"response.output_text.delta\",\"response_id\":\"resp_123\",\"item_id\":\"item_1\",\"content_index\":0,\"delta\":{\"text\":\"Hello\"}}"
}
```

### 7.2 连续事件流示意

在一个完整的响应周期内，WebSocket 会连续推送多个此类 Envelope 包：

1.  **开始**：发送 `response.in_progress`。
2.  **结构**：发送 `response.output_item.added`。
3.  **内容**：连续发送多个 `response.output_text.delta`。
4.  **结束**：发送 `response.completed`。

这种方式确保了无论信标中承载的是什么业务逻辑，外层的路由和处理逻辑都是高度统一且对称的。

***

## 8. 推荐的状态机约束

为了保持行为与 Open Responses 生态兼容，建议遵守以下约束： [community.openai](https://community.openai.com/t/open-responses-for-the-open-source-community/1371770)

- 顶层 Response 状态流转：  
  - `queued` → `in_progress` → `completed`  
  - 或 `queued` / `in_progress` → `failed` / `incomplete`。  
- 若 Response 终态为 `"incomplete"`，最后一个 Item 也必须是 `"incomplete"`。  
- Item 状态流转同样遵循 `in_progress` → `completed` / `failed` / `incomplete`。  
- 所有 delta 类事件必须在对应对象的终态事件之前（如 `response.output_text.delta` 必须在 `response.content_part.done` 前）。  

***

## 9. 完整的一问一答交互示例

以下是严格按照协议的真实 JSON 数据包格式。

### 9.1 客户端发送（一问）
客户端发给服务端的 WebSocket JSON 数据：

```json
{
  "type": "MESSAGE",
  "headers": {
    "messageId": "msg_req_001",
    "topic": "/v1.0/im/user/messages"
  },
  "data": "{\"content\":\"你好呀\"}"
}
```

### 9.2 服务端返回（一答）
服务端通过 WebSocket 陆续吐出以下 5 个 JSON 数据帧：

**第 1 帧**：准备开始处理
```json
{
  "type": "MESSAGE",
  "headers": {
    "messageId": "msg_res_001",
    "topic": "/v1.0/im/bot/messages"
  },
  "data": "{\"type\":\"response.in_progress\",\"response_id\":\"resp_123\",\"status\":\"in_progress\",\"timestamp\":\"2026-03-31T10:00:00Z\"}"
}
```

**第 2 帧**：初始化消息结构
```json
{
  "type": "MESSAGE",
  "headers": {
    "messageId": "msg_res_002",
    "topic": "/v1.0/im/bot/messages"
  },
  "data": "{\"type\":\"response.output_item.added\",\"response_id\":\"resp_123\",\"item\":{\"id\":\"item_1\",\"type\":\"message\",\"status\":\"in_progress\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"status\":\"in_progress\",\"text\":\"\"}]},\"index\":0,\"timestamp\":\"2026-03-31T10:00:01Z\"}"
}
```

**第 3 帧**：增量返回文本 “你也”
```json
{
  "type": "MESSAGE",
  "headers": {
    "messageId": "msg_res_003",
    "topic": "/v1.0/im/bot/messages"
  },
  "data": "{\"type\":\"response.output_text.delta\",\"response_id\":\"resp_123\",\"item_id\":\"item_1\",\"content_index\":0,\"delta\":{\"text\":\"你也\"},\"timestamp\":\"2026-03-31T10:00:02Z\"}"
}
```

**第 4 帧**：增量返回文本 “好”
```json
{
  "type": "MESSAGE",
  "headers": {
    "messageId": "msg_res_004",
    "topic": "/v1.0/im/bot/messages"
  },
  "data": "{\"type\":\"response.output_text.delta\",\"response_id\":\"resp_123\",\"item_id\":\"item_1\",\"content_index\":0,\"delta\":{\"text\":\"好\"},\"timestamp\":\"2026-03-31T10:00:03Z\"}"
}
```

**第 5 帧**：结束本次响应
```json
{
  "type": "MESSAGE",
  "headers": {
    "messageId": "msg_res_005",
    "topic": "/v1.0/im/bot/messages"
  },
  "data": "{\"type\":\"response.completed\",\"response_id\":\"resp_123\",\"status\":\"completed\",\"timestamp\":\"2026-03-31T10:00:04Z\"}"
}
```
