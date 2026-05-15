import * as fs from 'fs';
import * as path from 'path';
import { ARTIFACT_UPLOAD_URL, ARTIFACT_HIRE_BIND_URL } from './config';

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
  execute: async (_toolCallId: string, params: any, _signal?: any, _onUpdate?: any) => {
    try {
      const { filePath, sessionId } = params;

      // ── Step 1: 检查文件是否存在 ──────────────────────────────────────
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

      const uploadData = await uploadResponse.json();

      // ── Step 3: 若存在 sessionId，调绑定接口关联雇佣 session ──────────
      if (sessionId) {
        // 从上传响应中提取文件地址（兼容常见的 url / address / data.url 字段）
        const address: string = uploadData?.url ?? uploadData?.address ?? uploadData?.data?.url ?? uploadData?.data?.address ?? '';

        if (!address) {
          // 上传成功但无法提取地址，记录警告后仍返回上传结果，不阻断主流程
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                ...uploadData,
                bindWarning: '上传成功，但无法从响应中提取文件地址，跳过雇佣 session 绑定。',
              }),
            }],
            details: uploadData,
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

        const bindData = await bindResponse.json();
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

    } catch (e: any) {
      const message = e.message || 'Upload failed';
      return {
        content: [{ type: "text" as const, text: message }],
        details: { ok: false, error: message },
      };
    }
  }
};
