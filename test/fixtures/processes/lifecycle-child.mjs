// Runs installLifecycle() in a real process (see test/lifecycle.test.ts); start with
// `node --import ./ts-resolve.mjs lifecycle-child.mjs <graceful|hang>`.
// It starts tree.mjs (leader + SIGTERM-ignoring grandchild), prints the tree's pids once the grandchild is
// ready and "interrupt <signal>" on the first interrupt. graceful: terminate the trees and let the event
// loop drain (the lifecycle must not keep it alive); hang: never finish, so only a forced exit ends it.
import { fileURLToPath } from 'node:url';
import { installLifecycle } from '../../../src/cli/lifecycle.ts';
import { processes, spawnManaged } from '../../../src/util/processes.ts';

const mode = process.argv[2] ?? 'graceful';
const lifecycle = installLifecycle();
const tree = spawnManaged(process.execPath, [fileURLToPath(new URL('./tree.mjs', import.meta.url)), 'wait'], {
  label: 'tree',
  stdio: ['ignore', 'pipe', 'inherit'],
});
let buffered = '';
tree.child.stdout.setEncoding('utf8').on('data', (chunk) => {
  buffered += chunk;
  if (buffered.includes('grandchild ready')) {
    process.stdout.write(`${buffered.split('\n')[0]}\n`);
    buffered = '';
  }
});
lifecycle.onInterrupt((signal) => {
  process.stdout.write(`interrupt ${signal}\n`);
  if (mode === 'hang') {
    setInterval(() => {}, 1000);
    return;
  }
  void processes.terminateAll(500).then(() => {
    process.exitCode = lifecycle.interruptExitCode;
  });
});
