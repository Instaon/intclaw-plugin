/**
 * 消息发送模块统一导出
 */

export * from './send.ts';

// 兼容旧实现（`src/services/messaging.ts`）中仍被外部调用的 API。
// 注意：这里只显式导出函数，避免与 `send.ts/card.ts` 的类型/常量命名冲突。
export {
  sendMessage,
  sendProactive,
  sendToUser,
  sendToGroup,
  sendTextToIntClaw,
  sendMediaToIntClaw,
} from '../messaging.ts';
