'use strict';
const crypto = require('node:crypto');
const { encodeWaddle, CHUNK_SIZE } = require('../../src/protocol');
function send(ws, data) { return new Promise((resolve, reject) => ws.send(data, err => err ? reject(err) : resolve())); }
function waitForAck(ws, expected, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('ACK timeout')), timeoutMs);
    function cleanup() { clearTimeout(timer); ws.off('message', onMessage); ws.off('close', onClose); ws.off('error', onError); }
    function finish(err) { cleanup(); err ? reject(err) : resolve(); }
    function onMessage(data, binary) {
      if (binary) return finish(new Error('Unexpected binary message while waiting for ACK'));
      let obj; try { obj = JSON.parse(data.toString()); } catch { return finish(new Error('Invalid ACK control message')); }
      if (obj.type !== 'ACK' || obj.index !== expected) return finish(new Error('Unexpected or out-of-order ACK'));
      finish();
    }
    function onClose() { finish(new Error('Client disconnected')); }
    function onError(e) { finish(e); }
    ws.on('message', onMessage); ws.once('close', onClose); ws.once('error', onError);
  });
}
async function transfer(ws, file, config) {
  const chunkSize = CHUNK_SIZE, hash = crypto.createHash('sha256'); let offset = 0, index = 0;
  const info = { type: 'FILE_INFO', filename: file.filename, size: file.size, chunkSize, totalChunks: Math.ceil(file.size / chunkSize), sha256: null };
  // Hash the open file handle, then verify its identity and metadata before sending.
  const hashStream = file.handle.createReadStream({ start: 0, autoClose: false });
  for await (const chunk of hashStream) hash.update(chunk);
  const afterHash = await file.handle.stat();
  if (afterHash.size !== file.initialStat.size || afterHash.mtimeMs !== file.initialStat.mtimeMs || afterHash.ino !== file.initialStat.ino) throw new Error('Source changed during transfer preparation');
  info.sha256 = hash.digest('hex'); await send(ws, JSON.stringify(info));
  for (; index < info.totalChunks; index++) {
    const length = Math.min(chunkSize, file.size - offset), buffer = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) { const r = await file.handle.read(buffer, read, length - read, offset + read); if (!r.bytesRead) throw new Error('Source changed during transfer'); read += r.bytesRead; }
    await send(ws, JSON.stringify({ type: 'CHUNK', index, length }));
    await send(ws, encodeWaddle(buffer));
    await waitForAck(ws, index, config.ackTimeoutMs);
    offset += length;
  }
  const finalStat = await file.handle.stat();
  if (offset !== file.size || finalStat.size !== file.initialStat.size || finalStat.mtimeMs !== file.initialStat.mtimeMs || finalStat.ino !== file.initialStat.ino) throw new Error('Source changed during transfer');
  await send(ws, JSON.stringify({ type: 'TRANSFER_COMPLETE', size: file.size, sha256: info.sha256 }));
}
module.exports = { transfer, waitForAck };
