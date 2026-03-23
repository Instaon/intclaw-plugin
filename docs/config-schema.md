# IntClaw Plugin 配置 Schema 说明

本文档描述 `intclawPlugin` 中 `configSchema` 的核心配置属性。

## 配置层级结构

IntClaw Plugin 的配置分为两层：

1. **顶层配置** - 全局默认配置
2. **账号配置** - `accounts` 对象下的具体账号配置

---

## 顶层配置属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 启用或禁用 IntClaw 连接器 |
| `defaultAccount` | string | 默认账号 ID，用于多账号场景 |
| `clientId` | string \| number | IntClaw AppKey，用于身份验证 |
| `clientSecret` | string \| SecretInputRef | IntClaw AppSecret，支持直接字符串或引用外部源（env/file/exec） |
| `systemPrompt` | string | 系统提示词，用于设置 AI 的行为和角色 |

**SecretInputRef 格式：**
```json
{
  "source": "env" | "file" | "exec",
  "provider": "提供者标识",
  "id": "密钥标识"
}
```

---

## 账号配置 (accounts)

`accounts` 对象用于配置多个 IntClaw 账号，每个账号可以有自己的独立配置。

### 账号属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 启用或禁用该账号 |
| `name` | string | 账号显示名称 |
| `clientId` | string \| number | 该账号的 AppKey |
| `clientSecret` | string \| SecretInputRef | 该账号的 AppSecret |
| `systemPrompt` | string | 该账号的系统提示词 |

### 配置示例

```json
{
  "channels": {
    "intclaw-connector": {
      "enabled": true,
      "clientId": "your-app-key",
      "clientSecret": "your-app-secret",
      "systemPrompt": "你是一个专业的 AI 助手",
      "accounts": {
        "prod": {
          "enabled": true,
          "name": "生产环境",
          "clientId": "prod-app-key",
          "clientSecret": { "source": "env", "provider": "custom", "id": "PROD_SECRET" },
          "systemPrompt": "你是生产环境的客服助手"
        },
        "test": {
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

## 配置优先级

配置值的优先级从高到低为：

1. **账号配置** (`accounts.<accountId>`)
2. **顶层配置** (`intclaw-connector`)

当某个属性在多个层级都有定义时，使用优先级最高的值。

---

## 相关文档

- [功能列表](features.md) - IntClaw 连接器的完整功能列表
- [README](../README.md) - 项目说明文档
