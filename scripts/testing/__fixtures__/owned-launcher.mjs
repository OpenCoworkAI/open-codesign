import { runOwnedNode } from '../owned-process.mjs';

await runOwnedNode({ args: process.argv.slice(2), cwd: process.cwd() });
