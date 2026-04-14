# OpenClaw Channel 用户隔离开发说明书

本文档用于指导 Claude Code 修改或实现一个 OpenClaw Channel 插件，使“同一个 channel 内的多个用户”能够做到会话隔离。OpenClaw 官方文档说明，channel 插件负责 **Session grammar**，即“provider-specific conversation ids map to base chats, thread ids, and parent fallbacks”；而 **outer session-key shape** 由 core 负责。[web:63]

官方文档同时指出：如果平台把额外 scope 存在 conversation id 中，应在 `messaging.resolveSessionConversation(...)` 中做解析；这是把 `rawId` 映射为 `base conversation id`、可选 `thread id`、显式 `baseConversationId` 和 `parentConversationCandidates` 的 canonical hook。[page:1]

## 目标

让一个 channel 中的多个用户不会共享同一份上下文。要达到这个目标，必须同时满足两件事：

1. 入站消息里能够识别“当前是谁发来的”。[page:1]
2. 传给 OpenClaw 的会话归属信息，必须把不同用户拆成不同的 conversation/session 维度。[page:1][page:2]

如果插件把所有入站消息都落到同一个会话标识上，那么无论上层如何配置，用户上下文都会串在一起。[page:1][page:2]

## 官方事实

OpenClaw 官方 `Building Channel Plugins` 文档明确写道：

> Channel plugins do not need their own send/edit/react tools. OpenClaw keeps one shared `message` tool in core. Your plugin owns: ... **Session grammar** — how provider-specific conversation ids map to base chats, thread ids, and parent fallbacks ... [page:1]

> Core owns the shared message tool, prompt wiring, the outer session-key shape, generic `:thread:` bookkeeping, and dispatch. If your platform stores extra scope inside conversation ids, keep that parsing in the plugin with `messaging.resolveSessionConversation(...)`. That is the canonical hook for mapping `rawId` to the base conversation id, optional thread id, explicit `baseConversationId`, and any `parentConversationCandidates`. [page:1]

OpenClaw 官方 `Session Management` 文档同时说明，私信隔离模式包括 `main`、`per-peer`、`per-channel-peer`、`per-account-channel-peer`，其中 `per-channel-peer` 是“按渠道 + 发送者隔离（推荐）”。[page:2]

## 适用场景

本说明书适用于以下情况：

- 你已经有一个 Channel 插件。 [page:1]
- 这个插件通过 webhook、WebSocket 或其他方式接收平台消息。 [page:1]
- 同一个 channel / room / 群 / 收件箱中，有多个用户会与 OpenClaw 对话。 [page:2]
- 你希望每个用户拥有独立上下文，而不是共用一个历史。 [page:2]

## 设计原则

实现用户隔离时，遵循下面三条原则：

- 不要把整个 channel 只映射成一个固定会话 ID。否则所有人共用上下文。 [page:1][page:2]
- 会话归属必须包含“用户身份”。如果是同一个群里多人使用，建议包含“channel + user”。 [page:2]
- 如果平台 raw conversation id 里混入 thread/topic/room 等额外层级，必须由插件解析后，再返回给 OpenClaw。 [page:1]

## Claude Code 执行任务说明

下面这段是可以直接发给 Claude Code 的完整开发说明。目标不是生成配置，而是修改你的 Channel 插件代码，让它实现“同一个 channel 多用户隔离”。

```md
# 任务：为 OpenClaw Channel 插件实现用户隔离

你现在是资深 TypeScript/OpenClaw 插件工程师。请基于现有 OpenClaw Channel 插件代码，完成“同一个 channel 内多用户隔离”的改造。

## 背景

当前插件的问题是：多个用户在同一个 channel 中发消息时，共享同一份上下文，导致会话串线。

OpenClaw 官方文档指出：
- Channel 插件负责 **Session grammar**，也就是 provider-specific conversation ids 如何映射到 base chats、thread ids、parent fallbacks。[page:1]
- Core 负责 outer session-key shape；如果平台把额外 scope 放在 conversation id 中，应通过 `messaging.resolveSessionConversation(...)` 来解析。[page:1]
- Session 隔离模式中，`per-channel-peer` 表示按“渠道 + 发送者”隔离，是多用户 channel 的推荐方案。[page:2]

## 改造目标

请修改插件代码，使：

1. 同一个 channel 中，不同用户不会共享上下文。
2. 同一个用户在同一个 channel 中，会命中同一条会话链路。
3. 如果平台支持 thread/topic，可在不破坏用户隔离的前提下保留 thread 信息。
4. 代码必须是真实可运行的 TypeScript，不要只写伪代码。

## 核心实现要求

### 一、先排查当前插件问题

请在现有代码中查找：
- 收到平台入站消息的函数
- WebSocket / webhook / poll 收到消息后的事件处理入口
- 最终把入站消息 dispatch 给 OpenClaw 的位置
- 当前是否把所有消息都映射到了同一个 conversation id / peer / target

如果当前逻辑存在以下任一情况，请判定为“会话串线根因”：
- 使用固定 conversation id
- 使用固定 peer id
- 只按 channelId 路由，不带 userId
- 把 userId 丢失在入站转换过程中

### 二、实现用户隔离

你必须保证：
- 每条入站消息都能提取出稳定的 userId
- 如果是同一 channel 内多用户场景，会话归属至少包含 `channelId + userId`
- 不要只用 `channelId`
- 不要让所有人共享同一个会话键

### 三、代码改造要求

请完成以下改造：

1. 找到平台消息结构里的这些字段，并做标准化提取：
   - `userId`
   - `channelId` 或 `conversationId`
   - `threadId`（如果有）
   - `messageId`
   - `text`

2. 新增一个标准化函数，例如：

```ts
function buildInboundIdentity(event: PlatformEvent) {
  return {
    userId: String(event.userId),
    channelId: String(event.channelId),
    threadId: event.threadId ? String(event.threadId) : undefined,
  };
}
```

3. 新增一个会话归属函数，例如：

```ts
function buildConversationKey(input: {
  channelId: string;
  userId: string;
  threadId?: string;
}) {
  return {
    baseConversationId: `channel:${input.channelId}:user:${input.userId}`,
    threadId: input.threadId,
  };
}
```

4. 如果现有插件使用 `messaging.resolveSessionConversation(...)`，请接入这个函数，并确保：
   - `baseConversationId` 至少包含 `channelId + userId`
   - 如果有 thread，返回 `threadId`
   - 如有必要，返回 `parentConversationCandidates`

5. 如果现有插件不是 builder 风格，而是在 inbound pipeline 中直接 dispatch 给 OpenClaw，请确保 dispatch 时传入的会话归属信息包含用户维度，不要是全局固定值。

### 四、输出要求

请输出：
1. 根因分析
2. 修改方案
3. 完整代码 diff 或完整文件代码
4. 每一处修改的作用说明
5. 最终验证方法

## 代码风格要求

- 使用 TypeScript
- 保持现有项目结构
- 优先局部修改，不要无关重构
- 不要引入与本需求无关的抽象
- 不要删除已有出站能力
- 不要破坏现有配置逻辑

## 验证要求

最终请给出验证方案，覆盖以下场景：

1. 同一 channel 中用户 A 连续发两条消息，应该命中同一会话。
2. 同一 channel 中用户 B 发消息，不应读取 A 的上下文。
3. 用户 A 再次发消息，仍然回到自己的会话。
4. 如果有 threadId，thread 行为不能覆盖掉用户隔离。

## 额外要求

如果你在代码中发现现有插件没有任何 `resolveSessionConversation(...)` 入口，也请不要编造 SDK API；而是基于现有 inbound dispatch 链路，在实际 dispatch 前构造用户隔离所需的 conversation identity。
```

## 你应该如何落地

Claude Code 在执行时，应优先扫描下面几类文件：

- `connection.ts`、`runtime.ts`、`webhook.ts`、`inbound.ts` 之类的入站处理文件。 [page:1]
- 任何调用 `channelRuntime`、`dispatch`、`handleInbound`、`registerHttpRoute` 的地方。 [page:1]
- 当前是否有固定 `conversationId`、固定 `peer.id`、固定 `to` 的写法。 [page:1]

如果插件采用 OpenClaw builder 风格，应优先考虑把会话归属逻辑接到 `messaging.resolveSessionConversation(...)`；如果不是 builder 风格，就在实际 inbound dispatch 前，将消息归属改成包含 `channelId + userId` 的稳定标识。[page:1]

## 建议的代码模板

如果 Claude Code 需要一个明确模板，可以让它优先使用下面这种实现思路：

```ts
export function buildInboundIdentity(event: {
  userId: string | number;
  channelId: string | number;
  threadId?: string | number | null;
}) {
  return {
    userId: String(event.userId),
    channelId: String(event.channelId),
    threadId: event.threadId ? String(event.threadId) : undefined,
  };
}

export function buildConversationIdentity(input: {
  userId: string;
  channelId: string;
  threadId?: string;
}) {
  return {
    baseConversationId: `channel:${input.channelId}:user:${input.userId}`,
    threadId: input.threadId,
    parentConversationCandidates: input.threadId
      ? [`channel:${input.channelId}:user:${input.userId}`]
      : undefined,
  };
}
```

如果是 builder 风格插件，可接成：

```ts
messaging: {
  resolveSessionConversation({ rawId }) {
    const parsed = parseRawId(rawId);
    return {
      baseConversationId: `channel:${parsed.channelId}:user:${parsed.userId}`,
      threadId: parsed.threadId,
      parentConversationCandidates: parsed.threadId
        ? [`channel:${parsed.channelId}:user:${parsed.userId}`]
        : undefined,
    };
  },
},
```

如果是非 builder 风格插件，则在 inbound dispatch 之前就把 identity 构造好：

```ts
const identity = buildInboundIdentity(event);
const conversation = buildConversationIdentity(identity);

await dispatchInboundToOpenClaw({
  text: event.text,
  messageId: event.messageId,
  userId: identity.userId,
  channelId: identity.channelId,
  conversation,
});
```

## 排查清单

让 Claude Code 按下面顺序检查：

1. 是否存在固定会话 ID。 [page:1]
2. 是否只按 channel 分流，没有按用户分流。 [page:2]
3. 是否在入站转换过程中丢失 userId。 [page:1]
4. 是否错误把 threadId 当成唯一会话主键，导致用户仍然串线。 [page:1]
5. 是否返回了错误的 parentConversationCandidates 顺序；官方要求从最窄到最宽。[page:1]

## 验证脚本建议

可以让 Claude Code 补充一个最小测试，模拟同一 channel 下两名用户：

```ts
const a1 = buildConversationIdentity({ channelId: 'room-1', userId: 'alice' });
const a2 = buildConversationIdentity({ channelId: 'room-1', userId: 'alice' });
const b1 = buildConversationIdentity({ channelId: 'room-1', userId: 'bob' });

expect(a1.baseConversationId).toBe(a2.baseConversationId);
expect(a1.baseConversationId).not.toBe(b1.baseConversationId);
```

这可以直接验证“同群同人同会话、同群不同人不同会话”的核心行为。 [page:2]

## 最后的执行提示

把这份说明给 Claude Code 时，可以加一句：

> 请不要编造 OpenClaw SDK 中不存在的 API。若当前项目不是 `createChatChannelPlugin` builder 风格，请基于现有 inbound dispatch 链路完成用户隔离改造；若存在 `messaging.resolveSessionConversation(...)`，则优先使用官方文档指定的 canonical hook。[page:1]

这样它更容易沿着现有代码真实落地，而不是重写一套不存在的接口。 [page:1]
