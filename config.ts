/**
 * IntClaw 插件全局配置
 * 用于集中管理所有外部请求连接
 * 
 * 方便开发者快速替换不同环境的连接地址
 */
export const INTCLAW_CONFIG = {
  /** 
   * IntClaw 新版 API 基础路径
   * 作用：用于获取 Access Token、发送机器人消息、下载文件等核心业务
   */
  API_BASE_URL: 'https://api.intclaw.com',
  
  /** 
   * IntClaw 旧版 OAPI 基础路径
   * 作用：用于媒体文件上传、获取旧版 Token、查询用户信息等
   */
  OAPI_BASE_URL: 'https://oapi.intclaw.com',
  
  /** 
   * WebSocket 连接地址
   * 作用：建立与 IntClaw 服务端的长连接，用于实时接收消息推送
   */
  WS_ENDPOINT: 'wss://claw-dev.int-os.com/user-ws/',
  
  /** 
   * 媒体文件下载基础路径
   * 作用：拼接媒体文件的下载链接，供前端或外部查看
   */
  DOWNLOAD_BASE_URL: 'https://down.intclaw.com',
};
