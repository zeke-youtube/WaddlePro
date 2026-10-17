'use strict';
const readline = require('node:readline');
const { parseDownloadSpec, download } = require('./client');
const { WaddleDebugger } = require('./debugger');
function runShell() {
  const dbg = new WaddleDebugger(line => console.log(`\n${line}`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'waddleshell> ' });
  console.log('WADDLEPRO v1.1\nPikaStudio Networking Division\n\nType "help" for commands.');
  rl.prompt();
  rl.on('line', async line => {
    const input = line.trim();
    try {
      if (!input) { rl.prompt(); return; }
      if (input === 'exit') { rl.close(); return; }
      if (input === 'help') console.log('Commands: download FILENAME@HOST:PORT, debug on, debug off, debug export FILE, exit');
      else if (input === 'debug on') { dbg.enabled = true; console.log('WADDLE Debugger enabled.'); }
      else if (input === 'debug off') { dbg.enabled = false; console.log('WADDLE Debugger disabled.'); }
      else if (input.startsWith('debug export ')) { const name = input.slice(13).trim(); if (!name || /[\\/]/.test(name)) throw new Error('Provide a filename in the current directory'); await dbg.export(name); console.log(`Debug session exported to ${name}`); }
      else if (input.startsWith('download ')) {
        const spec = parseDownloadSpec(input.slice(9));
        console.log(`\n[WADDLE] Downloading ${spec.filename}`);
        try { await download(spec, { debugger: dbg, output: console.log }); } catch (e) { console.error(`ERROR: ${e.message}`); }
      } else console.error('Unknown command. Type "help" for commands.');
    } catch (e) { console.error(`ERROR: ${e.message}`); }
    if (!rl.closed) rl.prompt();
  });
  rl.on('SIGINT', () => { console.log('\nInterrupted.'); rl.close(); });
  rl.on('close', () => { console.log('\nGoodbye from WADDLEPRO!'); process.exitCode = 0; });
}
module.exports = { runShell };
