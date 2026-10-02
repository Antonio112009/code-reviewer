import { afterAll, describe, expect, it } from 'vitest';
import { MockProvider } from '../src/providers/mock';
import { ProviderRegistry } from '../src/providers/registry';
import type { AgentResult, AgentTask, Provider } from '../src/providers/types';
import { runReview } from '../src/review/pipeline';
import { loadSkills } from '../src/skills/loader';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

/**
 * Golden tests of skill selection: a small realistic change per technology, reviewed with --dry-run, must
 * pick the skills about what it does and none about other technologies. A skill whose regexes or group
 * detection drift breaks here, with the chunk's skills in the message.
 */
interface Case {
  name: string;
  base: Record<string, string>;
  head: Record<string, string>;
  /** Skill ids that must be picked. */
  picks: string[];
  /** Id prefixes no picked skill may start with. */
  never: string[];
}

const CASES: Case[] = [
  {
    name: 'React effect with a timer',
    base: {
      'package.json': JSON.stringify({
        name: 'app',
        dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' },
      }),
      'src/Clock.tsx': 'export function Clock() {\n  return <span>now</span>;\n}\n',
    },
    head: {
      'src/Clock.tsx':
        "import { useEffect, useState } from 'react';\n\nexport function Clock() {\n  const [now, setNow] = useState(Date.now());\n  useEffect(() => {\n    const id = setInterval(() => setNow(Date.now()), 1000);\n  }, []);\n  return <span>{now}</span>;\n}\n",
    },
    picks: ['javascript/react/effects'],
    never: ['python/', 'go/', 'java/', 'c-cpp/'],
  },
  {
    name: 'Go worker pool with a WaitGroup',
    base: {
      'go.mod': 'module example.com/pool\n\ngo 1.24\n',
      'pool.go': 'package pool\n\nfunc Run(jobs []int) {}\n',
    },
    head: {
      'pool.go':
        'package pool\n\nimport "sync"\n\nfunc Run(jobs []int) {\n\tvar wg sync.WaitGroup\n\tfor _, j := range jobs {\n\t\tgo func(j int) {\n\t\t\twg.Add(1)\n\t\t\tdefer wg.Done()\n\t\t\twork(j)\n\t\t}(j)\n\t}\n\twg.Wait()\n}\n\nfunc work(int) {}\n',
    },
    picks: ['go/concurrency/sync-primitives'],
    never: ['javascript/', 'python/', 'java/'],
  },
  {
    name: 'Django view looping over an ORM queryset',
    base: {
      'requirements.txt': 'Django==5.2\n',
      'shop/views.py':
        'from django.http import JsonResponse\n\n\ndef orders(request):\n    return JsonResponse({})\n',
    },
    head: {
      'shop/views.py':
        'from django.http import JsonResponse\n\nfrom .models import Order\n\n\ndef orders(request):\n    rows = []\n    for order in Order.objects.all():\n        rows.append({"id": order.id, "customer": order.customer.name})\n    return JsonResponse({"orders": rows})\n',
    },
    picks: ['python/django/orm-performance'],
    never: ['javascript/', 'go/', 'java/'],
  },
  {
    name: 'C++ JNI bridge',
    base: {
      'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.20)\nproject(bridge CXX)\n',
      'src/bridge.cpp': '#include <cstdint>\n',
    },
    head: {
      'src/bridge.cpp':
        '#include <jni.h>\n\nclass Reader {\n  JNIEnv *m_env;\n  jmethodID m_read;\npublic:\n  Reader(JNIEnv *env, jobject obj) : m_env(env) {\n    jclass cls = env->GetObjectClass(obj);\n    m_read = env->GetMethodID(cls, "read", "([BII)I");\n  }\n};\n',
    },
    picks: ['c-cpp/jni/references-and-exceptions'],
    never: ['javascript/', 'python/', 'go/'],
  },
  {
    name: 'Documentation only',
    base: { 'README.md': '# App\n' },
    head: { 'README.md': '# App\n\nRun `npm start`.\n' },
    picks: [],
    never: ['javascript/', 'python/', 'go/', 'java/', 'c-cpp/', 'csharp/', 'rust/'],
  },
];

describe('skill selection (golden)', () => {
  const repos: TempRepo[] = [];
  afterAll(() => {
    for (const r of repos) r.cleanup();
  });

  for (const c of CASES) {
    it(c.name, async () => {
      const repo = makeRepo();
      repos.push(repo);
      repo.write(c.base);
      repo.commit('base');
      repo.git('checkout', '-q', '-b', 'feature');
      repo.write(c.head);
      repo.commit('change');
      repo.git('checkout', '-q', 'main');
      const { plan } = await runReview({
        command: 'review',
        cwd: repo.root,
        base: 'main',
        head: 'feature',
        config: testConfig((cfg) => {
          cfg.review.depth = 'full';
        }),
        logger: silentLogger,
        dryRun: true,
      });
      const picked = plan.chunks.flatMap((ch) => ch.skills.map((s) => s.id));
      const where = `picked: ${picked.join(', ') || '(none)'}`;
      for (const id of c.picks) expect(picked, where).toContain(id);
      for (const prefix of c.never) {
        expect(
          picked.filter((id) => id.startsWith(prefix)),
          where,
        ).toEqual([]);
      }
    });
  }

  it('records the skills the budget left out', async () => {
    const repo = makeRepo();
    repos.push(repo);
    const react = CASES[0]!;
    repo.write(react.base);
    repo.commit('base');
    repo.git('checkout', '-q', '-b', 'feature');
    repo.write(react.head);
    repo.commit('change');
    repo.git('checkout', '-q', 'main');
    const { plan } = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config: testConfig((cfg) => {
        cfg.review.depth = 'full';
        cfg.review.skillTokenBudget = 900;
      }),
      logger: silentLogger,
      dryRun: true,
    });
    const chunk = plan.chunks[0]!;
    expect(chunk.skillsDropped?.length).toBeGreaterThan(0);
    const picked = new Set(chunk.skills.map((s) => s.id));
    for (const id of chunk.skillsDropped!) expect(picked.has(id)).toBe(false);
  });

  it('names the topics of the skills the budget left out in the review prompt', async () => {
    const repo = makeRepo();
    repos.push(repo);
    const react = CASES[0]!;
    repo.write(react.base);
    repo.commit('base');
    repo.git('checkout', '-q', '-b', 'feature');
    repo.write(react.head);
    repo.commit('change');
    repo.git('checkout', '-q', 'main');
    const tasks: AgentTask[] = [];
    const mock = new MockProvider('mock');
    const provider: Provider = {
      id: 'mock',
      kind: 'mock',
      run: (task: AgentTask): Promise<AgentResult> => {
        tasks.push(task);
        return mock.run(task);
      },
      dispose: async () => {},
    };
    const config = testConfig((cfg) => {
      cfg.review.depth = 'full';
      cfg.review.skillTokenBudget = 900;
      cfg.review.selfCritique = false;
      cfg.output.formats = [];
    });
    const registry = new ProviderRegistry(config, silentLogger);
    (registry as unknown as { instances: Map<string, Provider> }).instances.set('mock', provider);
    const { run } = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config,
      logger: silentLogger,
      providers: registry,
      skipPreflight: true,
    });
    const dropped = run!.chunks[0]!.skillsDropped!;
    expect(dropped.length).toBeGreaterThan(0);
    const skills = await loadSkills(repo.root);
    const first = skills.find((s) => s.id === dropped[0])!;
    const review = tasks.find((t) => t.instructions.includes('## Technology checklists'))!;
    expect(review.instructions).toContain('### Other topics that apply here');
    expect(review.instructions).toContain(`- ${first.name}: `);
    expect(review.instructions).not.toContain(`[${first.id}]`);
  });
});
