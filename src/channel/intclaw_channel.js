/**
 * ---
 * status: active
 * birth_time: "2026-03-19T09:42:00Z"
 * original_intent: "Provide IntClaw bidirectional websocket channel and proxy messages to OpenClaw gateway using chunked streaming"
 * version_count: 1
 * ---
 */

import WebSocket from 'ws';

export async function start_intclaw_channel(gateway, config) {
  const ws_url = config.wsUrl || 'wss://claw-dev.int-os.com/user-ws/';
  
  const ws_conn = new WebSocket(ws_url, {
    headers: {
      'X-App-Key': config.appKey,
      'X-App-Secret': config.appSecret
    }
  });

  ws_conn.on('open', () => {
    const auth_payload = {
      type: 'auth_request',
      app_key: config.appKey,
      timestamp: Date.now()
    };
    ws_conn.send(JSON.stringify(auth_payload));
  });

  ws_conn.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'auth_response') {
        if (msg.success && gateway.notifyChannelReady) {
          await gateway.notifyChannelReady('intclaw');
        }
      } else if (msg.type === 'incoming_message') {
        process_incoming_message(msg.payload, ws_conn, config);
      } else if (msg.type === 'ping') {
        ws_conn.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (err) {
      console.error(JSON.stringify({ error: "failed_to_handle_msg", reason: err.message }));
    }
  });

  ws_conn.on('error', (err) => {
    console.error(JSON.stringify({ error: "ws_error", reason: err.message }));
  });

  ws_conn.on('close', (code, reason) => {
    console.log(JSON.stringify({ event: "ws_closed", code, reason: reason?.toString() }));
    setTimeout(() => {
      start_intclaw_channel(gateway, config);
    }, 5000);
  });
  
  return ws_conn;
}

async function process_incoming_message(payload, ws_conn, config) {
  const session_context = {
    channel: 'intclaw',
    account_id: payload.accountId || 'default',
    chat_type: payload.peerKind || 'direct',
    peer_id: payload.peerId
  };
  
  const session_key = JSON.stringify(session_context);
  const user_content = payload.text;
  
  try {
    for await (const chunk of stream_from_gateway(user_content, session_key, config)) {
      send_stream_chunk(ws_conn, payload, chunk, false);
    }
    // send end of stream marker
    send_stream_chunk(ws_conn, payload, "", true);
  } catch (err) {
    console.error(JSON.stringify({ error: "gateway_stream_failed", reason: err.message }));
  }
}

async function* stream_from_gateway(user_content, session_key, config) {
  const port = config.gatewayPort || 18789;
  const url = `http://127.0.0.1:${port}/v1/chat/completions`;
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OpenClaw-Agent-Id': 'main'
    },
    body: JSON.stringify({
      model: 'main',
      messages: [{ role: 'user', content: user_content }],
      stream: true,
      user: session_key
    })
  });
  
  if (!resp.ok) {
    const err_text = await resp.text();
    throw new Error(`status_${resp.status}_${err_text}`);
  }
  
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      
      try {
        const chunk_obj = JSON.parse(data);
        const content = chunk_obj.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch (e) {
        // partial chunk, ignore
      }
    }
  }
}

function send_stream_chunk(ws_conn, incoming_payload, chunk_text, is_done) {
  if (ws_conn.readyState !== WebSocket.OPEN) return;
  
  const out_msg = {
    type: 'outgoing_message',
    payload: {
      id: `intclaw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      account_id: incoming_payload.accountId || 'default',
      peer_id: incoming_payload.peerId,
      peer_kind: incoming_payload.peerKind,
      text: chunk_text,
      reply_to_id: incoming_payload.id,
      timestamp: Date.now(),
      is_chunk: true,
      is_done: is_done
    }
  };
  
  ws_conn.send(JSON.stringify(out_msg));
}
