/**
 * Minimal RFC 6455 WebSocket server side: handshake + framing. No dependency, because this sidecar
 * runs straight from the bind-mounted checkout with no npm install step. Fragmented messages and
 * extensions (permessage-deflate) are not supported; the browser client never needs them.
 */
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const MAX_PAYLOAD = 1 << 20;

export const acceptKey = (key) => createHash('sha1').update(key + GUID).digest('base64');

/** Writes the 101 response. Returns false (and answers 400) when the request is not a WS upgrade. */
export function handshake(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || typeof key !== 'string') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return false;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
  );
  return true;
}

export function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = data.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, data]);
}

/**
 * Incremental parser for client frames. Calls onFrame(opcode, payload) for each complete frame.
 * Throws on protocol errors (unmasked client frame, oversized payload, fragmentation).
 */
export function createParser(onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80;
      const opcode = buf[0] & 0x0f;
      const masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) throw new Error('payload too large');
        len = Number(big);
        off = 10;
      }
      if (!masked) throw new Error('client frames must be masked');
      if (!fin || opcode === 0) throw new Error('fragmented frames are not supported');
      if (len > MAX_PAYLOAD) throw new Error('payload too large');
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      onFrame(opcode, payload);
    }
  };
}

/** Wraps an upgraded socket: { send(text|Buffer), close(), onMessage, onClose }. */
export function wrap(socket, { onMessage, onClose }) {
  let closed = false;
  const close = (code = 1000) => {
    if (closed) return;
    closed = true;
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code);
    socket.end(encodeFrame(0x8, body));
    onClose?.();
  };
  const parse = createParser((opcode, payload) => {
    if (opcode === 0x1) onMessage(payload.toString('utf8'), false);
    else if (opcode === 0x2) onMessage(payload, true);
    else if (opcode === 0x8) close();
    else if (opcode === 0x9) socket.write(encodeFrame(0xa, payload));
  });
  socket.on('data', (chunk) => {
    try {
      parse(chunk);
    } catch {
      close(1002);
    }
  });
  socket.on('close', () => {
    if (!closed) {
      closed = true;
      onClose?.();
    }
  });
  socket.on('error', () => socket.destroy());
  return {
    send: (data) => !closed && socket.write(encodeFrame(typeof data === 'string' ? 0x1 : 0x2, data)),
    close
  };
}
