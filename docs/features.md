# IntClaw 连接器功能列表

## 核心功能

### AI Card 流式响应
- 打字机效果，实时流式显示回复
- 基于 WebSocket 的流式通信
- 支持 AI Card 富文本格式

### 会话管理
- 多轮对话，保持上下文
- 会话隔离：私聊、群聊、不同群之间会话独立
- 自动会话重置：30 分钟无活动后自动开启新会话
- 手动会话重置：发送 `/new`、`新会话` 等命令清空对话历史

### 消息接收与处理
- 富媒体接收：接收并处理 JPEG/PNG 图片，传递给视觉模型
- 文件附件提取：解析 .docx、.pdf、文本文件和二进制文件
- Markdown 表格转换：自动将 Markdown 表格转换为 IntClaw 兼容格式

### 消息发送
- 图片自动上传：本地图片路径自动上传到 IntClaw
- 主动发送消息：程序化地向用户或群发送消息
- 音频消息支持：发送多种格式的音频消息（mp3、wav、amr、ogg）

### IntClaw 文档 API
- `docs.create` - 创建文档
- `docs.append` - 追加内容到文档
- `docs.search` - 搜索文档
- `docs.list` - 列举文档
- `docs.read` - 读取文档内容

> 注意：文档 API 依赖 MCP（Model Context Protocol）提供底层 tool，需要在 OpenClaw Gateway/Agent 侧启用对应的 MCP Server/Tool。

### 多 Agent 路由
- 将多个机器人连接到不同的 Agent
- 实现专业化服务
- 支持多账号配置

### 异步模式（可选）
- 立即确认消息，后台处理
- 自定义确认消息文本
- 适合处理长时间任务

## 配置功能

### 基础配置
- `clientId` - IntClaw AppKey
- `clientSecret` - IntClaw AppSecret

### 会话管理配置
- `separateSessionByConversation` - 私聊/群聊分别维护会话
- `groupSessionScope` - 群聊会话范围：`group`（共享）或 `group_sender`（每人独立）
- `sharedMemoryAcrossConversations` - 是否在不同会话间共享记忆

### 会话路由策略
- `pmpolicy` / `groupPolicy` - 会话路由/消息策略配置
- 默认值为 `open`

### 异步模式配置
- `asyncMode` - 启用异步模式处理长时间任务
- `ackText` - 确认消息文本（默认：`🫡 任务已接收，处理中...`）

## 会话命令

用户可以发送以下命令清理对话历史，重新开始会话：

- `/new`
- `/reset`
- `/clear`
- `新会话`
- `重新开始`
- `清空对话`

## 支持的消息类型

- 文本消息
- 图片消息（JPEG/PNG）
- 文件附件（.docx、.pdf、文本文件等）
- 音频消息（mp3、wav、amr、ogg）
- 视频消息（基础支持）
