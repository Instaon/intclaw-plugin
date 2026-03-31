import { getIntclawMonitorState } from "../../core/state.ts";
import crypto from "crypto";

export interface OutgoingAdapterOptions {
  log?: any;
}

/**
 * 发送流式事件的适配器
 * 将内部简单的文本回复指令转换为 Open Responses 规范的 WebSocket 流式事件序列
 */
export async function sendViaWSAdapter(
  accountId: string,
  target: { conversationId?: string },
  payload: any,
  opts: OutgoingAdapterOptions = {}
): Promise<boolean> {
  const { log } = opts;
  const state = getIntclawMonitorState(accountId);
  
  if (!state || !state.client || !state.running) {
    log?.warn?.(`[WS-Out-Adapter] WebSocket client not available. accountId=${accountId}`);
    return false;
  }

  const socket = state.client.socket;
  // 1 is WebSocket.OPEN
  if (!socket || socket.readyState !== 1) {
    log?.warn?.(`[WS-Out-Adapter] WebSocket socket is not OPEN. accountId=${accountId}`);
    return false;
  }

  // 1. 提取文本内容
  let textContent = "";
  if (payload.msgtype === "text" && payload.text?.content) {
    textContent = payload.text.content;
  } else if (payload.msgtype === "markdown" && payload.markdown?.text) {
    textContent = payload.markdown.text;
  } else {
    // 暂不支持的类型，让上层决定是否回退
    log?.warn?.(`[WS-Out-Adapter] Unsupported msgtype for OpenResponses: ${payload.msgtype}`);
    return false;
  }

  const responseId = `resp_${crypto.randomUUID()}`;
  const itemId = `item_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  // 封装对称的 Envelope 协议
  const sendEnvelope = (eventObj: any) => {
    // 如果上层传入了 conversationId，我们可以把它作为扩充路由字段一起带在事件 data 里
    // 这样服务端可以知道该发给哪个业务会话
    if (target.conversationId) {
      eventObj.conversationId = target.conversationId;
    } else if (payload.conversationId) {
      eventObj.conversationId = payload.conversationId;
    }

    const envelope = {
      type: "MESSAGE",
      headers: {
        messageId: crypto.randomUUID(),
        topic: "/v1.0/im/bot/messages"
      },
      data: JSON.stringify(eventObj)
    };
    const envelopeStr = JSON.stringify(envelope);

    // 详细日志：显示完整的事件内容和文本内容
    let contentPreview = '';
    if (eventObj.type === 'response.output_text.delta') {
      contentPreview = `, text="${eventObj.delta?.text || ''}"`;
    } else if (eventObj.type === 'response.output_item.added') {
      contentPreview = `, item_type=${eventObj.item?.type}`;
    }

    log?.info?.(`[WS发送] 流式响应: type=${eventObj.type}, response_id=${eventObj.response_id || 'N/A'}${contentPreview}, envelope_size=${envelopeStr.length} bytes`);
    log?.info?.(`[WS发送] 完整事件数据: ${JSON.stringify(eventObj).slice(0, 300)}...`);

    socket.send(envelopeStr);
  };

  try {
    // Step 1: response.in_progress
    sendEnvelope({
      type: "response.in_progress",
      response_id: responseId,
      status: "in_progress",
      timestamp: now
    });

    // Step 2: response.output_item.added
    sendEnvelope({
      type: "response.output_item.added",
      response_id: responseId,
      item: {
        id: itemId,
        type: "message",
        status: "in_progress",
        role: "assistant",
        content: [
          {
            type: "output_text",
            status: "in_progress",
            text: ""
          }
        ]
      },
      index: 0,
      timestamp: now
    });

    // Step 3: response.output_text.delta
    sendEnvelope({
      type: "response.output_text.delta",
      response_id: responseId,
      item_id: itemId,
      content_index: 0,
      delta: {
        text: textContent
      },
      timestamp: now
    });

    // Step 4: response.completed
    sendEnvelope({
      type: "response.completed",
      response_id: responseId,
      status: "completed",
      timestamp: now
    });

    log?.info?.(`[WS-Out-Adapter] Successfully sent OpenResponses stream (response_id=${responseId}) via WS`);
    return true;
  } catch (err: any) {
    log?.error?.(`[WS-Out-Adapter] Failed to send OpenResponses stream: ${err.message}`);
    return false;
  }
}
