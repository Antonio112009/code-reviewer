// Process-tree fixture for test/processes.test.ts and test/lifecycle.test.ts. Modes (argv[2]):
//   wait – start a grandchild that ignores SIGTERM and shares our stdout/stderr pipes, then run forever
//   exit – start the same grandchild, then exit at once (the grandchild keeps holding the pipes)
//   big  – print argv[3] bytes of output and exit
//   echo – copy stdin to stdout
// The grandchild prints "grandchild ready" once its SIGTERM handler is installed; the leader prints
// {"leader":pid,"grandchild":pid} first.
import { spawn } from 'node:child_process';

const mode = process.argv[2] ?? 'wait';

if (mode === 'big') {
  const total = Number(process.argv[3]);
  const line = `${'x'.repeat(99)}\n`;
  process.stdout.write(line.repeat(Math.floor(total / line.length)) + 'y'.repeat(total % line.length));
} else if (mode === 'echo') {
  process.stdin.pipe(process.stdout);
} else {
  const grandchild = spawn(
    process.execPath,
    [
      '-e',
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('grandchild ready\\n');",
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  process.stdout.write(`${JSON.stringify({ leader: process.pid, grandchild: grandchild.pid })}\n`);
  if (mode === 'wait') setInterval(() => {}, 1000);
  else grandchild.unref();
}
