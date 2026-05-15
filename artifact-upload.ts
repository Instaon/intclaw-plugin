import * as fs from 'fs';
import * as path from 'path';
import { ARTIFACT_UPLOAD_URL } from './config';

export const artifactUploadTool = {
  name: "upload_artifact",
  label: "Upload Artifact File (上传产物文件)",
  description: "将产物文件上传到目标地址，并获取文件链接。可发送给用户。多个文件建议先压缩为zip后再使用此工具上传。不要上传无关文件。如果当前处于某个用户会话中，请务必同时传入 sessionId 参数，以便将上传文件与会话关联。",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "需要上传的本地文件的绝对路径"
      },
      sessionId: {
        type: "string",
        description: "当前会话的 sessionId。如果处于用户会话中，必须传入此参数，以便将上传文件与该会话关联。"
      }
    },
    required: ["filePath"]
  },
  execute: async (_toolCallId: string, params: any, _signal?: any, _onUpdate?: any) => {
    try {
      const { filePath, sessionId } = params;
      if (!fs.existsSync(filePath)) {
        return {
          content: [{ type: "text" as const, text: `File not found: ${filePath}` }],
          details: { ok: false, error: `File not found: ${filePath}` },
        };
      }
      
      const fileBuffer = await fs.promises.readFile(filePath);
      const filename = path.basename(filePath);
      const blob = new Blob([fileBuffer]);
      
      const formData = new FormData();
      formData.append('file', blob, filename);
      
      const uploadUrl = new URL(ARTIFACT_UPLOAD_URL);
      if (sessionId) {
        uploadUrl.searchParams.append('sessionId', sessionId);
      }
      
      const response = await fetch(uploadUrl.toString(), {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
        details: data,
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
