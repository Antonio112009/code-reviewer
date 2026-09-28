import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toolsFor } from '../src/tools/definitions';
import { createMcpServer } from '../src/tools/mcp-server';
import { SubmissionCollector } from '../src/tools/submission';

let dir: string;
let client: Client;
const submitFile = () => path.join(dir, 'submission.json');

function text(result: unknown): string {
  return ((result as { content: Array<{ text: string }> }).content[0]?.text ?? '') as string;
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'cr-mcp-'));
  writeFileSync(path.join(dir, 'a.ts'), "export function greet(name: string) {\n  return 'hi ' + name;\n}\n");
  const server = createMcpServer(toolsFor('findings', true), {
    root: dir,
    git: false,
    collector: new SubmissionCollector(submitFile()),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('MCP server', () => {
  it('exposes the read-only tools and the submit tool', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'find_references',
        'find_symbol',
        'git_blame',
        'git_log',
        'grep',
        'list_dir',
        'read_file',
        'submit_findings',
      ].sort(),
    );
  });

  it('reads files with line numbers and refuses paths outside the root', async () => {
    expect(
      text(
        await client.callTool({ name: 'read_file', arguments: { path: 'a.ts', startLine: 2, endLine: 2 } }),
      ),
    ).toContain("2\t  return 'hi ' + name;");
    const outside = await client.callTool({ name: 'read_file', arguments: { path: '../../etc/passwd' } });
    expect(outside.isError).toBe(true);
    expect(text(outside)).toMatch(/escapes the review root/);
  });

  it('greps and finds symbols without git', async () => {
    expect(text(await client.callTool({ name: 'grep', arguments: { pattern: "'hi ' \\+" } }))).toContain(
      'a.ts:2:',
    );
    expect(text(await client.callTool({ name: 'find_symbol', arguments: { name: 'greet' } }))).toContain(
      'a.ts:1:',
    );
  });

  it('validates submissions and writes them to the hand-off file', async () => {
    const bad = await client.callTool({
      name: 'submit_findings',
      arguments: { findings: [{ file: 'a.ts' }] },
    });
    expect(bad.isError).toBe(true);
    const ok = await client.callTool({
      name: 'submit_findings',
      arguments: {
        findings: [
          {
            file: 'a.ts',
            startLine: 2,
            endLine: 2,
            severity: 'info',
            category: 'bug',
            title: 'Example finding',
            description: 'Just a test finding for the MCP bridge',
            confidence: 0.5,
          },
        ],
      },
    });
    expect(ok.isError).toBeFalsy();
    const saved = JSON.parse(readFileSync(submitFile(), 'utf8'));
    expect(saved.calls).toBe(1);
    expect(saved.findings[0].title).toBe('Example finding');
  });
});
