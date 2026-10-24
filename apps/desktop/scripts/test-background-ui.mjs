import { parseUiTestArgs, runUiTests } from '../../../scripts/test-ui.mjs';

try {
  const args = parseUiTestArgs(['debug', ...process.argv.slice(2)]);
  process.exitCode = await runUiTests(args.mode, args.list);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
