import * as fs from 'fs';
import * as path from 'path';
import type { AgentToolResult } from 'openclaw/plugin-sdk';

export const artifactUploadTool = {
  name: "upload_artifact",
  label: "Upload Artifact File (上传产物文件)",
  description: "将产物文件上传到目标地址，并获取文件链接。可发送给用户。多个文件建议先压缩为zip后再使用此工具上传。不要上传无关文件。",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "需要上传的本地文件的绝对路径"
      }
    },
    required: ["filePath"]
  },
  execute: async (toolCallId: string, params: any, signal?: any, onUpdate?: any): Promise<AgentToolResult<unknown>> => {
    try {
      const { filePath } = params;
      if (!fs.existsSync(filePath)) {
        return { result: null, error: `File not found: ${filePath}` }; 
      }
      
      const fileBuffer = await fs.promises.readFile(filePath);
      const filename = path.basename(filePath);
      const blob = new Blob([fileBuffer]);
      
      const formData = new FormData();
      formData.append('file', blob, filename);
      
      const response = await fetch('http://claw-dev.int-os.com/artifact/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return { result: data }; 
    } catch (e: any) {
      return { result: null, error: e.message || 'Upload failed' };
    }
  }
};
