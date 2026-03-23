/**
 * Gateway Methods 注册
 * 
 * 提供IntClaw插件的 RPC 接口，允许外部系统、AI Agent 和其他插件调用IntClaw功能
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { resolveIntclawAccount } from "./config/accounts.ts";

import { sendProactive } from "./services/messaging.ts";
import { getUnionId } from "./utils/utils-legacy.ts";

/**
 * 注册所有 Gateway Methods
 */
export function registerGatewayMethods(api: OpenClawPluginApi) {
  const log = api.logger;
  
  // ============ 消息发送类 ============

  /**
   * 主动发送单聊消息
   * 
   * @example
   * ```typescript
   * await gateway.call('intclaw-connector.sendToUser', {
   *   userId: 'user123',
   *   content: '任务已完成！',
   *      * });
   * ```
   */
  api.registerGatewayMethod('intclaw-connector.sendToUser', async ({ context, params, respond }) => {
    const cfg = context.deps.getConfig();
    try {
      const { userId, userIds, content, msgType, title, accountId } = params || {};
      const account = resolveIntclawAccount({ cfg, accountId });

      if (!account.config?.clientId) {
        return respond(false, { error: 'IntClaw not configured' });
      }

      const targetUserIds = userIds || (userId ? [userId] : []);
      if (targetUserIds.length === 0) {
        return respond(false, { error: 'userId or userIds is required' });
      }

      if (!content) {
        return respond(false, { error: 'content is required' });
      }

      // 构建目标
      const target = targetUserIds.length === 1
        ? { userId: targetUserIds[0] }
        : { userIds: targetUserIds };

      const result = await sendProactive(account.config, target, content, {
        msgType,
        title,
        log,
      });

      respond(result.ok, result);
    } catch (err: any) {
      log?.error?.(`[Gateway][sendToUser] 错误: ${err.message}`);
      respond(false, { error: err.message });
    }
  });

  /**
   * 主动发送群聊消息
   * 
   * @example
   * ```typescript
   * await gateway.call('intclaw-connector.sendToGroup', {
   *   openConversationId: 'cid123',
   *   content: '构建失败，请检查日志',
   *      * });
   * ```
   */
  api.registerGatewayMethod('intclaw-connector.sendToGroup', async ({ context, params, respond }) => {
    const cfg = context.deps.getConfig();
    try {
      const { openConversationId, content, msgType, title, accountId } = params || {};
      const account = resolveIntclawAccount({ cfg, accountId });

      if (!account.config?.clientId) {
        return respond(false, { error: 'IntClaw not configured' });
      }

      if (!openConversationId) {
        return respond(false, { error: 'openConversationId is required' });
      }

      if (!content) {
        return respond(false, { error: 'content is required' });
      }

      const result = await sendProactive(account.config, { openConversationId }, content, {
        msgType,
        title,
        log,
      });

      respond(result.ok, result);
    } catch (err: any) {
      log?.error?.(`[Gateway][sendToGroup] 错误: ${err.message}`);
      respond(false, { error: err.message });
    }
  });

  /**
   * 智能发送消息（自动识别目标类型）
   * 
   * @example
   * ```typescript
   * // 发送给用户
   * await gateway.call('intclaw-connector.send', {
   *   target: 'user:user123',
   *   content: '你好！'
   * });
   * 
   * // 发送到群
   * await gateway.call('intclaw-connector.send', {
   *   target: 'group:cid123',
   *   content: '大家好！'
   * });
   * ```
   */
  api.registerGatewayMethod('intclaw-connector.send', async ({ context, params, respond }) => {
    const cfg = context.deps.getConfig();
    try {
      const { target, content, message, msgType, title, accountId } = params || {};
      const actualContent = content || message;
      const account = resolveIntclawAccount({ cfg, accountId });

      log?.info?.(`[Gateway][send] 收到请求: target=${target}, contentLen=${actualContent?.length}`);

      if (!account.config?.clientId) {
        return respond(false, { error: 'IntClaw not configured' });
      }

      if (!target) {
        return respond(false, { error: 'target is required (format: user:<userId> or group:<openConversationId>)' });
      }

      if (!actualContent) {
        return respond(false, { error: 'content is required' });
      }

      const targetStr = String(target);
      let sendTarget: { userId?: string; openConversationId?: string };

      if (targetStr.startsWith('user:')) {
        sendTarget = { userId: targetStr.slice(5) };
      } else if (targetStr.startsWith('group:')) {
        sendTarget = { openConversationId: targetStr.slice(6) };
      } else {
        // 默认当作 userId
        sendTarget = { userId: targetStr };
      }

      const result = await sendProactive(account.config, sendTarget, actualContent, {
        msgType,
        title,
        log,
      });

      respond(result.ok, result);
    } catch (err: any) {
      log?.error?.(`[Gateway][send] 错误: ${err.message}`);
      respond(false, { error: err.message });
    }
  });



  // ============ 状态检查类 ============

  /**
   * 检查插件状态
   * 
   * @example
   * ```typescript
   * const result = await gateway.call('intclaw-connector.status');
   * console.log('配置状态:', result);
   * ```
   */
  api.registerGatewayMethod('intclaw-connector.status', async ({ context, respond }) => {
    const cfg = context.deps.getConfig();
    try {
      const account = resolveIntclawAccount({ cfg });
      const configured = Boolean(account.config?.clientId && account.config?.clientSecret);

      respond(true, {
        configured,
        enabled: account.enabled,
        accountId: account.accountId,
        clientId: account.config?.clientId,
      });
    } catch (err: any) {
      log?.error?.(`[Gateway][status] 错误: ${err.message}`);
      respond(false, { error: err.message });
    }
  });

  /**
   * 探测IntClaw连接
   * 
   * @example
   * ```typescript
   * const result = await gateway.call('intclaw-connector.probe');
   * if (result.ok) {
   *   console.log('连接正常');
   * }
   * ```
   */
  api.registerGatewayMethod('intclaw-connector.probe', async ({ context, respond }) => {
    const cfg = context.deps.getConfig();
    try {
      const account = resolveIntclawAccount({ cfg });
      
      if (!account.config?.clientId || !account.config?.clientSecret) {
        return respond(false, { error: 'Not configured' });
      }

      // 尝试获取 access token 来验证连接
      const { getAccessToken } = await import('./utils/utils-legacy.ts');
      await getAccessToken(account.config);

      respond(true, { ok: true, details: { clientId: account.config.clientId } });
    } catch (err: any) {
      log?.error?.(`[Gateway][probe] 错误: ${err.message}`);
      respond(false, { ok: false, error: err.message });
    }
  });

}
