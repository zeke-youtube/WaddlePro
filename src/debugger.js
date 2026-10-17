'use strict';
const fs = require('node:fs/promises');
class WaddleDebugger {
  constructor(output = console.log) { this.enabled = false; this.entries = []; this.output = output; }
  log(direction, message, sensitive = false) {
    if (!this.enabled) return;
    const safe = sensitive ? '[REDACTED]' : String(message);
    const line = `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${direction.padEnd(3)} ${safe}`;
    this.entries.push(line); this.output(line);
  }
  message(direction, data) {
    if (typeof data !== 'string') return this.log(direction, 'binary WebSocket message rejected');
    if (/^[WA]*$/.test(data) && data.length > 0 && data.length % 8 === 0) {
      this.log(direction, `W/A PAYLOAD (${data.length} chars) preview=${data.slice(0, 32)}${data.length > 32 ? '…' : ''}`);
      return;
    }
    try {
      const obj = JSON.parse(data);
      if (obj.type === 'AUTH') return this.log(direction, 'AUTH [REDACTED]', true);
      const summary = obj.type === 'GET' ? `GET ${obj.filename}` : obj.type === 'FILE_INFO' ? `FILE_INFO size=${obj.size} chunks=${obj.totalChunks}` : obj.type === 'CHUNK' ? `CHUNK ${obj.index} length=${obj.length}` : obj.type === 'ACK' ? `ACK ${obj.index}` : obj.type === 'TRANSFER_COMPLETE' ? 'TRANSFER_COMPLETE' : obj.type === 'ERROR' ? `ERROR ${obj.code || ''} ${obj.message || ''}` : JSON.stringify(obj);
      this.log(direction, summary);
    } catch { this.log(direction, data); }
  }
  async export(filename) { await fs.writeFile(filename, this.entries.join('\n') + (this.entries.length ? '\n' : ''), { encoding: 'utf8', mode: 0o600 }); }
}
module.exports = { WaddleDebugger };
