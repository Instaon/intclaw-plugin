# Requirements Document

## Introduction

本文档定义了 InstaClaw Connector 插件的用户隔离功能需求。该功能实现 OpenClaw 官方推荐的 `per-channel-peer` 隔离模式,通过构造包含 `channelId + userId` 的会话标识符,确保同一 channel 中的不同用户拥有独立的 AI 对话上下文,不同用户之间的消息和状态完全隔离。

根据 OpenClaw 官方文档,Channel 插件负责 **Session grammar**,即 provider-specific conversation ids 如何映射到 base chats、thread ids、parent fallbacks。本插件通过在入站消息处理流程中提取 userId 和 channelId,构造符合 `per-channel-peer` 模式的会话标识符,实现用户维度的会话隔离。

## Glossary

- **User_ID**: 用户标识符,从平台入站消息中提取,用于唯一标识发送消息的用户
- **Channel_ID**: 频道标识符,从平台入站消息中提取,用于标识消息所属的频道或群组

- **Session_ID**: 会话标识符,由插件根据 channelId 和 userId 构造,格式为 `channel:{channelId}:user:{userId}`,用于在 SDK 层面隔离不同用户的对话历史
- **Inbound_Identity**: 入站身份对象,包含从平台消息中提取的 userId、channelId 等标识字段
- **Conversation_Identity**: 会话归属对象,包含 baseConversationId 等字段,用于 OpenClaw 会话路由
- **SDK_Dispatcher**: SDK 分发器,负责管理请求生命周期、调用 AI SDK 并生成响应事件
- **Channel_Runtime**: OpenClaw 插件运行时,提供 `reply.dispatchReplyWithBufferedBlockDispatcher` 方法用于 AI 推理
- **Session_Key**: SDK 会话键,传递给 Channel_Runtime 的 MsgContext.SessionKey 字段,用于在 SDK 层面隔离不同会话的对话历史
- **Protocol_Module**: 协议处理模块 (protocol.ts),负责解析 WebSocket 消息和生成 Open Responses 事件
- **Connection_Module**: 连接管理模块 (connection.ts),负责 WebSocket 连接生命周期和入站消息处理
- **Per_Channel_Peer**: OpenClaw 官方推荐的隔离模式,按"渠道 + 发送者"隔离,确保同一 channel 中不同用户不共享上下文

## Requirements

### Requirement 1: 入站消息身份提取

**User Story:** 作为系统开发者,我需要从平台入站消息中提取用户和频道标识,以便构造会话隔离所需的身份信息。

#### Acceptance Criteria

1. WHEN 服务器发送标准请求格式消息, THE Protocol_Module SHALL 从 `metadata.user_id` 字段提取 userId
2. WHEN 服务器发送标准请求格式消息, THE Protocol_Module SHALL 从 `metadata.channel_id` 字段提取 channelId
3. IF `metadata.user_id` 字段缺失或为空字符串, THEN THE Protocol_Module SHALL 抛出解析错误并记录详细诊断信息
4. IF `metadata.channel_id` 字段缺失或为空字符串, THEN THE Protocol_Module SHALL 抛出解析错误并记录详细诊断信息
5. THE Protocol_Module SHALL 将提取的 userId、channelId 存储在 RequestContent 对象中
6. THE Protocol_Module SHALL 验证 userId 和 channelId 为非空字符串类型

### Requirement 2: 会话标识符构造

**User Story:** 作为系统开发者,我需要根据 userId 和 channelId 构造会话标识符,以实现 per-channel-peer 隔离模式。

#### Acceptance Criteria

1. THE Protocol_Module SHALL 提供 buildSessionId 函数,接受 userId 和 channelId 参数
2. THE buildSessionId 函数 SHALL 返回格式为 `channel:{channelId}:user:{userId}` 的字符串
3. WHEN 同一 channelId 和 userId 的多个请求到达时, THE buildSessionId 函数 SHALL 返回相同的 sessionId
4. WHEN 不同 userId 但相同 channelId 的请求到达时, THE buildSessionId 函数 SHALL 返回不同的 sessionId
5. WHEN 相同 userId 但不同 channelId 的请求到达时, THE buildSessionId 函数 SHALL 返回不同的 sessionId
6. THE buildSessionId 函数 SHALL 对 userId 和 channelId 进行字符串转换,确保类型安全
7. THE Protocol_Module SHALL 在 parseRequest 函数中调用 buildSessionId 构造 sessionId

### Requirement 3: SDK 会话键生成与传递

**User Story:** 作为系统开发者,我需要为每个用户生成唯一的 SDK 会话键,以便 SDK 能够隔离不同用户的对话历史。

#### Acceptance Criteria

1. THE SDK_Dispatcher SHALL 根据 accountId 和 sessionId 生成 Session_Key
2. THE Session_Key 格式 SHALL 为 `instaclaw:{accountId}:{sessionId}`,其中 sessionId 包含 channelId 和userId
3. WHEN accountId 为空或未定义, THE SDK_Dispatcher SHALL 使用 `instaclaw:default:{sessionId}` 作为 Session_Key
4. THE SDK_Dispatcher SHALL 在调用 Channel_Runtime.reply.dispatchReplyWithBufferedBlockDispatcher 时传递 Session_Key
5. THE Session_Key SHALL 通过 MsgContext.SessionKey 字段传递给 SDK
6. WHEN 同一 channelId 和 userId 的多个请求到达时, THE SDK_Dispatcher SHALL 使用相同的 Session_Key
7. WHEN 不同 userId 的请求到达时, THE SDK_Dispatcher SHALL 使用不同的 Session_Key

### Requirement 4: Session ID 在请求上下文中传递

**User Story:** 作为系统开发者,我需要在整个请求处理流程中传递构造的 sessionId,以便所有组件都能访问会话标识符。

#### Acceptance Criteria

1. THE SDK_Dispatcher SHALL 在创建 RequestContext 时从 RequestContent 中复制 sessionId 字段
2. THE RequestContext SHALL 包含 sessionId 字段用于存储会话标识符
3. WHEN 生成响应事件时, THE SDK_Dispatcher SHALL 将 sessionId 传递给事件生成函数
4. THE RequestContext.sessionId SHALL 在整个请求生命周期中保持不变
5. WHEN 清理请求上下文时, THE SDK_Dispatcher SHALL 记录 sessionId 用于审计日志
6. THE sessionId SHALL 包含 channelId 和 userId 信息,格式为 `channel:{channelId}:user:{userId}`

### Requirement 5: Session ID 在响应事件中包含

**User Story:** 作为服务器开发者,我需要在响应事件中接收构造的 sessionId,以便正确路由响应到对应的用户会话。

#### Acceptance Criteria

1. WHEN 生成 response.in_progress 事件, THE Protocol_Module SHALL 在 metadata.session_id 字段中包含构造的 sessionId
2. WHEN 生成 response.completed 事件, THE Protocol_Module SHALL 在 metadata.session_id 字段中包含构造的 sessionId
3. WHEN 生成 response.failed 事件, THE Protocol_Module SHALL 在 metadata.session_id 字段中包含构造的 sessionId
4. WHEN 生成完整响应对象 (非流式模式), THE Protocol_Module SHALL 在 metadata.session_id 字段中包含构造的 sessionId
5. THE Protocol_Module SHALL 确保 metadata.session_id 字段值格式为 `channel:{channelId}:user:{userId}`
6. THE sessionId 在响应事件中 SHALL 与请求处理流程中使用的 sessionId 完全一致

### Requirement 6: 会话隔离验证

**User Story:** 作为系统测试者,我需要验证不同用户的请求被正确隔离,以确保用户数据安全。

#### Acceptance Criteria

1. WHEN 同一 channelId 中两个不同 userId 的请求同时处理, THE SDK_Dispatcher SHALL 为每个请求创建独立的 RequestContext
2. THE SDK_Dispatcher SHALL 确保不同 userId 的请求使用不同的 Session_Key
3. WHEN 同一 channelId 和 userId 的连续请求到达时, THE SDK_Dispatcher SHALL 使用相同的 Session_Key,确保上下文连续性
4. WHEN 查询活动请求数量时, THE SDK_Dispatcher SHALL 正确统计所有用户的活动请求总数
5. THE SDK_Dispatcher SHALL 确保不同用户的响应事件包含正确的 metadata.session_id
6. WHEN 请求超时或失败时, THE SDK_Dispatcher SHALL 仅清理对应用户的请求上下文,不影响其他用户

### Requirement 7: 日志记录与诊断

**User Story:** 作为系统运维人员,我需要在日志中看到 userId、channelId 和构造的 sessionId 信息,以便追踪和诊断特定用户会话的问题。

#### Acceptance Criteria

1. WHEN 解析请求时, THE Protocol_Module SHALL 在日志中记录 userId、channelId 和构造的 sessionId
2. WHEN 分发请求到 SDK 时, THE SDK_Dispatcher SHALL 在日志中记录 sessionId 和 Session_Key
3. WHEN 生成响应事件时, THE SDK_Dispatcher SHALL 在日志中记录 sessionId
4. WHEN 请求完成或失败时, THE SDK_Dispatcher SHALL 在日志中记录 sessionId 和最终状态
5. WHEN 清理请求上下文时, THE SDK_Dispatcher SHALL 在日志中记录 sessionId
6. THE 日志 SHALL 包含足够信息以追踪特定用户在特定 channel 中的所有请求


### Requirement 8: 错误处理与降级

**User Story:** 作为系统开发者,我需要在用户身份提取或会话构造错误发生时提供清晰的错误信息,以便快速定位问题。

#### Acceptance Criteria

1. IF 请求中缺失 metadata.user_id 字段, THEN THE Protocol_Module SHALL 抛出包含 "missing or non-string metadata.user_id" 的错误
2. IF 请求中缺失 metadata.channel_id 字段, THEN THE Protocol_Module SHALL 抛出包含 "missing or non-string metadata.channel_id" 的错误
3. WHEN 解析错误发生时, THE Protocol_Module SHALL 在错误消息中包含原始消息预览 (前 100 字符)
4. WHEN SDK 分发失败时, THE SDK_Dispatcher SHALL 在 response.failed 事件的 metadata 中包含构造的 sessionId
5. THE SDK_Dispatcher SHALL 确保错误处理不影响其他用户的请求处理
6. WHEN 生成失败事件时, THE SDK_Dispatcher SHALL 记录完整的错误堆栈、userId、channelId 和 sessionId

### Requirement 9: 向后兼容性

**User Story:** 作为系统维护者,我需要确保新功能不破坏现有测试和功能,以保证系统稳定性。

#### Acceptance Criteria

1. THE Protocol_Module SHALL 在 parseRequest 函数中强制要求 metadata.user_id 和 metadata.channel_id 字段
2. THE SDK_Dispatcher SHALL 在所有现有功能中正确传递构造的 sessionId
3. THE Protocol_Module SHALL 在所有事件生成函数中支持可选的 sessionId 参数
4. WHEN sessionId 参数未提供时, THE Protocol_Module SHALL 不在事件中包含 metadata 字段
5. THE SDK_Dispatcher SHALL 确保现有的超时、错误处理、并发控制功能与用户隔离功能兼容
6. THE 现有测试 SHALL 更新以提供 metadata.user_id 和 metadata.channel_id 字段
