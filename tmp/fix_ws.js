const fs = require("fs");

let content = fs.readFileSync("src/core/connection.ts", "utf8");

// Remove proxy fix and dingtalk-stream import (lines ~104-137)
content = content.replace(
  /\s*\/\/ 🔧 修复代理问题.*?\n(.*?\n)+?\s*keepAlive: false.*?\n\s*} as any\);/m,
  `
  // 动态导入 ws 模块
  const wsModule = await import("ws");
  const WebSocket = wsModule.default;

  // 包装器，兼容原有的 client 接口
  const client = {
    socket: null as import("ws").WebSocket | null,
    messageHandler: null as ((res: any) => void) | null,
    
    // 连接
    connect: async () => {
      return new Promise<void>((resolve, reject) => {
        const endpoint = account.config.endpoint || "wss://claw-dev.int-os.com/user-ws/";
        const headers = {
          "x-app-key": String(account.clientId),
          "x-app-secret": String(account.clientSecret),
        };
        
        logger.info(\`开始连接 WebSocket: \${endpoint}\`);
        const ws = new WebSocket(endpoint, { headers });
        
        const onOpen = () => {
          ws.removeListener('error', onError);
          client.socket = ws;
          rebindListeners();
          resolve();
        };
        
        const onError = (err: any) => {
          ws.removeListener('open', onOpen);
          reject(err);
        };
        
        ws.once('open', onOpen);
        ws.once('error', onError);
      });
    },
    
    // 断开
    disconnect: async () => {
      if (client.socket) {
        client.socket.removeAllListeners();
        client.socket.terminate();
        client.socket = null;
      }
    },
    
    // 回复响应
    socketCallBackResponse: (messageId: string, payload: any) => {
      if (client.socket && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(JSON.stringify({
          headers: { messageId },
          data: payload
        }));
      }
    },
    
    // 注册消息处理
    registerCallbackListener: (topic: string, handler: (res: any) => void) => {
      client.messageHandler = handler;
    },
    
    // 兼容原有的 client.on
    on: (evt: string, cb: any) => {}
  };`
);

// We need to define rebindListeners and replace setupPongListener, setupMessageListener, setupCloseListener
content = content.replace(
  /  \/\*\* 监听 pong 响应（更新 socket 可用时间） \*\/([\s\S]*?)  \/\*\* 监听 WebSocket close 事件，服务端主动断开时立即触发重连 \*\/\n  function setupCloseListener\(\) {[\s\S]*?  }/m,
  `  /** 重新绑定所有 WebSocket 事件监听器 */
  function rebindListeners() {
    if (!client.socket) return;
    
    client.socket.on("pong", () => {
      lastSocketAvailableTime = Date.now();
      logger.debug(\`收到 PONG 响应\`);
    });

    client.socket.on("message", (data: any) => {
      try {
        const payload = Object.prototype.toString.call(data) === '[object Buffer]' ? data.toString() : data;
        const msg = JSON.parse(payload);
        
        // 检查 disconnect 类型
        if (msg.type === "SYSTEM" && msg.headers?.topic === "disconnect") {
          if (!isStopped && !isReconnecting) {
            doReconnect(true).catch((err) => {
              log?.error?.(\`[\${accountId}] 重连失败：\${err.message}\`);
            });
          }
          return;
        }
        
        // 派发给外部 handler
        // 包装使得格式类似于原先 dingtalk-stream 返回的格式，即含 headers 与 data
        // 假设原本的新接口推送数据也有相近格式，如如果本身就是 payload，直接传给 handler
        if (client.messageHandler) {
          // 如果原生 WS 收到的消息并没有分为 headers 和 data，而是扁平的
          // 需要根据实际情况适配。这里兼容旧版的 headers 和 data 结构。
          const res = msg.headers ? msg : { headers: { messageId: msg.msgId || msg.messageId }, data: payload };
          client.messageHandler(res);
        }
      } catch (e) {
        // 忽略解析错误或将其交给 handler
      }
    });

    client.socket.on("close", (code, reason) => {
      logger.info(
        \`WebSocket close: code=\${code}, reason=\${reason || "未知"}, isStopped=\${isStopped}\`
      );

      if (isStopped) {
        return;
      }

      setTimeout(() => {
        doReconnect(true).catch((err) => {
          log?.error?.(\`重连失败：\${err.message}\`);
        });
      }, 0);
    });
    
    client.socket.on("error", (err) => {
      log?.error?.(\`WebSocket Error: \${err.message}\`);
    });
  }`
);

// Remove the old setupCalls
content = content.replace(
  /  \/\/ 初始化：设置所有事件监听器\n  setupPongListener\(\);\n  setupMessageListener\(\);\n  setupCloseListener\(\);/m,
  `  // 事件监听将在 connect() 中的 onOpen 中绑定`
);

// We need to change the TOPIC_ROBOT parameter, since we no longer have it from dingtalk-stream
content = content.replace(
  /client\.registerCallbackListener\(TOPIC_ROBOT, async \(res: any\) => \{/m,
  `client.registerCallbackListener("robot", async (res: any) => {`
);

// We need to make sure we don't have lingering `import dingtalk-stream` at the top or type references.
content = content.replace(
  /import type \{ IntclawReactionCreatedEvent \} from "\.\.\/types\/index\.ts";/,
  `// (import removed)`
);


fs.writeFileSync("src/core/connection.ts", content);
console.log("connection.ts updated successfully");
