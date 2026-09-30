// Minimal ACP agent process used by the tests (modes: ok | die-on-prompt | hang-new | slow-start-hang-new |
// not-cached | cached-only | offline-broken).
// slow-start-hang-new answers initialize after a second, like an agent on a busy CI runner, then hangs on
// session/new. not-cached behaves like `npx` for a package missing from npm's cache: it fails offline and
// works online. cached-only works only when started offline (npm_config_offline=true); offline-broken fails
// offline with an error of its own.
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

const mode = process.argv[2] ?? 'ok';
const offline = process.env.npm_config_offline === 'true';
if (mode === 'not-cached' && offline) {
  process.stderr.write(
    "npm error code ENOTCACHED\nnpm error request to https://registry.npmjs.org/x failed: cache mode is 'only-if-cached' but no cached response is available.\n",
  );
  process.exit(1);
}
if (mode === 'offline-broken' && offline) {
  process.stderr.write('boom\n');
  process.exit(1);
}
if (mode === 'cached-only' && !offline) {
  process.stderr.write('started online\n');
  process.exit(1);
}
const findings = {
  findings: [
    {
      file: 'app.js',
      startLine: 2,
      endLine: 2,
      severity: 'minor',
      category: 'bug',
      title: 'Division by zero',
      description: 'b is always Infinity because a is divided by zero',
      confidence: 0.9,
    },
  ],
};

acp
  .agent({ name: 'fixture-agent' })
  .onRequest(acp.methods.agent.initialize, async () => {
    if (mode === 'slow-start-hang-new') await new Promise((resolve) => setTimeout(resolve, 1_000));
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: { name: 'fixture-agent', version: '1.0.0' },
    };
  })
  .onRequest(acp.methods.agent.session.new, async () => {
    if (mode === 'hang-new' || mode === 'slow-start-hang-new') await new Promise(() => {});
    return { sessionId: `s-${Math.random().toString(36).slice(2)}` };
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    if (mode === 'die-on-prompt') process.kill(process.pid, 'SIGKILL');
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `\`\`\`json\n${JSON.stringify(findings)}\n\`\`\`` },
      },
    });
    return { stopReason: 'end_turn' };
  })
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
