/**
 * 消息发送基础模块
 * 支持 Markdown、文本、链接等消息类型
 */

import type { IntclawConfig } from '../../types/index.ts';
import { INTCLAW_API, getAccessToken } from '../../utils/token.ts';
import { intclawHttp } from '../../utils/http-client.ts';

/** 消息类型枚举 */
export type IntClawMsgType = 'text' | 'markdown' | 'link' | 'actionCard' | 'image';

/** 主动发送消息的结果 */
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

/**
 * 发送 Markdown 消息
 */
export async function sendMarkdownMessage(
  config: IntclawConfig,
  sessionWebhook: string,
  title: string,
  markdown: string,
  options: any = {},
): Promise<any> {
  const token = await getAccessToken(config);
  let text = markdown;
  if (options.atUserId) text = `${text} @${options.atUserId}`;

  const body: any = {
    msgtype: 'markdown',
    markdown: {
      title,
      text: text,
    },
  };

  if (options.atUserId) {
    body.at = {
      userIds: [options.atUserId],
      isAtAll: false,
    };
  }

  const resp = await intclawHttp.post(sessionWebhook, body, {
    headers: {
      'x-acs-intclaw-access-token': token,
      'Content-Type': 'application/json',
    },
  });

  return resp.data;
}

/**
 * 发送文本消息
 */
export async function sendTextMessage(
  config: IntclawConfig,
  sessionWebhook: string,
  content: string,
  options: any = {},
): Promise<any> {
  const token = await getAccessToken(config);
  let text = content;
  if (options.atUserId) text = `${text} @${options.atUserId}`;

  const body: any = {
    msgtype: 'text',
    text: {
      content: text,
    },
  };

  if (options.atUserId) {
    body.at = {
      userIds: [options.atUserId],
      isAtAll: false,
    };
  }

  const resp = await intclawHttp.post(sessionWebhook, body, {
    headers: {
      'x-acs-intclaw-access-token': token,
      'Content-Type': 'application/json',
    },
  });

  return resp.data;
}

/**
 * 发送链接消息
 */
export async function sendLinkMessage(
  config: IntclawConfig,
  sessionWebhook: string,
  params: {
    title: string;
    text: string;
    picUrl?: string;
    messageUrl: string;
  },
): Promise<any> {
  const token = await getAccessToken(config);

  const body = {
    msgtype: 'link',
    link: {
      title: params.title,
      text: params.text,
      picUrl: params.picUrl,
      messageUrl: params.messageUrl,
    },
  };

  const resp = await intclawHttp.post(sessionWebhook, body, {
    headers: {
      'x-acs-intclaw-access-token': token,
      'Content-Type': 'application/json',
    },
  });

  return resp.data;
}
