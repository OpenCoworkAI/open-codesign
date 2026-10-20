import { register } from 'node:module';
import { runCli } from './cli';

register(new URL('./raw-assets-loader.mjs', import.meta.url));

const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
process.exitCode = await runCli(
  process.argv.slice(2),
  {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  controller.signal,
);
process.removeListener('SIGINT', cancel);
process.removeListener('SIGTERM', cancel);
