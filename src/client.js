'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const WebSocket = require('ws');
const { CHUNK_SIZE, decodeWaddle, imageType, validFilename } = require('./protocol');
const { DEFAULT_PORT, resolveWaddleDomain } = require('./waddle-domain');

function parseDownloadSpec(input) {
  const at = input.lastIndexOf('@');
  if (at < 1 || at === input.length - 1) throw new Error('Use: download FILENAME@HOST:PORT');
  const filename = input.slice(0, at), endpoint = input.slice(at + 1);
  if (!validFilename(filename)) throw new Error('Filename must be a plain .png, .gif, or .jpg filename');
  let host, portText, port, hasExplicitPort = false;
  if (/\.waddle(?::\d{1,5})?$/i.test(endpoint)) {
    const match = /^(.+\.waddle)(?::(\d{1,5}))?$/i.exec(endpoint);
    if (!match) throw new Error('Invalid .waddle domain or port');
    host = match[1];
    if (!require('./waddle-domain').validateDomain(host)) throw new Error('Invalid .waddle domain');
    hasExplicitPort = match[2] !== undefined;
    port = hasExplicitPort ? Number(match[2]) : undefined;
    if (hasExplicitPort && (port < 1 || port > 65535)) throw new Error('Port must be from 1 to 65535');
    return { filename, host, port, hasExplicitPort, isWaddleDomain: true };
  }
  if (endpoint.startsWith('[')) {
    const m = /^\[([0-9a-fA-F:.]+)\](?::(\d{1,5}))?$/.exec(endpoint); if (!m || require('node:net').isIP(m[1]) !== 6) throw new Error('Invalid host or port');
    host = m[1]; portText = m[2]; hasExplicitPort = portText !== undefined;
  } else {
    const m = /^([^:@/\\]+)(?::(\d{1,5}))?$/.exec(endpoint); if (!m) throw new Error('Invalid host or port');
    host = m[1]; portText = m[2]; hasExplicitPort = portText !== undefined;
    const net = require('node:net');
    if (net.isIP(host) === 0 && (host.includes('..') || host.split('.').some(label => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)))) throw new Error('Invalid hostname');
  }
  port = portText === undefined ? DEFAULT_PORT : Number(portText);
  if (port < 1 || port > 65535) throw new Error('Port must be from 1 to 65535');
  return { filename, host, port, hasExplicitPort, isWaddleDomain: false };
}
function waitMessage(ws, timeoutMs, debug) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('WebSocket response timed out')), timeoutMs);
    function onMessage(data, isBinary) { debug.message('IN', isBinary ? '' : data.toString()); done(null, { data: isBinary ? null : data.toString(), isBinary }); }
    function onError(err) { done(err); }
    function onClose() { done(new Error('Server disconnected')); }
    function done(err, result) { clearTimeout(timer); ws.off('message', onMessage); ws.off('error', onError); ws.off('close', onClose); err ? reject(err) : resolve(result); }
    ws.once('message', onMessage); ws.once('error', onError); ws.once('close', onClose);
  });
}
function send(ws, object, debug) { const text = typeof object === 'string' ? object : JSON.stringify(object); debug.message('OUT', text); return new Promise((resolve, reject) => ws.send(text, err => err ? reject(err) : resolve())); }
function waitOpen(ws, timeoutMs) { return new Promise((resolve, reject) => { const t = setTimeout(() => done(new Error('Connection timed out')), timeoutMs); function done(err) { clearTimeout(t); ws.off('open', open); ws.off('error', error); err ? reject(err) : resolve(); } function open() { done(); } function error(e) { done(e); } ws.once('open', open); ws.once('error', error); }); }
async function promptPassword(input = process.stdin, output = process.stdout) {
  output.write('Password: ');
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    const rl = readline.createInterface({ input, output, terminal: false });
    return new Promise(resolve => rl.once('line', line => { rl.close(); output.write('\n'); resolve(line); }));
  }
  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw; input.setRawMode(true); input.resume(); let value = '';
    const cleanup = () => { input.off('data', onData); input.setRawMode(!!wasRaw); output.write('\n'); };
    const onData = chunk => {
      for (const c of chunk.toString()) {
        if (c === '\r' || c === '\n') { cleanup(); resolve(value); return; }
        if (c === '\u0003') { cleanup(); reject(new Error('Password entry interrupted')); return; }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1); else value += c;
      }
    };
    input.on('data', onData);
  });
}
async function confirmInsecureDomain(output = process.stdout, input = process.stdin) {
  output.write('This .waddle server is remote and uses unencrypted WebSockets. Send Waddle ID credentials anyway? [y/N] ');
  const rl = readline.createInterface({ input, output, terminal: !!input.isTTY });
  return new Promise(resolve => rl.once('line', answer => { rl.close(); resolve(/^y(?:es)?$/i.test(answer.trim())); }));
}
async function download(spec, options = {}) {
  const { filename } = spec;
  const debug = options.debugger || { log() {}, message() {} };
  const secure = spec.isWaddleDomain ? false : !!options.secure;
  let { host, port } = spec;
  if (spec.isWaddleDomain) {
    const output = options.output || console.log;
    output(`[WADDLE] Resolving ${spec.host}...`);
    const resolved = resolveWaddleDomain(spec.host, spec.hasExplicitPort ? spec.port : undefined, options.registry);
    if (!resolved) {
      (options.output || console.log)('ERROR: WADDLE DOMAIN NOT FOUND');
      throw new Error('WADDLE DOMAIN NOT FOUND');
    }
    host = resolved.ip; port = resolved.port;
    output(`[WADDLE] Resolved: ${host}:${port}`);
    output('[WADDLE] Connecting...');
  }
  const ws = new WebSocket(`${secure ? 'wss' : 'ws'}://${host.includes(':') ? `[${host}]` : host}:${port}`, { maxPayload: CHUNK_SIZE * 8 + 4096, rejectUnauthorized: options.rejectUnauthorized !== false });
  const timeout = options.timeoutMs || 30000;
  const inbox = [];
  const waiters = [];
  ws.on('message', (data, isBinary) => {
    const entry = { data: isBinary ? null : data.toString(), isBinary };
    debug.message('IN', entry.isBinary ? '' : entry.data);
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(entry); else inbox.push(entry);
  });
  ws.on('error', error => { while (waiters.length) waiters.shift().reject(error); });
  ws.on('close', () => { while (waiters.length) waiters.shift().reject(new Error('Server disconnected')); });
  function nextMessage(timeoutMs) {
    if (inbox.length) return Promise.resolve(inbox.shift());
    return new Promise((resolve, reject) => {
      const waiter = { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => { const i = waiters.indexOf(waiter); if (i >= 0) waiters.splice(i, 1); reject(new Error('WebSocket response timed out')); }, timeoutMs);
      waiters.push(waiter);
    });
  }
  let tempPath, handle, digest, total = 0, completed = false;
  try {
    ws.on('open', () => debug.log('EVT', `connected to ${host}:${port}`));
    await waitOpen(ws, timeout);
    let reply = await nextMessage(10000);
    if (reply.isBinary || reply.data !== 'Waddle Server Connected') throw new Error('Invalid server handshake');
    await send(ws, 'Waddle Client Connected', debug);
    reply = await nextMessage(timeout);
    if (reply.data === 'Waddle ID Required : Password') {
      const local = ['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase());
      (options.output || console.log)('Server: Waddle ID Required : Password');
      if (!secure && !local) {
        (options.output || console.log)('WARNING: This connection uses unencrypted WebSockets; credentials can be intercepted.');
        const approved = spec.isWaddleDomain && options.confirmInsecureCredentials
          ? await options.confirmInsecureCredentials()
          : spec.isWaddleDomain ? await confirmInsecureDomain() : false;
        if (!approved) throw new Error('Refusing to send Waddle ID over an insecure non-local connection');
      }
      const password = await (options.passwordProvider ? options.passwordProvider() : promptPassword());
      await send(ws, { type: 'AUTH', password }, debug);
      reply = await nextMessage(timeout);
      if (reply.data !== 'Waddle ID Accepted') throw new Error(reply.data === 'Invalid Waddle ID' ? 'Invalid Waddle ID' : 'Unexpected authentication response');
    } else if (reply.data !== 'READY') throw new Error(`Unexpected server response: ${reply.data}`);
    await send(ws, { type: 'GET', filename }, debug);
    reply = await nextMessage(timeout);
    if (!reply.data) throw new Error('Expected FILE_INFO response');
    let info; try { info = JSON.parse(reply.data); } catch { throw new Error('Invalid server control message'); }
    if (info.type === 'ERROR') throw new Error(info.message || `Server error ${info.code}`);
    if (info.type !== 'FILE_INFO' || info.filename !== filename) throw new Error('Invalid file metadata');
    if (!Number.isSafeInteger(info.size) || info.size < 1 || !Number.isSafeInteger(info.totalChunks) || info.totalChunks !== Math.ceil(info.size / CHUNK_SIZE) || info.chunkSize !== CHUNK_SIZE || !/^[a-f0-9]{64}$/.test(info.sha256)) throw new Error('Invalid file metadata');
    const ext = path.extname(filename).toLowerCase(), dest = path.join(process.cwd(), `WaddlePro-Download${ext}`);
    tempPath = path.join(process.cwd(), `.waddlepro-${process.pid}-${crypto.randomBytes(12).toString('hex')}.tmp`);
    handle = await fsp.open(tempPath, 'wx', 0o600); digest = crypto.createHash('sha256');
    for (let index = 0; index < info.totalChunks; index++) {
      const h = await nextMessage(timeout);
      if (h.isBinary) throw new Error('Unexpected binary chunk header');
      let header; try { header = JSON.parse(h.data); } catch { throw new Error('Invalid chunk header'); }
      const expectedLength = Math.min(CHUNK_SIZE, info.size - total);
      if (header.type !== 'CHUNK' || header.index !== index || header.length !== expectedLength) throw new Error('Invalid chunk order or length');
      const p = await nextMessage(timeout);
      if (p.isBinary || p.data.length !== expectedLength * 8) throw new Error('Invalid chunk payload');
      const bytes = decodeWaddle(p.data, CHUNK_SIZE);
      if (bytes.length !== expectedLength) throw new Error('Decoded chunk length mismatch');
      await handle.write(bytes); digest.update(bytes); total += bytes.length;
      (options.output || console.log)(`Chunk ${index + 1}/${info.totalChunks} received [ACK]`);
      await send(ws, { type: 'ACK', index }, debug);
    }
    reply = await nextMessage(timeout);
    let done; try { done = JSON.parse(reply.data); } catch { throw new Error('Missing transfer completion'); }
    if (done.type !== 'TRANSFER_COMPLETE' || done.sha256 !== info.sha256 || done.size !== info.size) throw new Error('Invalid transfer completion');
    if (total !== info.size) throw new Error('Downloaded byte count mismatch');
    const actual = digest.digest('hex');
    if (actual !== info.sha256) throw new Error('SHA-256 MISMATCH');
    await handle.sync(); await handle.close(); handle = null;
    const signatureHandle = await fsp.open(tempPath, 'r'); const sig = Buffer.alloc(8); await signatureHandle.read(sig, 0, 8, 0); await signatureHandle.close();
    if (imageType(sig) !== ext.slice(1)) throw new Error('Image signature does not match filename extension');
    try { await fsp.access(dest); if (options.output) options.output(`Existing ${path.basename(dest)} found.\nOverwriting...`); } catch {}
    await replaceFile(tempPath, dest); tempPath = null; completed = true;
    (options.output || console.log)(`Saved: ${dest}`);
    return { path: dest, size: total, sha256: actual };
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (tempPath) await fsp.unlink(tempPath).catch(() => {});
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    debug.log('EVT', completed ? 'transfer complete' : 'connection closed');
  }
}
async function replaceFile(temp, dest) {
  try { await fsp.rename(temp, dest); }
  catch (e) {
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(e.code)) throw e;
    const backup = `${dest}.waddlepro-backup-${crypto.randomBytes(6).toString('hex')}`;
    let moved = false;
    try {
      try { await fsp.rename(dest, backup); moved = true; } catch (x) { if (x.code !== 'ENOENT') throw x; }
      await fsp.rename(temp, dest);
      if (moved) await fsp.unlink(backup).catch(() => {});
    } catch (error) {
      if (moved) await fsp.rename(backup, dest).catch(() => {});
      throw error;
    }
  }
}
module.exports = { parseDownloadSpec, download, promptPassword, confirmInsecureDomain, replaceFile };
