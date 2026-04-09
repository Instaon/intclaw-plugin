# WebSocket Protocol Refactor Bugfix Design

## Overview

当前WebSocket协议实现使用了旧的envelope包装格式(`{type:"MESSAGE", headers:{messageId,topic}, data:"..."}`)，与open-responses.md规范定义的标准JSON对象格式不一致。这导致协议解析失败，无法正确处理接收的请求和发送的响应事件。

本修复将重构协议处理逻辑，使其完全遵循open-responses.md规范：
- **接收方向**: 直接解析标准request对象 (`{model, stream, input, metadata}`)
- **发送方向**: 直接发送标准response.*事件对象，不包装envelope层
- **会话路由**: 统一使用 `metadata.session_id` 进行会话标识

修复策略采用最小化变更原则，仅修改协议解析和序列化逻辑，保持现有的SDK dispatcher、连接管理、心跳机制等核心功能不变。

## Glossary

- **Bug_Condition (C)**: 协议格式不匹配 - 当前实现期望/生成envelope包装格式，而规范要求直接传输标准JSON对象
- **Property (P)**: 协议兼容性 - 系统应能正确解析标准request对象并发送标准response.*事件
- **Preservation**: 现有功能保持不变 - SDK dispatcher回调处理、连接生命周期管理、并发控制、超时处理、日志记录等
- **parseRequest**: `protocol.ts`中的函数，负责解析接收到的WebSocket消息为RequestContent对象
- **createEnvelope**: `protocol.ts`中的函数，负责将事件对象包装为WebSocket envelope格式
- **RequestContent**: 解析后的请求内容类型，包含用户消息和元数据
- **OpenResponsesEvent**: 响应事件的联合类型，包括response.created、response.output_text.delta等
- **session_id**: 会话标识符，用于路由和关联请求响应，位于request.metadata.session_id

## Bug Details

### Bug Condition

协议格式不匹配发生在以下场景：

1. **接收用户请求时**: `parseRequest`函数期望解析envelope格式 (`{type:"MESSAGE", headers:{messageId,topic}, data:'{"content":"..."}'}`)，但服务器发送的是标准request对象 (`{model, stream, input, metadata}`)
2. **发送响应事件时**: `createEnvelope`函数将事件包装为envelope格式发送，但服务器期望接收标准response.*事件对象
3. **提取用户消息时**: 系统从`envelope.data.content`提取消息，而应从`request.input[0].content[0].text`提取
4. **会话标识时**: 系统从`envelope.headers.messageId`获取标识，而应从`request.metadata.session_id`获取

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type WebSocketMessage (string)
  OUTPUT: boolean
  
  RETURN (
    // 接收方向: 服务器发送标准request对象，但系统期望envelope格式
    (isInboundMessage(input) AND isStandardRequestFormat(input) AND NOT isEnvelopeFormat(input))
    OR
    // 发送方向: 系统发送envelope包装的事件，但服务器期望标准事件对象
    (isOutboundMessage(input) AND isEnvelopeFormat(input) AND NOT isStandardEventFormat(input))
  )
  WHERE
    isStandardRequestFormat(msg) := msg contains {model, stream, input, metadata}
    isEnvelopeFormat(msg) := msg contains {type:"MESSAGE", headers, data}
    isStandardEventFormat(msg) := msg contains {type:"response.*", response_id, ...}
END FUNCTION
```

### Examples

**Example 1: 接收标准request对象失败**
- **Input**: `{"model":"gpt-4","stream":true,"input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"你好"}]}],"metadata":{"session_id":"sess_123"}}`
- **Expected**: 成功解析为RequestContent，提取text="你好"，session_id="sess_123"
- **Actual**: `parseRequest`抛出异常 "Invalid envelope: missing or invalid headers field"

**Example 2: 发送envelope包装的事件被拒绝**
- **Input**: SDK生成response.output_text.delta事件
- **Expected**: 直接发送 `{"type":"response.output_text.delta","response_id":"resp_123","delta":"你好"}`
- **Actual**: 发送 `{"type":"MESSAGE","headers":{"messageId":"msg_123","topic":"/v1.0/im/bot/messages"},"data":"{\"type\":\"response.output_text.delta\",\"response_id\":\"resp_123\",\"delta\":\"你好\"}"}`，服务器无法识别

**Example 3: 流式响应事件类型不匹配**
- **Input**: SDK完成响应生成
- **Expected**: 发送事件序列 `response.created` → `response.output_text.delta` → `response.output_text.done` → `response.completed`
- **Actual**: 发送事件序列 `response.in_progress` → `response.output_item.added` → `response.output_text.delta` → `response.content_part.done` → `response.completed`

**Example 4: 非流式响应格式不匹配**
- **Input**: 请求 `stream=false`
- **Expected**: 直接发送完整response对象 `{"id":"resp_123","object":"response","status":"completed","output":[...],"output_text":"...","metadata":{"session_id":"sess_123"}}`
- **Actual**: 仍然发送流式事件序列（系统未实现非流式模式）

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- SDK dispatcher的callback处理机制必须继续正常工作（chunk、completion、error信号）
- WebSocket连接生命周期管理（连接、断开、重连、心跳）必须保持不变
- 并发请求控制和上下文映射必须继续维护
- 超时处理机制（14秒超时、AbortController取消）必须继续工作
- 日志记录和诊断信息输出必须保持不变
- 响应ID和item ID的唯一标识符生成机制必须保持不变

**Scope:**
所有不涉及协议格式解析和序列化的功能应完全不受影响。这包括：
- SDK dispatcher的内部状态管理（contexts Map、status tracking）
- 连接管理器的事件监听器和状态机
- 心跳机制的ping/pong处理
- 重连策略的指数退避算法
- 错误隔离和恢复机制

## Hypothesized Root Cause

基于bug描述和代码分析，最可能的根本原因是：

1. **协议版本不一致**: 代码实现基于旧版协议规范（使用envelope包装），而服务器已升级到新版协议（直接传输标准对象）。open-responses.md文档明确指出"不再支持旧的 MESSAGE / headers / data 包装作为标准协议格式"。

2. **解析逻辑错误**: `parseRequest`函数在`protocol.ts:72-110`中硬编码了envelope格式解析：
   ```typescript
   const envelope = JSON.parse(rawMessage) as WebSocketEnvelope;
   if (envelope.type !== 'MESSAGE') { throw ... }
   const payload = JSON.parse(envelope.data) as InboundMessageContent;
   ```
   这导致无法处理直接发送的标准request对象。

3. **序列化逻辑错误**: `createEnvelope`函数在`protocol.ts:154-171`中将所有事件包装为envelope格式：
   ```typescript
   const envelope: WebSocketEnvelope = {
     type: 'MESSAGE',
     headers: { messageId, topic },
     data: JSON.stringify(event),
   };
   ```
   这导致服务器收到的是包装后的格式而非标准事件对象。

4. **事件类型映射错误**: 当前实现使用的事件类型（如`response.in_progress`、`response.output_item.added`）与open-responses.md规范定义的事件类型（如`response.created`、`response.output_text.delta`）不完全一致。

5. **缺少非流式模式支持**: 系统未实现`stream=false`时的完整response对象发送逻辑，始终使用流式事件序列。

## Correctness Properties

Property 1: Bug Condition - Protocol Format Compatibility

_For any_ WebSocket message where the bug condition holds (服务器发送标准request对象或期望接收标准response.*事件), the fixed protocol handler SHALL correctly parse standard request objects extracting user text from `input[0].content[0].text` and session_id from `metadata.session_id`, and SHALL directly send standard response.* event objects without envelope wrapping.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation - Non-Protocol Functionality

_For any_ functionality that does NOT involve protocol format parsing or serialization (SDK dispatcher callbacks, connection lifecycle, heartbeat, timeout, logging), the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing mechanisms for request handling, error recovery, and resource management.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

假设我们的根本原因分析是正确的，需要进行以下修改：

**File**: `protocol.ts`

**Function**: `parseRequest` (lines 72-110)

**Specific Changes**:
1. **移除envelope解析层**: 直接解析rawMessage为标准request对象，不再期望envelope包装
   - 删除 `const envelope = JSON.parse(rawMessage) as WebSocketEnvelope`
   - 删除 envelope.type、envelope.headers、envelope.data 的验证逻辑
   - 直接解析 `const request = JSON.parse(rawMessage)` 为标准request格式

2. **更新字段提取逻辑**: 从标准request对象中提取必要信息
   - 从 `request.input[0].content[0].text` 提取用户消息文本（而非 `payload.content`）
   - 从 `request.metadata.session_id` 提取会话标识（而非 `envelope.headers.messageId`）
   - 保留 `request.model`、`request.stream` 等字段用于后续处理

3. **生成兼容的RequestContent**: 返回包含必要字段的RequestContent对象
   - `content`: 从input数组提取的用户文本
   - `messageId`: 生成或从metadata提取的消息标识
   - `sessionId`: 从metadata.session_id提取的会话标识
   - `stream`: 从request.stream提取的流式标志

4. **增强错误处理**: 验证标准request对象的必需字段
   - 验证 `request.input` 数组存在且非空
   - 验证 `request.input[0].content[0].text` 存在
   - 验证 `request.metadata.session_id` 存在

**File**: `protocol.ts`

**Function**: `createEnvelope` (lines 154-171)

**Specific Changes**:
1. **移除envelope包装**: 直接返回事件对象的JSON字符串，不再包装envelope层
   - 删除 envelope 对象的构造逻辑
   - 直接返回 `JSON.stringify(event)`
   - 移除 topic 参数（不再需要）

2. **简化函数签名**: 由于不再需要topic参数，简化为 `createEnvelope(event: OpenResponsesEvent): string`

3. **更新调用点**: 所有调用 `createEnvelope` 的地方需要移除 topic 参数

**File**: `protocol.ts`

**Function**: Event creation helpers (lines 178-260)

**Specific Changes**:
1. **更新事件类型名称**: 确保事件类型与open-responses.md规范一致
   - `response.in_progress` → `response.created` (如果规范要求)
   - 验证其他事件类型名称是否需要调整

2. **调整事件结构**: 确保事件对象结构符合规范
   - `response.created` 应包含完整的response初始快照
   - `response.output_text.delta` 应只包含 `{type, response_id, delta}`
   - `response.output_text.done` 应包含完整文本
   - `response.completed` 应包含最终response对象

3. **添加非流式模式支持**: 实现 `createCompleteResponse` 函数
   - 当 `stream=false` 时，生成完整response对象
   - 包含 `{id, object:"response", status:"completed", output, output_text, metadata}`

**File**: `sdk-dispatcher.ts`

**Function**: `dispatchRequest` (lines 180-260)

**Specific Changes**:
1. **传递stream标志**: 从解析后的request中提取stream标志并传递给后续处理
   - 在RequestContext中添加 `stream: boolean` 字段
   - 根据stream标志决定使用流式或非流式响应模式

2. **传递session_id**: 从request.metadata.session_id提取会话标识并存储在context中
   - 在RequestContext中添加 `sessionId: string` 字段
   - 在生成响应事件时将session_id包含在metadata中

**File**: `sdk-dispatcher.ts`

**Function**: `handleCompletion` (lines 1000-1050)

**Specific Changes**:
1. **支持非流式模式**: 当 `context.stream === false` 时，生成完整response对象而非事件序列
   - 调用新的 `generateCompleteResponse` 方法
   - 跳过流式事件生成逻辑

2. **在事件中包含session_id**: 确保所有生成的事件在metadata中包含session_id
   - 修改事件创建函数以接受sessionId参数
   - 在response.created和response.completed事件中包含metadata.session_id

**File**: `types.ts`

**Function**: Type definitions

**Specific Changes**:
1. **更新RequestContent类型**: 添加新字段以支持标准request格式
   ```typescript
   export interface RequestContent {
     content: string;        // 提取的用户文本
     messageId: string;      // 消息标识
     sessionId: string;      // 会话标识
     stream: boolean;        // 流式标志
     model?: string;         // 模型标识
   }
   ```

2. **更新RequestContext类型**: 添加stream和sessionId字段
   ```typescript
   export interface RequestContext {
     // ... existing fields
     stream: boolean;        // 流式标志
     sessionId: string;      // 会话标识
   }
   ```

## Testing Strategy

### Validation Approach

测试策略遵循两阶段方法：首先在未修复的代码上运行探索性测试以暴露bug的具体表现，然后验证修复后的代码能正确处理标准协议格式并保持现有功能不变。

### Exploratory Bug Condition Checking

**Goal**: 在实施修复之前，在未修复的代码上运行测试以暴露bug的具体表现。确认或反驳根本原因分析。如果反驳，需要重新假设根本原因。

**Test Plan**: 编写测试用例模拟服务器发送标准request对象和期望接收标准response.*事件的场景。在未修复的代码上运行这些测试，观察失败模式并理解根本原因。

**Test Cases**:
1. **Standard Request Parsing Test**: 发送标准request对象给parseRequest函数（未修复代码将失败）
   - Input: `{"model":"gpt-4","stream":true,"input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"你好"}]}],"metadata":{"session_id":"sess_123"}}`
   - Expected failure: 抛出 "Invalid envelope: missing or invalid headers field" 异常
   - Root cause confirmation: parseRequest期望envelope格式

2. **Standard Event Sending Test**: 验证createEnvelope是否包装事件对象（未修复代码将失败）
   - Input: `createEnvelope({type:"response.output_text.delta",response_id:"resp_123",delta:"你好"})`
   - Expected failure: 返回包装后的envelope格式而非标准事件对象
   - Root cause confirmation: createEnvelope添加了不必要的包装层

3. **Session ID Extraction Test**: 验证从标准request中提取session_id（未修复代码将失败）
   - Input: 标准request对象包含metadata.session_id
   - Expected failure: 无法提取session_id或从错误位置提取
   - Root cause confirmation: 代码期望从envelope.headers.messageId提取

4. **Non-Streaming Mode Test**: 验证stream=false时的响应格式（未修复代码可能失败）
   - Input: request with stream=false
   - Expected failure: 仍然发送流式事件序列而非完整response对象
   - Root cause confirmation: 缺少非流式模式实现

**Expected Counterexamples**:
- parseRequest无法解析标准request对象，抛出envelope相关异常
- createEnvelope返回包装后的格式，包含不必要的MESSAGE/headers/data层
- 无法从request.metadata.session_id提取会话标识
- 可能的原因：协议版本不一致、解析逻辑硬编码envelope格式、序列化逻辑添加包装层

### Fix Checking

**Goal**: 验证对于所有满足bug条件的输入（标准协议格式），修复后的函数能产生预期行为。

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  IF isInboundMessage(input) THEN
    result := parseRequest_fixed(input)
    ASSERT result.content = extractTextFromStandardRequest(input)
    ASSERT result.sessionId = extractSessionIdFromStandardRequest(input)
    ASSERT result.stream = extractStreamFlagFromStandardRequest(input)
  END IF
  
  IF isOutboundMessage(input) THEN
    result := createEnvelope_fixed(input)
    ASSERT result = JSON.stringify(input)  // 直接序列化，无包装
    ASSERT NOT containsEnvelopeWrapper(result)
  END IF
END FOR
```

### Preservation Checking

**Goal**: 验证对于所有不满足bug条件的输入（非协议格式相关的功能），修复后的函数产生与原函数相同的结果。

**Pseudocode:**
```
FOR ALL functionality WHERE NOT isProtocolFormatRelated(functionality) DO
  ASSERT behavior_original(functionality) = behavior_fixed(functionality)
END FOR

WHERE isProtocolFormatRelated includes:
  - parseRequest function
  - createEnvelope function
  - Event creation helpers (if structure changes)
  
WHERE NOT isProtocolFormatRelated includes:
  - SDK dispatcher callback handling
  - Connection lifecycle management
  - Heartbeat mechanism
  - Timeout handling
  - Concurrent request control
  - Error isolation and recovery
  - Logging and diagnostics
```

**Testing Approach**: 属性测试（Property-based testing）强烈推荐用于保持性检查，因为：
- 它能自动生成大量测试用例覆盖输入域
- 它能捕获手动单元测试可能遗漏的边缘情况
- 它提供强有力的保证：对于所有非bug输入，行为保持不变

**Test Plan**: 首先在未修复的代码上观察非协议相关功能的行为，然后编写属性测试捕获这些行为。

**Test Cases**:
1. **SDK Callback Preservation**: 验证callback处理（chunk、completion、error）在修复后继续正常工作
   - 观察未修复代码的callback调用模式
   - 编写属性测试验证修复后callback行为一致

2. **Connection Lifecycle Preservation**: 验证连接管理（连接、断开、重连）在修复后保持不变
   - 观察未修复代码的连接状态转换
   - 编写属性测试验证修复后状态机行为一致

3. **Timeout Handling Preservation**: 验证超时处理机制在修复后继续工作
   - 观察未修复代码的超时触发和清理
   - 编写属性测试验证修复后超时行为一致

4. **Concurrent Request Preservation**: 验证并发控制在修复后保持不变
   - 观察未修复代码的并发限制和上下文管理
   - 编写属性测试验证修复后并发行为一致

### Unit Tests

- 测试parseRequest能正确解析标准request对象的各种变体
- 测试从input数组提取用户文本的边缘情况（空数组、多个消息、多个content part）
- 测试从metadata提取session_id的边缘情况（缺失、空字符串、无效格式）
- 测试createEnvelope直接序列化事件对象，不添加包装层
- 测试流式和非流式模式的响应生成逻辑
- 测试事件类型名称与open-responses.md规范的一致性

### Property-Based Tests

- 生成随机标准request对象，验证parseRequest能正确提取所有必需字段
- 生成随机response.*事件对象，验证createEnvelope直接序列化不添加包装
- 生成随机SDK callback调用序列，验证修复后dispatcher行为与原始行为一致
- 生成随机连接状态转换序列，验证修复后连接管理行为与原始行为一致
- 测试大量并发请求场景，验证修复后并发控制和资源管理保持不变

### Integration Tests

- 测试完整的请求-响应流程：接收标准request → SDK处理 → 发送标准response.*事件
- 测试流式响应的完整事件序列：response.created → delta → done → completed
- 测试非流式响应的完整对象发送
- 测试会话路由：验证session_id在整个流程中正确传递和使用
- 测试错误场景：无效request格式、SDK错误、超时等
- 测试与真实WebSocket服务器的集成（如果可用）
