# IntClaw Plugin 配置 Schema 说明

本文档详细描述 `intclawPlugin` 中 `configSchema` 的每一个属性及其在项目中的作用。

## 配置层级结构

IntClaw Plugin 的配置分为三层：

1. **顶层配置** - 全局默认配置
2. **账号配置** - `accounts` 对象下的具体账号配置
3. **群组配置** - `groups` 对象下的特定群组配置

子配置会继承并覆盖父配置的值。

---

## 顶层配置属性

### 基础配置

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | - | 启用或禁用 IntClaw 连接器 |
| `defaultAccount` | string | - | 默认账号 ID，用于多账号场景 |

### 认证配置

| 属性 | 类型 | 说明 |
|------|------|------|
| `clientId` | string \| number | IntClaw AppKey，用于身份验证 |
| `clientSecret` | string \| SecretInputRef | IntClaw AppSecret，支持直接字符串或引用外部源（env/file/exec） |

### 功能配置

| 属性 | 类型 | 说明 |
|------|------|------|
| `enableMediaUpload` | boolean | 启用媒体文件上传功能 |
| `systemPrompt` | string | 系统提示词，用于设置 AI 的行为和角色 |

### 私聊策略配置

| 属性 | 类型 | 可选值 | 说明 |
|------|------|--------|------|
| `dmPolicy` | string | `open` / `pairing` / `allowlist` | 私聊消息策略 |
| `allowFrom` | array\<string\|number\> | - | 允许发送私聊消息的用户白名单（当 `dmPolicy` 为 `allowlist` 时生效） |

**私聊策略说明：**
- `open` - 任何用户都可以发起私聊
- `pairing` - 需要配对/审批后才能私聊
- `allowlist` - 仅白名单用户可以私聊

### 群聊策略配置

| 属性 | 类型 | 可选值 | 说明 |
|------|------|--------|------|
| `groupPolicy` | string | `open` / `allowlist` / `disabled` | 群聊消息策略 |
| `groupAllowFrom` | array\<string\|number\> | - | 允许机器人响应的群聊白名单（当 `groupPolicy` 为 `allowlist` 时生效） |
| `requireMention` | boolean | - | 是否需要 @ 机器人才会响应消息 |

**群聊策略说明：**
- `open` - 机器人可加入任何群聊，可通过 `requireMention` 控制是否需要 @
- `allowlist` - 仅白名单群聊可以使用
- `disabled` - 禁用群聊功能

### 会话管理配置

| 属性 | 类型 | 可选值 | 说明 |
|------|------|--------|------|
| `groupSessionScope` | string | `group` / `group_sender` | 群聊会话范围 |
| `separateSessionByConversation` | boolean | - | 是否按对话（私聊/群聊）分离会话 |
| `sharedMemoryAcrossConversations` | boolean | - | 是否在不同会话间共享记忆 |

**会话范围说明：**
- `group` - 群内所有成员共享同一个会话上下文
- `group_sender` - 每个成员在群内有独立的会话上下文

### 历史记录配置

| 属性 | 类型 | 说明 |
|------|------|------|
| `historyLimit` | integer (≥0) | 会话历史记录最大条数 |
| `dmHistoryLimit` | integer (≥0) | 私聊会话历史记录最大条数（优先级高于 `historyLimit`） |

### 消息处理配置

| 属性 | 类型 | 说明 |
|------|------|------|
| `textChunkLimit` | integer (≥1) | 文本分块大小，超过此长度的消息会被分割发送 |
| `mediaMaxMb` | number (≥0) | 媒体文件最大大小（MB） |
| `typingIndicator` | boolean | 是否显示"正在输入..."指示器 |
| `resolveSenderNames` | boolean | 是否解析发送者名称 |

### 工具配置

| 属性 | 类型 | 说明 |
|------|------|------|
| `tools.media` | boolean | 启用媒体处理工具 |

---

## 账号配置 (accounts)

`accounts` 对象用于配置多个 IntClaw 账号，每个账号可以有自己的独立配置。

### 账号属性

每个账号支持以下属性（与顶层配置基本相同）：

| 属性 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 启用或禁用该账号 |
| `name` | string | 账号显示名称 |
| `clientId` | string \| number | 该账号的 AppKey |
| `clientSecret` | string \| SecretInputRef | 该账号的 AppSecret |
| `enableMediaUpload` | boolean | 启用媒体上传 |
| `systemPrompt` | string | 系统提示词 |
| `dmPolicy` | string | 私聊策略 |
| `allowFrom` | array | 允许的用户白名单 |
| `groupPolicy` | string | 群聊策略 |
| `groupAllowFrom` | array | 允许的群聊白名单 |
| `requireMention` | boolean | 是否需要 @ |
| `groupSessionScope` | string | 群聊会话范围 |
| `separateSessionByConversation` | boolean | 按对话分离会话 |
| `sharedMemoryAcrossConversations` | boolean | 会话间共享记忆 |
| `historyLimit` | integer | 历史记录限制 |
| `textChunkLimit` | integer | 文本分块限制 |
| `mediaMaxMb` | number | 媒体最大大小 |
| `typingIndicator` | boolean | 打字指示器 |
| `tools.media` | boolean | 媒体工具 |

### 配置示例

```json
{
  "channels": {
    "intclaw-connector": {
      "enabled": true,
      "clientId": "your-app-key",
      "clientSecret": "your-app-secret",
      "dmPolicy": "open",
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["group123", "group456"],
      "requireMention": true,
      "accounts": {
        "account1": {
          "enabled": true,
          "name": "生产环境",
          "clientId": "prod-app-key",
          "clientSecret": { "source": "env", "provider": "custom", "id": "PROD_SECRET" },
          "systemPrompt": "你是一个专业的客服助手",
          "groupPolicy": "open",
          "requireMention": false
        },
        "account2": {
          "enabled": false,
          "name": "测试环境",
          "clientId": "test-app-key",
          "clientSecret": "test-app-secret"
        }
      }
    }
  }
}
```

---

## 群组配置 (groups)

`groups` 对象用于为特定群组设置独立的配置，覆盖全局和账号级别的设置。

### 群组属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `requireMention` | boolean | 该群组是否需要 @ 机器人 |
| `enabled` | boolean | 启用或禁用该群组配置 |
| `allowFrom` | array\<string\|number\> | 允许触发机器人的用户白名单 |
| `systemPrompt` | string | 该群组专属的系统提示词 |
| `groupSessionScope` | string | 该群组的会话范围 |
| `tools` | object | 工具权限策略 |

### 工具权限策略 (tools)

| 属性 | 类型 | 说明 |
|------|------|------|
| `tools.allow` | array\<string\> | 允许使用的工具列表 |
| `tools.deny` | array\<string\> | 禁止使用的工具列表 |

### 群组配置示例

```json
{
  "channels": {
    "intclaw-connector": {
      "groups": {
        "group-dev-team": {
          "enabled": true,
          "requireMention": false,
          "systemPrompt": "你是开发团队的技术助手",
          "groupSessionScope": "group_sender",
          "tools": {
            "allow": ["docs.*", "code.*"],
            "deny": ["admin.*"]
          }
        },
        "group-sales": {
          "enabled": true,
          "requireMention": true,
          "allowFrom": ["user123", "user456"],
          "systemPrompt": "你是销售团队的商务助手"
        }
      }
    }
  }
}
```

---

## 配置优先级

配置值的优先级从高到低为：

1. **群组配置** (`groups.<groupId>`)
2. **账号配置** (`accounts.<accountId>`)
3. **顶层配置** (`intclaw-connector`)

当某个属性在多个层级都有定义时，使用优先级最高的值。

---

## 相关文档

- [功能列表](features.md) - IntClaw 连接器的完整功能列表
- [README](../README.md) - 项目说明文档