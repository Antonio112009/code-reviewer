// Regression fixture (test/processes.test.ts): a command ends while an orphaned process group is still
// alive (the leader exited, a SIGTERM-ignoring grandchild remains) and nothing else keeps the event loop
// alive. `terminateAll()` must be awaited to the end: prints "done" and exits 0, never 13 (unsettled
// top-level await). Start with `node --import ./ts-resolve.mjs orphan-close.mjs`.
import { fileURLToPath } from 'node:url';
import { ProcessRegistry, spawnManaged } from '../../../src/util/processes.ts';

const registry = new ProcessRegistry();
const tree = spawnManaged(process.execPath, [fileURLToPath(new URL('./tree.mjs', import.meta.url)), 'exit'], {
  label: 'tree',
  registry,
  stdio: ['ignore', 'pipe', 'ignore'],
});
let out = '';
await new Promise((resolve) => {
  tree.child.stdout.setEncoding('utf8').on('data', (d) => {
    out += d;
    if (out.includes('grandchild ready')) resolve();
  });
});
await tree.exited;
// Like a closed agent connection: our end of the pipe is gone, only the orphaned group is left.
tree.child.stdout.destroy();
process.stdout.write(`${out.split('\n')[0]}\n`);
await registry.terminateAll(500);
process.stdout.write('done\n');
