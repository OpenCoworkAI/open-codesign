import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'inherit',
  windowsHide: true,
});
child.once('spawn', () => {
  writeFileSync(
    process.argv[2],
    JSON.stringify({ parent: process.pid, child: child.pid, args: process.argv.slice(4) }),
  );
  if (process.argv[3] === 'exit') setTimeout(() => process.exit(7), 100);
});
setInterval(() => {}, 1000);
