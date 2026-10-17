'use strict';
const CHUNK_SIZE = 1048576;
const MAX_ENCODED_BYTES = CHUNK_SIZE * 8;
function encodeWaddle(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Expected a Buffer');
  const chars = Buffer.allocUnsafe(buffer.length * 8);
  for (let i = 0, p = 0; i < buffer.length; i++) {
    const b = buffer[i]; for (let bit = 7; bit >= 0; bit--) chars[p++] = ((b >> bit) & 1) ? 87 : 65;
  }
  return chars.toString('ascii');
}
function decodeWaddle(text, maxBytes = CHUNK_SIZE) {
  if (typeof text !== 'string') throw new TypeError('W/A payload must be text');
  if (text.length % 8) throw new Error('W/A payload length must be divisible by eight');
  if (text.length > maxBytes * 8) throw new Error('W/A payload exceeds the size limit');
  const out = Buffer.alloc(text.length / 8);
  for (let i = 0; i < text.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) {
      const c = text.charCodeAt(i + j);
      if (c !== 87 && c !== 65) throw new Error('Invalid W/A character');
      value = (value << 1) | (c === 87 ? 1 : 0);
    }
    out[i / 8] = value;
  }
  return out;
}
function imageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer.length >= 6 && ['GIF87a','GIF89a'].includes(buffer.toString('ascii',0,6))) return 'gif';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  return null;
}
function validFilename(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|gif|jpg)$/i.test(name) && name !== '.' && name !== '..';
}
module.exports = { CHUNK_SIZE, MAX_ENCODED_BYTES, encodeWaddle, decodeWaddle, imageType, validFilename };
