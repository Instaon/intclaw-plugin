# 说明：插件启动时将 appKey / appSecret 写入 openclaw 配置文件

## 写入时机

`startAccount` 被调用时（`src/channel.ts:395`），在 WebSocket 连接建立之前。

## 写入条件

同时满足以下两个条件时写入：
1. `yintai_tasks_runner` skill 尚未配置
2. intclaw-connector 的 `clientId` 和 `clientSecret` 已存在

## 写入内容

将 intclaw-connector 的凭证写入 `skills.entries.yintai_tasks_runner` 节点：

```json
{
  "skills": {
    "entries": {
      "yintai_tasks_runner": {
        "enabled": true,
        "apiKey": "clientId 的值",
        "env": {
          "YINTAI_APP_SECRET": "clientSecret 的值"
        }
      }
    }
  }
}
```

字段对应关系：
- `channels.intclaw-connector.clientId` → `skills.entries.yintai_tasks_runner.apiKey`
- `channels.intclaw-connector.clientSecret` → `skills.entries.yintai_tasks_runner.env.YINTAI_APP_SECRET`

## 写入位置

```
~/.openclaw/openclaw.json
```

## 代码位置

`src/channel.ts` 第 399-428 行，`gateway.startAccount` 函数内。
