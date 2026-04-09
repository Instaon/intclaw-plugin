# Bugfix Requirements Document

## Introduction

WebSocket协议解析与open-responses.md规范不一致。当前实现使用了旧的`MESSAGE/headers/data` envelope包装格式,而规范要求直接传输标准JSON对象。这导致与服务器的协议不匹配,无法正确解析接收的消息和发送响应事件。

本修复将重构协议处理逻辑,使其完全遵循open-responses.md定义的协议格式,支持双向通信:
- 接收方向: 解析服务器发送的标准request对象
- 发送方向: 以流式形式发送标准response.*事件对象

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN 接收来自WebSocket服务器的消息 THEN 系统尝试解析旧的envelope格式(`{type:"MESSAGE", headers:{messageId,topic}, data:"..."}`)导致解析失败

1.2 WHEN 向WebSocket服务器发送响应事件 THEN 系统将事件包装在envelope格式中发送,导致服务器无法识别

1.3 WHEN 处理用户请求消息 THEN 系统期望envelope.data字段包含`{content:"..."}`格式,而不是标准request对象格式

1.4 WHEN 生成流式响应 THEN 系统使用旧的事件类型(如`response.in_progress`, `response.output_item.added`)而不是新规范的事件类型(如`response.created`, `response.output_text.delta`)

### Expected Behavior (Correct)

2.1 WHEN 接收来自WebSocket服务器的消息 THEN 系统SHALL直接解析标准JSON对象,识别request格式(`{model, stream, input, metadata}`)

2.2 WHEN 向WebSocket服务器发送响应事件 THEN 系统SHALL直接发送标准response.*事件JSON对象,不包装envelope层

2.3 WHEN 处理用户请求消息 THEN 系统SHALL从request.input数组中提取用户消息内容,并从request.metadata.session_id获取会话标识

2.4 WHEN 生成流式响应(stream=true) THEN 系统SHALL按顺序发送以下事件:
- `response.created` (包含response初始快照)
- `response.output_text.delta` (多次,每次携带文本增量)
- `response.output_text.done` (包含完整文本)
- `response.completed` (包含最终response对象)

2.5 WHEN 生成非流式响应(stream=false) THEN 系统SHALL发送完整response对象(`{id, object:"response", status:"completed", output, output_text, metadata}`)

2.6 WHEN 响应失败 THEN 系统SHALL发送`response.failed`事件,包含error对象(`{code, message}`)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN SDK dispatcher接收到callback调用 THEN 系统SHALL CONTINUE TO正确处理文本chunk、completion和error信号

3.2 WHEN 生成响应ID和item ID THEN 系统SHALL CONTINUE TO使用唯一标识符生成机制

3.3 WHEN WebSocket连接状态变化 THEN 系统SHALL CONTINUE TO正确管理连接生命周期(连接、断开、重连)

3.4 WHEN 处理并发请求 THEN 系统SHALL CONTINUE TO维护请求上下文映射和并发限制

3.5 WHEN 记录日志 THEN 系统SHALL CONTINUE TO输出诊断信息用于调试

3.6 WHEN 处理超时 THEN 系统SHALL CONTINUE TO在超时后发送失败事件并清理资源

3.7 WHEN 心跳机制运行 THEN 系统SHALL CONTINUE TO发送ping/pong保持连接活跃
