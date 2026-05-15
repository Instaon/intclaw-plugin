import * as fs from 'fs';
import * as path from 'path';
import { ARTIFACT_UPLOAD_URL, ARTIFACT_HIRE_BIND_URL } from './config';

// ── 上传接口响应结构 ─────────────────────────────────────────────────────────
// 兼容服务端多种字段命名：顶层 url / address，或嵌套在 data 对象内
interface UploadResponseData {
  url?: string;
  address?: string;
}

interface UploadApiResponse extends UploadResponseData {
  data?: UploadResponseData;
}

// ── 绑定接口响应结构 ─────────────────────────────────────────────────────────
interface BindApiResponse {
  code: number;
  message: string;
  data?: {
    id: number;
    name: string;
    address: string;
    user_id: number;
    source: number;
    business_id: string;
    created_at: string;
    updated_at: string;
  };
}

/**
 * 从上传响应中提取文件地址
 * 兼容：顶层 url / address，或 data.url / data.address
 */
function extractAddress(resp: UploadApiResponse): string {
  return resp.url ?? resp.address ?? resp.data?.url ?? resp.data?.address ?? '';
}

/**
 * 将 unknown 类型的 JSON 结果解析为 UploadApiResponse
 * 若结构不符则返回 null
 */
function parseUploadResponse(raw: unknown): UploadApiResponse | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const result: UploadApiResponse = {};

  if (typeof obj['url'] === 'string') result.url = obj['url'];
  if (typeof obj['address'] === 'string') result.address = obj['address'];

  if (obj['data'] !== null && typeof obj['data'] === 'object' && !Array.isArray(obj['data'])) {
    const nested = obj['data'] as Record<string, unknown>;
    result.data = {};
    if (typeof nested['url'] === 'string') result.data.url = nested['url'];
    if (typeof nested['address'] === 'string') result.data.address = nested['address'];
  }

  return result;
}

export const artifactUploadTool = {
  name: "upload_artifact",
  label: "Upload Artifact File (上传产物文件)",
  description: "将产物文件上传到目标地址，并获取文件链接。可发送给用户。多个文件建议先压缩为zip后再使用此工具上传。不要上传无关文件。如果系统提示词中包含【当前会话信息】，请将其中的 sessionId 值传入本工具的 sessionId 参数，以便将产物与当前雇佣会话自动关联。",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "需要上传的本地文件的绝对路径"
      },
      sessionId: {
        type: "string",
        description: "当前雇佣会话的 sessionId。如果处于用户雇佣会话中，必须传入此参数，上传完成后会自动将文件与该会话关联。"
      }
    },
    required: ["filePath"]
  },
  execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: unknown, _onUpdate?: unknown) => {
    try {
      const filePath = typeof params['filePath'] === 'string' ? params['filePath'] : '';
      const sessionId = typeof params['sessionId'] === 'string' ? params['sessionId'] : '';

      // ── Step 1: 检查文件是否存在 ──────────────────────────────────────
      if (!filePath) {
        return {
          content: [{ type: "text" as const, text: 'Missing required parameter: filePath' }],
          details: { ok: false, error: 'Missing required parameter: filePath' },
        };
      }

      if (!fs.existsSync(filePath)) {
        return {
          content: [{ type: "text" as const, text: `File not found: ${filePath}` }],
          details: { ok: false, error: `File not found: ${filePath}` },
        };
      }

      const fileBuffer = await fs.promises.readFile(filePath);
      const filename = path.basename(filePath);
      const blob = new Blob([fileBuffer]);

      // ── Step 2: 上传文件，获取产物地址 ────────────────────────────────
      const formData = new FormData();
      formData.append('file', blob, filename);

      const uploadResponse = await fetch(ARTIFACT_UPLOAD_URL, {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with HTTP status: ${uploadResponse.status}`);
      }

      const rawUploadData: unknown = await uploadResponse.json();
      const uploadData = parseUploadResponse(rawUploadData);

      if (uploadData === null) {
        throw new Error('Upload succeeded but response format is unexpected');
      }

      // ── Step 3: 若存在 sessionId，调绑定接口关联雇佣 session ──────────
      if (sessionId) {
        const address = extractAddress(uploadData);

        if (!address) {
          // 上传成功但无法提取地址，记录警告后仍返回上传结果，不阻断主流程
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                upload: uploadData,
                bindWarning: '上传成功，但无法从响应中提取文件地址，跳过雇佣 session 绑定。',
              }),
            }],
            details: { upload: uploadData, bindWarning: '上传成功，但无法从响应中提取文件地址，跳过雇佣 session 绑定。' },
          };
        }

        const bindPayload = {
          session_id: sessionId,
          address,
          name: filename,
        };

        const bindResponse = await fetch(ARTIFACT_HIRE_BIND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bindPayload),
        });

        if (!bindResponse.ok) {
          // 绑定失败不阻断主流程，附加错误信息后返回
          const bindError = await bindResponse.text().catch(() => `HTTP ${bindResponse.status}`);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                upload: uploadData,
                bindError: `绑定 session 失败: ${bindError}`,
              }),
            }],
            details: { upload: uploadData, bindError },
          };
        }

        const rawBindData: unknown = await bindResponse.json();
        const bindData = rawBindData as BindApiResponse;
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ upload: uploadData, bind: bindData }),
          }],
          details: { upload: uploadData, bind: bindData },
        };
      }

      // ── 无 sessionId：仅返回上传结果 ─────────────────────────────────
      return {
        content: [{ type: "text" as const, text: JSON.stringify(uploadData) }],
        details: uploadData,
      };

    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Upload failed';
      return {
        content: [{ type: "text" as const, text: message }],
        details: { ok: false, error: message },
      };
    }
  }
};
