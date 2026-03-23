import fs from 'fs';

let code = fs.readFileSync('src/services/messaging.ts', 'utf-8');

// 1. Remove imports
code = code.replace(/\/\/ ✅ 导入 AI Card 相关函数，避免重复实现\nimport {\n[\s\S]*?} from "\.\/messaging\/card\.ts";\n/, '');

// 2. Remove interfaces
code = code.replace(/\/\*\* 主动发送消息的结果 \*\/[\s\S]*?\/\/ ============ 普通消息发送 ============/m, `/** 主动发送消息的结果 */
export interface SendResult {
  ok: boolean;
  processQueryKey?: string;
  error?: string;
}

/** 主动发送选项 */
export interface ProactiveSendOptions {
  msgType?: IntClawMsgType;
  replyToId?: string;
  title?: string;
  log?: any;
}

// ============ 普通消息发送 ============`);

// 3. Remove sendAICard functions (sendAICardInternal, sendAICardToUser, sendAICardToGroup)
code = code.replace(/\/\*\*\n \* 主动创建并发送 AI Card（通用内部实现）\n \*\/[\s\S]*?export async function sendAICardToGroup[\s\S]*?\}\n/m, '');

// 4. Remove usedAICard returns
code = code.replace(/,\s*usedAICard:\s*(false|true)/g, '');
code = code.replace(/usedAICard:\s*(false|true),?\s*/g, '');

// 5. Replace AICardTarget type with standard type
code = code.replace(/target: AICardTarget,/g, 'target: { type: "user"; userId: string } | { type: "group"; openConversationId: string },');

// 6. Clean up sendProactiveInternal
// remove from options extraction
code = code.replace(/,\s*useAICard\s*=\s*(false|true)/g, '');
code = code.replace(/,\s*fallbackToNormal\s*=\s*(false|true)/g, '');

// remove the if (useAICard) block
code = code.replace(/  \/\/ 如果启用 AI Card[\s\S]*?\/\/ 发送普通消息/m, '  // 发送普通消息');

// remove useAICard from logging
code = code.replace(/,\s*useAICard:\s*options\.useAICard/g, '');

fs.writeFileSync('src/services/messaging.ts', code);
console.log('Finished modifying src/services/messaging.ts');
