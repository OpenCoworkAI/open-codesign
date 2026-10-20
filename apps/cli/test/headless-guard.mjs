import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { register, syncBuiltinESMExports } from 'node:module';
import net from 'node:net';

register('./forbid-gui-loader.mjs', import.meta.url);
const denied = () => {
  throw new Error('External process or network attempted by CLI');
};
const spawn = childProcess.spawn;
childProcess.spawn = (command, ...args) => {
  // tsx's existing TypeScript compiler is the sole permitted child process.
  if (
    typeof command === 'string' &&
    /[/\\]@esbuild[/\\][^/\\]+[/\\](?:bin[/\\])?esbuild(?:\.exe)?$/.test(command)
  )
    return spawn(command, ...args);
  return denied();
};
for (const name of ['exec', 'execFile', 'execSync', 'execFileSync', 'spawnSync', 'fork'])
  childProcess[name] = denied;
http.request = http.get = https.request = https.get = denied;
net.connect = net.createConnection = denied;
net.Socket.prototype.connect = denied;
globalThis.fetch = denied;
syncBuiltinESMExports();
