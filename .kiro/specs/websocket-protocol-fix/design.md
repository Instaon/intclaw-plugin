# WebSocket Protocol Fix Bugfix Design

## Overview

当前 WebSocket 协议实现存在根本性的架构问题：插件错误地将自己定位为主动发送方，而实际上应该作为被请求端（服务器向插件发起请求）。这导致协议方向理解错误、消息封装格式不符合规范，以及缺少统一的协议解析模块。

本次修复将：
1. 创建统一的协议解析模块（protocol.ts），封装所有 WebSocket Envelope 和 Open Responses 事件的处理逻辑
2. 明确插件作为被请求端的角色定位，正确处理服务器发来的请求
3. 确保所有消息的 data 字段都正确序列化为 JSON 字符串
4. 重构消息流向：服务器发送请求 → 插件接收并解析 → 插件生成响应事件序列 → 插件发送响应

## Glossary

- **Bug_Condition (C)**: 当前代码将插件作为主动发送方处理，而不是作为响应服务器请求的被请求端
- **Property (P)**: 插件应作为被请求端，接收服务器请求并生成 Open Responses 事件序列作为响应
- **Preservation**: 现有的 WebSocket 连接管理、心跳机制、重连逻辑、事件解析功能必须保持不变
- **WebSocket Envelope**: 对称协议的外层封装格式，包含 type、headers、data 三个字段
- **Open Responses Event**: 嵌套在 Envelope.data 中的事件对象，包含 type、event_id、response_id 等字段
- **Protocol Module**: 统一的协议解析模块（protocol.ts），负责所有协议相关的序列化和反序列化操作
- **Request-Response Pattern**: 服务器作为主动方发送请求，插件作为被请求端接收请求并返回响应事件序列

## Bug Details

### Bug Condition

Bug 在以下情况下触发：

1. 当插件发送消息时，系统将插件作为主动发送方处理，而不是作为响应服务器请求的被请求端
2. 当创建 WebSocket Envelope 时，系统可能未正确将 data 字段序列化为 JSON 字符串
3. 当处理协议逻辑时，系统在多个文件中分散处理，缺少统一的协议解析模块
4. 当接收服务器消息时，系统未明确区分"接收请求"和"发送响应"的角色定位

**Formal Specification:**
```
FUNCTION isBugCondition(codeState)
  INPUT: codeState of type CodeArchitecture
  OUTPUT: boolean
  
  RETURN (codeState.pluginRole == "active_sender" AND NOT "request_responder")
         OR (codeState.envelopeDataField NOT serialized_as_json_string)
         OR (codeState.protocolLogic == "scattered" AND NOT "unified_module")
         OR (codeState.messageFlow NOT follows_request_response_pattern)
END FUNCTION
```

### Examples

- **Example 1**: 在 channel.ts 的 sendTextMessage 函数中，插件直接调用 textToEventSequence 生成事件并发送，而不是响应服务器的请求
  - 预期行为：插件应该接收服务器的请求消息，解析后生成响应事件序列
  - 实际行为：插件主动生成事件序列并发送

- **Example 2**: 在 protocol.ts 的 createEnvelope 函数中，data 字段通过 JSON.stringify(event) 正确序列化
  - 预期行为：data 字段必须是 JSON 字符串
  - 实际行为：当前实现正确，但需要确保所有调用点都遵循此规范

- **Example 3**: 协议处理逻辑分散在 channel.ts、protocol.ts、connection.ts 三个文件中
  - 预期行为：所有协议相关的序列化、反序列化、验证逻辑应该集中在 protocol.ts 中
  - 实际行为：逻辑分散，难以维护和测试

- **Edge Case**: 当服务器发送格式错误的 Envelope 时，系统应该能够正确识别并报错
  - 预期行为：parseEnvelope 函数应该验证所有必需字段并抛出清晰的错误信息
  - 实际行为：当前 parseEnvelope 已经实现了验证逻辑，需要保持

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- WebSocket 连接建立时使用正确的认证头（x-app-key, x-app-secret）必须继续工作
- 心跳机制（ping/pong）必须继续正常运行
- 重连逻辑（指数退避）必须继续正常工作
- parseEnvelope 函数解析有效消息的能力必须保持不变
- 事件 ID 和响应 ID 的生成逻辑必须保持唯一性
- response.output_text.delta 事件的文本累积逻辑必须保持不变
- response.completed 事件的响应完成处理必须保持不变

**Scope:**
所有不涉及协议方向理解和消息封装格式的功能都应该完全不受影响。这包括：
- WebSocket 连接生命周期管理（connect, disconnect, reconnect）
- 心跳和健康检查机制
- 日志记录和调试功能
- 配置管理和账户解析
- 错误处理和状态管理

## Hypothesized Root Cause

基于 bug 描述和代码分析，最可能的问题是：

1. **角色定位错误**: 插件将自己定位为主动发送方，而不是被请求端
   - channel.ts 中的 sendTextMessage 函数直接生成事件序列并发送
   - 缺少"接收服务器请求"的处理逻辑
   - 没有明确的请求-响应映射关系

2. **协议逻辑分散**: 协议处理逻辑分散在多个文件中
   - protocol.ts 包含部分序列化逻辑
   - channel.ts 包含发送逻辑
   - connection.ts 包含接收逻辑
   - 缺少统一的协议处理入口

3. **消息流向混乱**: 当前实现没有清晰的消息流向
   - 缺少"服务器请求 → 插件响应"的明确流程
   - sendTextMessage 看起来像是插件主动发送，而不是响应请求

4. **缺少请求解析**: 没有专门的函数来解析服务器发来的请求消息
   - connection.ts 中的 handleMessage 直接处理 Open Responses 事件
   - 缺少"请求消息"和"响应事件"的区分

## Correctness Properties

Property 1: Bug Condition - 插件作为被请求端正确处理请求-响应流程

_For any_ 服务器发送的请求消息（封装在 WebSocket Envelope 中），修复后的插件 SHALL 正确解析请求、生成对应的 Open Responses 事件序列（response.in_progress → response.output_item.added → response.output_text.delta → response.completed），并将每个事件独立封装在 WebSocket Envelope 中发送回服务器。

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - 现有协议解析和连接管理功能保持不变

_For any_ 不涉及协议方向理解和消息封装格式的功能（WebSocket 连接管理、心跳机制、重连逻辑、事件解析），修复后的代码 SHALL 产生与原始代码完全相同的行为，保持所有现有功能的正确性。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

假设我们的根因分析是正确的：

**File**: `protocol.ts`

**Function**: 新增统一的协议解析模块

**Specific Changes**:
1. **保持现有函数**: parseEnvelope、createEnvelope、textToEventSequence 等函数已经正确实现，保持不变
   - parseEnvelope 正确验证 Envelope 结构并提取事件
   - createEnvelope 正确将事件序列化为 JSON 字符串并封装
   - textToEventSequence 正确生成事件序列

2. **新增请求解析函数**: 添加 parseRequest 函数来解析服务器发来的请求消息
   - 解析 Envelope 中的 data 字段
   - 提取请求内容（如用户消息文本）
   - 返回结构化的请求对象

3. **新增响应生成函数**: 添加 generateResponseSequence 函数来生成响应事件序列
   - 接收请求对象和响应内容
   - 生成完整的 Open Responses 事件序列
   - 确保每个事件都有正确的 response_id 和 event_id

4. **文档化协议流程**: 在 protocol.ts 顶部添加详细的协议流程说明
   - 说明插件作为被请求端的角色
   - 说明请求-响应的完整流程
   - 说明 Envelope 封装和解析的规范

**File**: `connection.ts`

**Function**: `handleMessage` 和 `monitorInstaClawProvider`

**Specific Changes**:
1. **重构 handleMessage**: 修改消息处理逻辑以支持请求-响应模式
   - 识别服务器发来的请求消息
   - 调用 protocol.ts 中的 parseRequest 解析请求
   - 生成响应内容（可能需要调用 AI 模型或其他服务）
   - 调用 protocol.ts 中的 generateResponseSequence 生成响应事件
   - 通过 WebSocket 发送响应事件序列

2. **保持事件处理逻辑**: 现有的 Open Responses 事件处理逻辑（response.in_progress、response.output_item.added 等）保持不变
   - 这些事件可能是服务器发来的，也可能是插件自己生成的
   - 保持现有的状态管理和文本累积逻辑

**File**: `channel.ts`

**Function**: `sendTextMessage`

**Specific Changes**:
1. **明确函数用途**: 重命名或添加注释说明此函数用于响应服务器请求，而不是主动发送
   - 添加 JSDoc 注释说明这是响应函数
   - 可能需要重命名为 respondToRequest 或类似名称

2. **简化调用链**: 直接使用 protocol.ts 中的统一函数
   - 移除重复的协议处理逻辑
   - 确保所有协议操作都通过 protocol.ts 进行

3. **保持 WebSocket 发送逻辑**: 实际的 WebSocket 发送操作保持不变
   - 继续使用 activeConnections 管理连接
   - 继续验证连接状态
   - 继续记录日志

**File**: `types.ts`

**Function**: 类型定义

**Specific Changes**:
1. **新增请求类型**: 添加 Request 相关的类型定义
   - RequestEnvelope: 服务器发来的请求消息格式
   - RequestContent: 请求内容结构
   - ResponseContext: 响应上下文（包含 request_id 等）

2. **保持现有类型**: 所有现有的类型定义保持不变
   - WebSocketEnvelope
   - OpenResponsesEvent 及其子类型
   - Response、Item、ContentPart

## Testing Strategy

### Validation Approach

测试策略遵循两阶段方法：首先在未修复的代码上暴露反例以演示 bug，然后验证修复后的代码正确工作并保持现有行为。

### Exploratory Bug Condition Checking

**Goal**: 在实施修复之前，在未修复的代码上暴露反例以演示 bug。确认或反驳根因分析。如果反驳，需要重新假设。

**Test Plan**: 编写测试来模拟服务器发送请求消息的场景，并断言插件能够正确识别这是一个请求（而不是响应事件）。在未修复的代码上运行这些测试，观察失败并理解根因。

**Test Cases**:
1. **请求识别测试**: 模拟服务器发送请求消息，验证插件能否识别这是请求（在未修复代码上将失败）
2. **角色定位测试**: 验证插件是否将自己定位为被请求端而不是主动发送方（在未修复代码上将失败）
3. **协议流程测试**: 验证完整的请求-响应流程是否正确实现（在未修复代码上将失败）
4. **Envelope 格式测试**: 验证所有发送的消息的 data 字段都是 JSON 字符串（在未修复代码上可能通过）

**Expected Counterexamples**:
- 插件无法识别服务器发来的请求消息，将其误认为响应事件
- 插件主动生成事件序列而不是响应请求
- 可能的原因：缺少请求解析逻辑、角色定位错误、协议流程不清晰

### Fix Checking

**Goal**: 验证对于所有满足 bug 条件的输入，修复后的函数产生预期行为。

**Pseudocode:**
```
FOR ALL serverRequest WHERE isBugCondition(serverRequest) DO
  pluginResponse := handleRequest_fixed(serverRequest)
  ASSERT pluginResponse.isValidResponseSequence()
  ASSERT pluginResponse.allEventsWrappedInEnvelope()
  ASSERT pluginResponse.dataFieldsAreJsonStrings()
END FOR
```

### Preservation Checking

**Goal**: 验证对于所有不满足 bug 条件的输入，修复后的函数产生与原始函数相同的结果。

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT handleMessage_original(input) = handleMessage_fixed(input)
END FOR
```

**Testing Approach**: 推荐使用基于属性的测试进行保留检查，因为：
- 它自动生成跨输入域的许多测试用例
- 它捕获手动单元测试可能遗漏的边缘情况
- 它为所有非 bug 输入提供强有力的保证，确保行为不变

**Test Plan**: 首先在未修复的代码上观察非请求消息（如响应事件）的行为，然后编写基于属性的测试来捕获该行为。

**Test Cases**:
1. **连接管理保留**: 观察未修复代码上的连接建立、断开、重连行为正常工作，然后编写测试验证修复后继续工作
2. **心跳机制保留**: 观察未修复代码上的 ping/pong 机制正常工作，然后编写测试验证修复后继续工作
3. **事件解析保留**: 观察未修复代码上的 parseEnvelope 正确解析有效消息，然后编写测试验证修复后继续工作
4. **状态管理保留**: 观察未修复代码上的响应状态管理正常工作，然后编写测试验证修复后继续工作

### Unit Tests

- 测试 parseRequest 函数能够正确解析各种格式的请求消息
- 测试 generateResponseSequence 函数生成正确的事件序列
- 测试 createEnvelope 确保 data 字段始终是 JSON 字符串
- 测试边缘情况（空消息、格式错误的消息、缺少字段的消息）

### Property-Based Tests

- 生成随机的服务器请求消息，验证插件能够正确解析并生成响应
- 生成随机的响应内容，验证生成的事件序列符合 Open Responses 规范
- 生成随机的 WebSocket 连接状态，验证保留的功能在所有状态下都正常工作

### Integration Tests

- 测试完整的请求-响应流程：服务器发送请求 → 插件接收 → 插件生成响应 → 插件发送响应
- 测试多个请求的并发处理
- 测试在连接断开和重连过程中的请求处理
- 测试与现有 OpenClaw SDK 的集成
