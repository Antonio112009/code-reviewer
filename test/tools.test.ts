import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AnyToolDef,
  definitionPattern,
  globPathspec,
  pcreToEre,
  READ_TOOLS,
  runTool,
  type ToolContext,
} from '../src/tools/definitions';
import { SubmissionCollector } from '../src/tools/submission';
import { makeRepo, type TempRepo } from './helpers';

let repo: TempRepo;
const tool = (name: string) => READ_TOOLS.find((t) => t.name === name)! as AnyToolDef;

/** Definitions and call sites of the cases the tool got wrong on real repositories (lvgl, bitcoin, …). */
const FILES: Record<string, string> = {
  'src/core/lv_obj.c': [
    'lv_obj_t * lv_obj_create(lv_obj_t * parent)',
    '{',
    '    return lv_obj_class_create_obj(parent);',
    '}',
    'static void use(void) { lv_obj_t * o = lv_obj_create(NULL); }',
    'lv_obj_create(screen);',
    '',
  ].join('\n'),
  'src/util/bip32.h':
    'bool ParseHDKeypath(const std::string& keypath_str, std::vector<uint32_t>& keypath);\n',
  'src/util/bip32.cpp': [
    'bool ParseHDKeypath(const std::string& keypath_str, std::vector<uint32_t>& keypath)',
    '{',
    '    return true;',
    '}',
    'std::string Wallet::GetName() const {',
    '    if (!ParseHDKeypath(path, keypath)) return {};',
    '    return m_name;',
    '}',
    '',
  ].join('\n'),
  'server/src/main/java/Index.java': [
    'public class Index {',
    '    public static int getIndexVersionCreated(Settings settings) {',
    '        return 1;',
    '    }',
    '    void other() { int v = getIndexVersionCreated(s); }',
    '}',
    '',
  ].join('\n'),
  'osu.Game/Hit.cs': [
    'protected override void UpdateHitStateTransforms(ArmedState state)',
    '{',
    '    base.UpdateHitStateTransforms(state);',
    '}',
    '',
  ].join('\n'),
  'app/User.kt': 'suspend fun loadUser(id: Long): User {\n  return api.loadUser(id)\n}\n',
  'web/api.ts': [
    'export class Api {',
    '  async handle(req: Request) {',
    '    return this.handle(req.next);',
    '  }',
    '}',
    'handle(x);',
    'return handle(',
    '',
  ].join('\n'),
  'svc/server.go': 'func (s *Server) Serve(l net.Listener) error {\n\treturn s.Serve(l)\n}\n',
  'README.md': 'Call `bool ParseHDKeypath(` to parse a path.\n',
};

beforeAll(() => {
  repo = makeRepo();
  repo.write(FILES);
  repo.commit('fixtures');
});
afterAll(() => repo.cleanup());

const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({ root: repo.root, git: true, ...over });
const run = async (name: string, input: unknown, c = ctx()) => (await runTool(tool(name), input, c)).text;
const files = (out: string) =>
  out
    .split('\n')
    .map((l) => /^(.+?:\d+):/.exec(l)?.[1])
    .filter(Boolean);

describe('grep', () => {
  it('understands Perl-style regexes (\\b, \\w, (?:)) that POSIX ERE rejects or misreads', async () => {
    expect(files(await run('grep', { pattern: '\\bParseHDKeypath\\b', glob: '*.cpp' }))).toEqual([
      'src/util/bip32.cpp:1',
      'src/util/bip32.cpp:6',
    ]);
    expect(files(await run('grep', { pattern: 'lv_obj_\\w+\\(NULL' }))).toEqual(['src/core/lv_obj.c:5']);
    expect(files(await run('grep', { pattern: '(?:loadUser|Serve)\\(', glob: '*.kt' }))).toEqual([
      'app/User.kt:1',
      'app/User.kt:2',
    ]);
  });

  it('searches an invalid regex as the text it names, and says so', async () => {
    const out = await run('grep', { pattern: 'lv_obj_create(' });
    expect(out).toMatch(/^\(not a valid regular expression: .*; searched as plain text\)/);
    expect(files(out)).toEqual(['src/core/lv_obj.c:1', 'src/core/lv_obj.c:5', 'src/core/lv_obj.c:6']);
    expect(files(await run('grep', { pattern: 'a.b(', literal: true }))).toEqual([]);
  });

  it('matches a glob without a directory in every directory', async () => {
    expect(globPathspec('*.java')).toBe(':(glob)**/*.java');
    expect(globPathspec('src/**/*.c')).toBe(':(glob)src/**/*.c');
    expect(files(await run('grep', { pattern: 'getIndexVersionCreated', glob: '*.java' }))).toHaveLength(2);
  });

  it('works the same without git', async () => {
    const noGit = ctx({ git: false });
    expect(files(await run('grep', { pattern: '\\bParseHDKeypath\\b', glob: '*.cpp' }, noGit))).toEqual([
      'src/util/bip32.cpp:1',
      'src/util/bip32.cpp:6',
    ]);
    expect(await run('grep', { pattern: 'lv_obj_create(' }, noGit)).toMatch(/searched as plain text/);
  });

  it('translates to POSIX ERE for a git without PCRE', () => {
    expect(pcreToEre('(?:a|b)\\w+\\d\\s\\bx')).toBe('(a|b)[[:alnum:]_]+[0-9][[:space:]]x');
    expect(pcreToEre('^\\s*(?!(?:return|else)\\b)foo\\(')).toBe('^[[:space:]]*foo\\(');
  });
});

describe('find_symbol', () => {
  const found = async (name: string, git = true) => files(await run('find_symbol', { name }, ctx({ git })));

  it.each([true, false])(
    'finds C-family, Java, C# and Kotlin definitions, not calls (git: %s)',
    async (git) => {
      expect(await found('lv_obj_create', git)).toEqual(['src/core/lv_obj.c:1']);
      expect(await found('ParseHDKeypath', git)).toEqual(['src/util/bip32.cpp:1']); // not the prototype, docs or call
      expect(await found('GetName', git)).toEqual(['src/util/bip32.cpp:5']);
      expect(await found('getIndexVersionCreated', git)).toEqual(['server/src/main/java/Index.java:2']);
      expect(await found('UpdateHitStateTransforms', git)).toEqual(['osu.Game/Hit.cs:1']);
      expect(await found('loadUser', git)).toEqual(['app/User.kt:1']);
      expect(await found('handle', git)).toEqual(['web/api.ts:2']);
      expect(await found('Serve', git)).toEqual(['svc/server.go:1']);
    },
  );

  it('builds one pattern that git and JavaScript both accept', () => {
    expect(() => new RegExp(definitionPattern('a$b'))).not.toThrow();
  });
});

describe('tool call log', () => {
  it('records every read-tool call with its size, duration and errors', async () => {
    const collector = new SubmissionCollector();
    const c = ctx({ collector });
    await run('grep', { pattern: 'GetName' }, c);
    await run('read_file', { path: '../outside' }, c);
    const log = collector.submission.toolLog!;
    expect(log.map((e) => [e.name, e.error ?? false])).toEqual([
      ['grep', false],
      ['read_file', true],
    ]);
    expect(log[0]).toMatchObject({ args: '{"pattern":"GetName"}', lines: 1 });
    expect(log[0]!.chars).toBeGreaterThan(0);
    expect(log[0]!.ms).toBeGreaterThanOrEqual(0);
  });
});
