// Minimal ACP agent process used by the tests (modes: ok | die-on-prompt | hang-new).
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

const mode = process.argv[2] ?? 'ok';
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
  .onRequest(acp.methods.agent.initialize, async () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentInfo: { name: 'fixture-agent', version: '1.0.0' },
  }))
  .onRequest(acp.methods.agent.session.new, async () => {
    if (mode === 'hang-new') await new Promise(() => {});
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
