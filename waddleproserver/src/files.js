'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { imageType, validFilename } = require('../../src/protocol');
async function resolveImage(imageDirectory, filename, maxBytes) {
  if (!validFilename(filename)) return { error: 'INVALID_FILENAME', message: 'Invalid filename' };
  const root = await fs.realpath(imageDirectory), candidate = path.join(root, filename);
  let resolved, stat;
  try { resolved = await fs.realpath(candidate); stat = await fs.stat(resolved); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { error: 'NOT_FOUND', message: 'File not found' }; throw e; }
  if (path.dirname(resolved) !== root || !stat.isFile()) return { error: 'INVALID_FILENAME', message: 'File is outside image directory' };
  if (stat.size > maxBytes) return { error: 'TOO_LARGE', message: 'File exceeds configured size limit' };
  const ext = path.extname(filename).toLowerCase(); if (!['.png','.gif','.jpg'].includes(ext)) return { error: 'UNSUPPORTED_TYPE', message: 'Only PNG, GIF, and JPG are supported' };
  const handle = await fs.open(resolved, 'r');
  const sig = Buffer.alloc(8); const { bytesRead } = await handle.read(sig, 0, 8, 0);
  const type = imageType(sig.subarray(0, bytesRead));
  if (type !== ext.slice(1)) { await handle.close(); return { error: 'UNSUPPORTED_TYPE', message: 'Image signature does not match supported extension' }; }
  return { filename, path: resolved, size: stat.size, type, handle, initialStat: stat };
}
module.exports = { resolveImage };
