import { register } from 'node:module';
import { runCli } from './cli';

register(new URL('./raw-assets-loader.mjs', import.meta.url));

const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
// A disconnected JSONL client must release its offscreen host even if stdin is still open.
process.stdout.on('error', cancel);
process.exitCode = await runCli(
  process.argv.slice(2),
  {
    stdin: process.stdin,
    stdout: (text) => {
      if (!process.stdout.destroyed) process.stdout.write(text);
    },
    stderr: (text) => process.stderr.write(text),
  },
  controller.signal,
);
process.removeListener('SIGINT', cancel);
process.removeListener('SIGTERM', cancel);
