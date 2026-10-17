'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const WebSocket = require('ws');
const { transfer } = require('../waddleproserver/src/transfer');
const { resolveImage } = require('../waddleproserver/src/files');
const { download } = require('../src/client');
const { makeVerifier, verifyPassword } = require('../waddleproserver/src/authentication');
const png = Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3]);
async function localServer(image, filename = 'fixture.png') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'waddle-images-')); await fs.writeFile(path.join(dir,filename), image);
  const server = new WebSocket.Server({ host:'127.0.0.1', port:0, maxPayload:9*1024*1024 }); await new Promise(resolve => server.once('listening',resolve));
  server.on('connection', ws => { (async () => {
    try {
      ws.send('Waddle Server Connected');
      await new Promise(resolve => ws.once('message',resolve)); ws.send('READY');
      const req = await new Promise(resolve => ws.once('message',d => resolve(JSON.parse(d.toString()))));
      const file = await resolveImage(dir,req.filename,10*1024*1024);
      if (file.error) return ws.send(JSON.stringify({ type:'ERROR',code:file.error,message:file.message }));
      await transfer(ws,file,{ackTimeoutMs:3000}); await file.handle.close();
    } catch(e) { if(ws.readyState===WebSocket.OPEN) ws.close(1011,e.message.slice(0,100)); }
  })(); });
  return { dir, server, port:server.address().port };
}
test('real WebSocket download verifies hash and safely overwrites destination', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'waddle-client-')), original = process.cwd(), s = await localServer(png);
  t.after(async () => { process.chdir(original); await new Promise(resolve => s.server.close(resolve)); await fs.rm(temp,{recursive:true,force:true}); await fs.rm(s.dir,{recursive:true,force:true}); });
  process.chdir(temp);
  const result = await download({filename:'fixture.png',host:'127.0.0.1',port:s.port},{output(){}});
  assert.equal(result.sha256,crypto.createHash('sha256').update(png).digest('hex')); assert.deepEqual(await fs.readFile(path.join(temp,'WaddlePro-Download.png')),png);
  await fs.writeFile(path.join(temp,'WaddlePro-Download.png'),Buffer.from('old'));
  await download({filename:'fixture.png',host:'127.0.0.1',port:s.port},{output(){}}); assert.deepEqual(await fs.readFile(path.join(temp,'WaddlePro-Download.png')),png);
});
test('end-to-end download resolves a .waddle name through the offline registry', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'waddle-domain-client-')), original = process.cwd(), s = await localServer(png);
  t.after(async()=>{process.chdir(original); await new Promise(resolve=>s.server.close(resolve)); await fs.rm(temp,{recursive:true,force:true}); await fs.rm(s.dir,{recursive:true,force:true});});
  process.chdir(temp);
  const output=[];
  const result=await download({filename:'fixture.png',host:'Local.Test.Waddle',port:undefined,hasExplicitPort:false,isWaddleDomain:true},{
    registry:{'local.test.waddle':{ip:'127.0.0.1',port:s.port}}, output:text=>output.push(text)
  });
  assert.equal(result.sha256,crypto.createHash('sha256').update(png).digest('hex'));
  assert.deepEqual(await fs.readFile(path.join(temp,'WaddlePro-Download.png')),png);
  assert.ok(output.some(line=>line.includes(`Resolved: 127.0.0.1:${s.port}`)));
});
test('password verifier is salted and verifies safely', () => { const a=makeVerifier('secret'),b=makeVerifier('secret'); assert.notEqual(a.salt,b.salt); assert.equal(verifyPassword('secret',a),true); assert.equal(verifyPassword('wrong',a),false); });
