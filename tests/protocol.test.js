'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeWaddle, decodeWaddle, imageType, validFilename } = require('../src/protocol');
const { parseDownloadSpec } = require('../src/client');
const { resolveWaddleDomain, validateDomain } = require('../src/waddle-domain');
test('W/A encodes every byte and round trips', () => {
  const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  assert.equal(encodeWaddle(Buffer.from([0x48])), 'AWAAWAAA'); assert.deepEqual(decodeWaddle(encodeWaddle(all)), all);
});
test('W/A rejects malformed and oversized content', () => {
  assert.throws(() => decodeWaddle('AW')); assert.throws(() => decodeWaddle('XAAAAAAA')); assert.throws(() => decodeWaddle('A'.repeat(16), 1));
});
test('signatures and filenames are strict', () => {
  assert.equal(imageType(Buffer.from([137,80,78,71,13,10,26,10])), 'png'); assert.equal(imageType(Buffer.from('GIF87a')), 'gif'); assert.equal(imageType(Buffer.from('GIF89a')), 'gif');
  assert.equal(imageType(Buffer.from([0xff,0xd8,0xff,0xe0])), 'jpg');
  assert.equal(imageType(Buffer.from('not png')), null); for (const name of ['../secret.png','folder/image.png','folder\\image.png','a.jpeg']) assert.equal(validFilename(name), false);
  assert.equal(validFilename('valid.gif'), true);
});
test('download parser accepts strict host port syntax', () => {
  assert.deepEqual(parseDownloadSpec('a.png@localhost:8765'), { filename:'a.png', host:'localhost', port:8765, hasExplicitPort:true, isWaddleDomain:false });
  assert.equal(parseDownloadSpec('photo.jpg@localhost:8765').filename, 'photo.jpg');
  assert.deepEqual(parseDownloadSpec('a.png@127.0.0.1'), { filename:'a.png', host:'127.0.0.1', port:8765, hasExplicitPort:false, isWaddleDomain:false });
  assert.deepEqual(parseDownloadSpec('a.png@fish.waddle'), { filename:'a.png', host:'fish.waddle', port:undefined, hasExplicitPort:false, isWaddleDomain:true });
  assert.equal(parseDownloadSpec('a.png@fish.waddle:8766').port,8766);
  for (const input of ['../a.png@localhost:1','a.jpeg@localhost:1','a.png@host:0','a.png@host:65536','a.png@bad host:5','a.png@fish.waddle:0','a.png@bad_.waddle']) assert.throws(() => parseDownloadSpec(input));
});
test('offline waddle registry resolves case-insensitively with validated mappings', () => {
  const source = { 'zeke.waddle':{ip:'203.0.113.42',port:1234}, 'private.waddle':{ip:'10.0.0.20'} };
  assert.deepEqual(resolveWaddleDomain('ZEKE.WADDLE',undefined,source),{domain:'zeke.waddle',ip:'203.0.113.42',port:1234});
  assert.deepEqual(resolveWaddleDomain('private.waddle',undefined,source),{domain:'private.waddle',ip:'10.0.0.20',port:8765});
  assert.deepEqual(resolveWaddleDomain('zeke.waddle',4321,source),{domain:'zeke.waddle',ip:'203.0.113.42',port:4321});
  assert.equal(resolveWaddleDomain('missing.waddle',undefined,source),null);
  assert.equal(validateDomain('a..b.waddle'),false); assert.equal(validateDomain('__proto__.waddle'),false);
  assert.equal(resolveWaddleDomain('toString.waddle',undefined,source),null);
  assert.throws(()=>resolveWaddleDomain('broken.waddle',undefined,{'broken.waddle':{ip:'not-an-ip',port:80}}),/Invalid registry entry/);
});
