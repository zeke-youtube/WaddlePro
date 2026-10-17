#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const WebSocket = require('ws');
const { resolveImage } = require('./src/files');
const { transfer } = require('./src/transfer');
const { verifyPassword, writeVerifierFile } = require('./src/authentication');
function loadConfig() {
  const config = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  if (process.env.WADDLE_HOST) config.host = process.env.WADDLE_HOST;
  if (process.env.WADDLE_PORT) config.port = Number(process.env.WADDLE_PORT);
  if (process.env.WADDLE_IMAGE_DIRECTORY) config.imageDirectory = process.env.WADDLE_IMAGE_DIRECTORY;
  if (process.env.WADDLE_REQUIRE_ID !== undefined) config.requireWaddleID = /^(1|true|yes)$/i.test(process.env.WADDLE_REQUIRE_ID);
  if (process.env.WADDLE_MAX_FILE_SIZE_MB) config.maxFileSizeMB = Number(process.env.WADDLE_MAX_FILE_SIZE_MB);
  if (process.env.WADDLE_ACK_TIMEOUT_MS) config.ackTimeoutMs = Number(process.env.WADDLE_ACK_TIMEOUT_MS);
  if (config.chunkSizeBytes !== 1048576) throw new Error('chunkSizeBytes must be 1048576 in v1.0');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || !Number.isFinite(config.maxFileSizeMB) || config.maxFileSizeMB < 1) throw new Error('Invalid server configuration');
  config.imageDirectory = path.resolve(__dirname, config.imageDirectory); return config;
}
function message(ws, timeout) { return new Promise((resolve, reject) => {
  const timer = setTimeout(() => done(new Error('Message timeout')), timeout);
  function onMessage(data, binary) { done(null, { data: data.toString(), binary }); }
  function onError(e) { done(e); } function onClose() { done(new Error('Client disconnected')); }
  function done(err, result) { clearTimeout(timer); ws.off('message', onMessage); ws.off('error', onError); ws.off('close', onClose); err ? reject(err) : resolve(result); }
  ws.once('message', onMessage); ws.once('error', onError); ws.once('close', onClose);
}); }
function sendText(ws, text) { return new Promise((resolve, reject) => ws.send(text, e => e ? reject(e) : resolve())); }
function control(ws, code, messageText) { return sendText(ws, JSON.stringify({ type: 'ERROR', code, message: messageText })); }
async function handleClient(ws, config, secret) {
  const remote = ws._socket?.remoteAddress || 'unknown'; console.log(`Client connected: ${remote}`); let file;
  const timer = setTimeout(() => ws.close(1008, 'Handshake timeout'), config.handshakeTimeoutMs);
  try {
    await sendText(ws, 'Waddle Server Connected');
    let msg = await message(ws, config.handshakeTimeoutMs);
    if (msg.binary || msg.data !== 'Waddle Client Connected') throw new Error('Invalid handshake');
    clearTimeout(timer);
    if (config.requireWaddleID) {
      await sendText(ws, 'Waddle ID Required : Password'); let failed = 0;
      while (failed < 5) {
        msg = await message(ws, 30000); let auth; try { auth = JSON.parse(msg.data); } catch { throw new Error('Invalid authentication message'); }
        const accepted = !msg.binary && auth.type === 'AUTH' && typeof auth.password === 'string' && verifyPassword(auth.password, secret);
        if (accepted) { await sendText(ws, 'Waddle ID Accepted'); break; }
        failed++; await sendText(ws, 'Invalid Waddle ID'); if (failed >= 5) throw new Error('Authentication rate limit reached');
      }
    } else await sendText(ws, 'READY');
    msg = await message(ws, 30000); if (msg.binary) throw new Error('Expected JSON GET request');
    let request; try { request = JSON.parse(msg.data); } catch { throw new Error('Invalid request'); }
    if (request.type !== 'GET' || typeof request.filename !== 'string') throw new Error('Invalid request');
    console.log(`GET ${request.filename} from ${remote}`);
    const result = await resolveImage(config.imageDirectory, request.filename, config.maxFileSizeMB * 1024 * 1024);
    if (result.error) { await control(ws, result.error, result.message); return; }
    file = result; await transfer(ws, file, config); console.log(`Transfer complete: ${file.filename} to ${remote}`);
  } catch (error) {
    if (ws.readyState === WebSocket.OPEN) try { await control(ws, 'TRANSFER_FAILED', error.message); } catch {}
    console.error(`Client ${remote}: ${error.message}`);
  } finally {
    clearTimeout(timer); if (file?.handle) await file.handle.close().catch(() => {}); if (ws.readyState === WebSocket.OPEN) ws.close();
  }
}
async function setupWaddleID(config) {
  if (!config.requireWaddleID) return null;
  const file = path.join(__dirname, 'waddle-id.json'); try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!process.stdin.isTTY) throw new Error('Waddle ID is enabled but verifier file is missing; run interactively once to set it.');
  const ask = prompt => new Promise(resolve => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(prompt, answer => { rl.close(); resolve(answer); }); });
  const password = await ask('New Waddle ID password: '), confirmation = await ask('Confirm Waddle ID password: ');
  if (!password || password !== confirmation) throw new Error('Waddle ID values are empty or do not match');
  const record = writeVerifierFile(file, password); console.log('Waddle ID verifier saved.'); return record;
}
async function startServer() {
  const config = loadConfig(); await fs.mkdir(config.imageDirectory, { recursive: true }); const secret = await setupWaddleID(config);
  const wss = new WebSocket.Server({ host: config.host, port: config.port, maxPayload: 1048576 * 8 + 4096, perMessageDeflate: false });
  wss.on('connection', ws => { handleClient(ws, config, secret).catch(e => console.error(e)); });
  await new Promise((resolve, reject) => { wss.once('listening', resolve); wss.once('error', reject); });
  console.log(`WADDLEPROSERVER listening on ${config.host}:${config.port}`); let stopping = false;
  const shutdown = () => { if (stopping) return; stopping = true; console.log('Shutting down WADDLEPROSERVER...'); for (const client of wss.clients) client.close(1001, 'Server shutting down'); wss.close(() => process.exit(0)); setTimeout(() => process.exit(1), 5000).unref(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown); return wss;
}
if (require.main === module) startServer().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { loadConfig, handleClient, startServer, setupWaddleID };
