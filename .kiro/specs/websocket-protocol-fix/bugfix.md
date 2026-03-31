# Bugfix Requirements Document

## Introduction

当前 WebSocket 协议实现存在根本性的架构问题：插件错误地将自己定位为主动发送方，而实际上应该作为被请求端（服务器向插件发起请求）。这导致协议方向理解错误、消息封装格式不符合规范，以及缺少统一的协议解析模块。

根据 Open Responses 协议规范（open-responses.md），正确的交互模式应该是：
- 服务器作为主动方，向插件发送请求（如用户消息）
- 插件作为被请求端，接收请求并生成响应事件序列
- 所有消息必须封装在 WebSocket Envelope 中，data 字段必须是 JSON 字符串

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN 插件发送消息时 THEN 系统将插件作为主动发送方处理，而不是作为响应服务器请求的被请求端

1.2 WHEN 创建 WebSocket Envelope 时 THEN 系统可能未正确将 data 字段序列化为 JSON 字符串

1.3 WHEN 处理协议逻辑时 THEN 系统在多个文件（channel.ts, protocol.ts, connection.ts）中分散处理，缺少统一的协议解析模块

1.4 WHEN 接收服务器消息时 THEN 系统未明确区分"接收请求"和"发送响应"的角色定位

### Expected Behavior (Correct)

2.1 WHEN 服务器发送请求到插件时 THEN 插件 SHALL 作为被请求端接收请求并解析 WebSocket Envelope

2.2 WHEN 插件需要响应时 THEN 插件 SHALL 生成 Open Responses 事件序列（response.in_progress → response.output_item.added → response.output_text.delta → response.completed）

2.3 WHEN 创建 WebSocket Envelope 时 THEN 系统 SHALL 确保 data 字段是 JSON 字符串格式（JSON.stringify(event)）

2.4 WHEN 处理协议逻辑时 THEN 系统 SHALL 使用统一的协议解析模块封装所有协议处理逻辑

2.5 WHEN 发送响应事件时 THEN 每个事件 SHALL 独立封装在 WebSocket Envelope 中发送

### Unchanged Behavior (Regression Prevention)

3.1 WHEN 解析有效的 WebSocket Envelope 消息时 THEN 系统 SHALL CONTINUE TO 正确提取 Open Responses 事件

3.2 WHEN 生成事件 ID 和响应 ID 时 THEN 系统 SHALL CONTINUE TO 使用唯一标识符

3.3 WHEN WebSocket 连接建立时 THEN 系统 SHALL CONTINUE TO 使用正确的认证头（x-app-key, x-app-secret）

3.4 WHEN 处理心跳机制时 THEN 系统 SHALL CONTINUE TO 正常发送 ping 并接收 pong

3.5 WHEN 连接断开时 THEN 系统 SHALL CONTINUE TO 执行重连逻辑

3.6 WHEN 接收到 response.output_text.delta 事件时 THEN 系统 SHALL CONTINUE TO 正确累积文本内容

3.7 WHEN 接收到 response.completed 事件时 THEN 系统 SHALL CONTINUE TO 正确完成响应处理
