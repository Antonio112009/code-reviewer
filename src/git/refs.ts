import type { GitSettings } from '../config/schema';
import type { RefsInfo } from '../types';
import { untrustedGlobMatcher } from '../util/globs';
import { PROJECT_DIR } from '../util/paths';
import { type CiPullRequest, detectCiPullRequest } from './ci';
import { type ForgePullRequest, findOpenPullRequest } from './forge';
import {
  commitLocalChanges,
  type LocalChanges,
  type LocalSnapshot,
  type LocalSnapshotOptions,
} from './local-changes';
import { parseRemote } from './remote';
import { type GitRepo, isValidBranchName, type NetworkResult, type UpstreamInfo } from './repo';

export interface ResolveRefsOptions {
  repo: GitRepo;
  /** User-supplied base (`--base`); bare branch names mean the (freshly fetched) remote branch. */
  base?: string;
  /** User-supplied head (`--head`); default HEAD (local, including unpushed commits). */
  head?: string;
  /**
   * Review changes not committed yet (`--staged`, `--uncommitted`): the head is a snapshot commit of them on
   * top of HEAD (see `commitLocalChanges`), and the base defaults to HEAD.
   */
  local?: { mode: LocalChanges } & LocalSnapshotOptions;
  settings: GitSettings;
  /** Never touch the network (`--offline` / `--no-fetch`). */
  offline?: boolean;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  warn?: (message: string) => void;
}

export interface ResolvedRefs {
  /** Display names, e.g. "origin/develop" and "HEAD (feature/login)". */
  base: string;
  head: string;
  baseSha: string;
  headSha: string;
  mergeBase: string;
  info: RefsInfo;
  /** The snapshot of the local changes (with `local`). */
  local?: LocalSnapshot;
}

/**
 * How a ref string (from `--base`/`--head`, CI, a forge, git config or settings) is interpreted:
 * - `branch`: bare branch name → the freshly fetched remote-tracking branch, else the local branch;
 * - `remote`: `origin/develop` or `refs/remotes/origin/develop` (fetched from that remote);
 * - `local`: `refs/heads/develop` (never fetched);
 * - `rev`: sha, tag or revision expression such as `HEAD~3`, used as given.
 */
export type RefSpec =
  | { kind: 'branch'; name: string; remote?: string }
  | { kind: 'remote'; remote: string; name: string }
  | { kind: 'local'; name: string }
  | { kind: 'rev'; rev: string };

const FALLBACK_DEFAULT_BRANCHES = ['main', 'master', 'trunk'];
const FORGE_TIMEOUT_MS = 5_000;
/** Depth of a base branch fetched for the first time into a shallow clone. */
const INITIAL_SHALLOW_DEPTH = 50;
const DEEPEN_STEP = 50;
const HEX_RE = /^[0-9a-f]{7,64}$/i;

/** Classifies a user/config ref string; `remotes` decides whether `x/y` means remote `x`, branch `y`. */
export function classifyRef(input: string, remotes: readonly string[]): RefSpec {
  const s = input.trim();
  const byLength = [...remotes].sort((a, b) => b.length - a.length);
  const splitRemote = (value: string): RefSpec | undefined => {
    for (const remote of byLength) {
      const name = value.startsWith(`${remote}/`) ? value.slice(remote.length + 1) : '';
      if (name && isValidBranchName(name)) return { kind: 'remote', remote, name };
    }
    return undefined;
  };
  if (s.startsWith('refs/heads/')) {
    const name = s.slice('refs/heads/'.length);
    return isValidBranchName(name) ? { kind: 'local', name } : { kind: 'rev', rev: s };
  }
  if (s.startsWith('refs/remotes/'))
    return splitRemote(s.slice('refs/remotes/'.length)) ?? { kind: 'rev', rev: s };
  if (s.startsWith('refs/') || HEX_RE.test(s) || !isValidBranchName(s)) return { kind: 'rev', rev: s };
  return splitRemote(s) ?? { kind: 'branch', name: s };
}

/** Compact, locale-independent age ("5 min ago", "3 h ago", "2 days ago"). */
export function formatAge(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

type BaseSource = RefsInfo['baseSource'];

interface Candidates {
  specs: RefSpec[];
  why: string;
}

interface BaseOption {
  source: BaseSource;
  why: string;
  specs: RefSpec[];
  /** Pick the nearest ancestor of head among the existing candidates (rules); otherwise the first. */
  nearest?: boolean;
  /** Fail instead of falling through when nothing exists (explicit `--base`, CI). */
  required?: boolean;
  /** Options whose candidates are only known later (forge lookup, remote default branch). */
  lazy?: () => Promise<Candidates | undefined>;
  ci?: CiPullRequest;
}

/** A spec resolved to something that exists. */
interface Located {
  kind: 'remote' | 'local' | 'rev';
  /** What rev-parse / rev-list get: a full ref or the revision as given. */
  ref: string;
  display: string;
  branch?: string;
  remote?: string;
  /** Notice when a remote branch was expected but a local one is used. */
  note?: string;
}

interface Resolved extends Located {
  sha: string;
  /** The local checkout's HEAD (working-tree notes apply). */
  isHead?: boolean;
  /** A snapshot of the local changes on top of HEAD. */
  local?: LocalSnapshot;
}

interface HeadPlan {
  spec?: RefSpec;
  input?: string;
  preferRemote: boolean;
  why: string;
  /** Fall back to the local HEAD when the remote branch does not exist (headSource=remote). */
  fallbackToHead?: boolean;
}

interface Want {
  remote: string;
  branch: string;
  /** Local ref the remote branch is fetched into. */
  dst: string;
}

/** Notices collected concurrently and applied in a fixed order. */
interface Notices {
  notes?: string[];
  base?: string[];
  head?: string[];
  extra?: string[];
}

interface Probe {
  ok: boolean;
  asked: Set<string>;
  askedHead: boolean;
  heads: Map<string, string>;
  defaultBranch?: string;
}

/** Chooses base/head for a PR-style review (fetching the base from the remote first). */
export async function resolveRefs(opts: ResolveRefsOptions): Promise<ResolvedRefs> {
  return new RefResolver(opts).resolve();
}

class RefResolver {
  private readonly repo: GitRepo;
  private readonly settings: GitSettings;
  private readonly env: NodeJS.ProcessEnv;
  private readonly signal?: AbortSignal;
  private readonly warn: (message: string) => void;
  private readonly notes: string[] = [];
  private readonly lines = {
    remote: [] as string[],
    base: [] as string[],
    head: [] as string[],
    extra: [] as string[],
  };

  private branch?: string;
  private remotes: string[] = [];
  private remote?: string;
  private upstream?: UpstreamInfo;
  private shallow = false;
  /** Why the network is not used at all; undefined when fetching is allowed. */
  private offline?: string;
  /** `--offline` / CODE_REVIEWER_OFFLINE: not even forge CLIs may go online. */
  private hardOffline = false;
  /** Branch that the cached `<remote>/HEAD` points to. */
  private remoteHead?: string;
  private readonly probes = new Map<string, Probe>();
  /** Remote → reason, for remotes that could not be reached this run. */
  private readonly failed = new Map<string, string>();
  /** Remote-tracking refs verified to match the remote this run. */
  private readonly synced = new Set<string>();
  private readonly fetchLog = new Map<string, { fetched: string[]; current: string[] }>();

  constructor(private readonly opts: ResolveRefsOptions) {
    this.repo = opts.repo;
    this.settings = opts.settings;
    this.env = opts.env ?? process.env;
    this.signal = opts.signal;
    this.warn = opts.warn ?? (() => {});
  }

  async resolve(): Promise<ResolvedRefs> {
    this.signal?.throwIfAborted();
    await this.init();
    const headPlan = this.planHead();
    const options = await this.planBase(headPlan);
    await this.initialProbe(options, headPlan);

    // 1. Base: the first option with an existing candidate wins.
    const chosen = await this.chooseBase(options);
    // 2. One fetch per remote for the chosen base candidate(s) and the head refs.
    const baseWants = chosen.found.flatMap((l) => this.wantFor(l));
    await this.sync([...baseWants, ...this.headWants(headPlan)]);
    // 3. Head, then the nearest-ancestor pick among rule candidates (a remote branch whose fetch failed
    //    and that is not cached falls back to the local branch).
    const head = await this.resolveHead(headPlan);
    const usable = (await Promise.all(chosen.found.map((l) => this.usable(l)))).filter(
      (l): l is Located => l !== undefined,
    );
    if (usable.length === 0) {
      throw new Error(
        `Base ${chosen.found[0]!.display} could not be fetched and has no local copy. Run \`git fetch\`, or pass --base.`,
      );
    }
    let baseLoc = usable[0]!;
    let detail = '';
    if (usable.length > 1) ({ loc: baseLoc, detail } = await this.nearest(usable, head.sha));
    const base: Resolved = { ...baseLoc, sha: await this.repo.resolveCommit(baseLoc.ref) };
    this.lines.base.push(`base ${base.display}: ${chosen.why}${detail ? ` — ${detail}` : ''}`);
    if (base.note) this.notes.push(base.note);

    // 4. Merge-base (deepening shallow clones), then notices (computed concurrently, applied in order).
    const [mergeBase, tree] = await Promise.all([
      this.mergeBase(base, head),
      head.isHead && !head.local ? this.repo.workingTreeStatus([PROJECT_DIR]) : undefined,
    ]);
    // On the base branch itself (or a branch without commits of its own) there is nothing to compare.
    // Explicit --base and CI runs are left to the caller ("nothing to review" is a valid outcome there).
    const source = chosen.option.source;
    const onBase = head.isHead === true && this.branch !== undefined && base.branch === this.branch;
    if (
      mergeBase === head.sha &&
      source !== 'flag' &&
      (onBase || (source !== 'ci' && head.sha === base.sha))
    ) {
      throw new Error(
        this.nothingToReview(base, head, onBase, chosen.why, (tree?.changed ?? 0) + (tree?.untracked ?? 0)),
      );
    }
    const notices: Notices[] = await Promise.all([
      this.cacheNotices(base),
      head.ref !== base.ref ? this.cacheNotices(head) : Promise.resolve<Notices>({}),
      // On top of HEAD (the default), unpushed commits are not part of the review.
      head.local && source === 'local' ? Promise.resolve<Notices>({}) : this.headNotices(head, headPlan),
      this.baseNotices(base, head),
    ]);
    for (const n of notices) {
      this.notes.push(...(n.notes ?? []));
      this.lines.base.push(...(n.base ?? []));
      this.lines.head.push(...(n.head ?? []));
      this.lines.extra.push(...(n.extra ?? []));
    }
    if (tree && (tree.changed || tree.untracked)) {
      const parts = [
        tree.changed ? plural(tree.changed, 'uncommitted change') : '',
        tree.untracked ? plural(tree.untracked, 'untracked file') : '',
      ].filter(Boolean);
      this.notes.push(
        `${parts.join(' and ')} not reviewed (commit them, or pass --staged or --uncommitted to include them)`,
      );
    }
    const left = head.local?.leftOut;
    if (left && (left.unstaged || left.untracked)) {
      const parts = [
        left.unstaged ? plural(left.unstaged, 'unstaged change') : '',
        left.untracked ? plural(left.untracked, 'untracked file') : '',
      ].filter(Boolean);
      this.notes.push(`${parts.join(' and ')} not reviewed (\`git add\` them, or use --uncommitted)`);
    }

    return {
      base: base.display,
      head: head.display,
      baseSha: base.sha,
      headSha: head.sha,
      mergeBase,
      info: {
        explanation: [
          ...this.lines.remote,
          ...this.fetchLines(),
          ...this.lines.base,
          ...this.lines.head,
          ...this.lines.extra,
        ],
        baseSource: chosen.option.source,
        remote: this.remote,
        fetched: this.synced.size > 0 && this.failed.size === 0,
        notes: this.notes,
      },
      ...(head.local ? { local: head.local } : {}),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Local facts

  private async init(): Promise<void> {
    // Warm the cached network environment (reads core.sshCommand) while the local lookups run.
    void this.repo.networkEnv().catch(() => undefined);
    const [headRef, remotes, shallow, remoteHeads] = await Promise.all([
      this.repo.symbolicRef('HEAD'),
      this.repo.remotes(),
      this.repo.isShallow(),
      this.repo.remoteHeads(),
    ]);
    this.branch = headRef?.startsWith('refs/heads/') ? headRef.slice('refs/heads/'.length) : undefined;
    this.remotes = remotes;
    this.shallow = shallow;
    this.upstream = this.branch ? await this.repo.upstream(this.branch) : undefined;
    this.remote = this.selectRemote();
    this.hardOffline =
      this.opts.offline === true || /^(1|true|yes|on)$/i.test(this.env.CODE_REVIEWER_OFFLINE ?? '');
    this.offline = this.opts.offline
      ? '--offline'
      : this.hardOffline
        ? 'CODE_REVIEWER_OFFLINE'
        : this.settings.fetch === 'never'
          ? 'git.fetch=never'
          : this.remote
            ? undefined
            : 'no remote';
    const remoteHead = this.remote ? remoteHeads.get(this.remote) : undefined;
    this.remoteHead = remoteHead && isValidBranchName(remoteHead) ? remoteHead : undefined;
  }

  private selectRemote(): string | undefined {
    const configured = this.settings.remote;
    if (configured && configured !== 'auto') {
      if (this.remotes.includes(configured)) {
        this.lines.remote.push(`remote ${configured} (git.remote)`);
        return configured;
      }
      this.warn(`git.remote "${configured}" is not a configured remote; choosing one automatically.`);
    }
    const up = this.upstream?.remote;
    if (up && this.remotes.includes(up)) {
      this.lines.remote.push(`remote ${up}: upstream remote of ${this.branch}`);
      return up;
    }
    if (this.remotes.includes('origin')) {
      this.lines.remote.push('remote origin');
      return 'origin';
    }
    const first = this.remotes[0];
    if (first) {
      this.lines.remote.push(
        `remote ${first}: the ${this.remotes.length === 1 ? 'only' : 'first'} configured remote`,
      );
      return first;
    }
    this.lines.remote.push('no git remote configured: comparing local branches only');
    return undefined;
  }

  // ---------------------------------------------------------------------------------------------
  // Plans

  private planHead(): HeadPlan {
    const input = this.opts.head?.trim();
    const local: HeadPlan = { preferRemote: false, why: 'local' };
    if (this.opts.local) {
      if (input && input !== 'HEAD' && input !== '@') {
        throw new Error(
          `--${this.opts.local.mode} reviews the local checkout: it cannot be combined with --head.`,
        );
      }
      return local;
    }
    if (input && input !== 'HEAD' && input !== '@') {
      return {
        spec: classifyRef(input, this.remotes),
        input,
        preferRemote: this.settings.headSource === 'remote',
        why: `--head ${input}`,
      };
    }
    if (input || this.settings.headSource !== 'remote') return local;
    if (!this.branch) {
      this.lines.head.push('detached HEAD: git.headSource=remote needs a branch, reviewing HEAD instead');
      return local;
    }
    const why = `remote branch of ${this.branch} (git.headSource=remote)`;
    const up = this.upstream;
    if (up && this.remotes.includes(up.remote)) {
      return {
        spec: { kind: 'remote', remote: up.remote, name: up.branch },
        preferRemote: true,
        why,
        fallbackToHead: true,
      };
    }
    if (this.remote) {
      return {
        spec: { kind: 'remote', remote: this.remote, name: this.branch },
        preferRemote: true,
        why,
        fallbackToHead: true,
      };
    }
    this.lines.head.push('no remote: git.headSource=remote ignored, reviewing the local HEAD');
    return local;
  }

  /**
   * The branch whose base is looked up (rules, branch config, open PR): the `--head` branch when one is
   * named, the checked-out branch when the head is HEAD, none for a sha / tag / revision expression.
   */
  private selectionBranch(headPlan: HeadPlan): string | undefined {
    const spec = headPlan.spec;
    if (!spec || headPlan.fallbackToHead) return this.branch;
    return spec.kind === 'rev' ? undefined : spec.name;
  }

  private async planBase(headPlan: HeadPlan): Promise<BaseOption[]> {
    if (this.opts.base !== undefined) {
      const input = this.opts.base.trim();
      if (!input) throw new Error('--base must not be empty.');
      const spec = classifyRef(input, this.remotes);
      const how =
        spec.kind === 'branch'
          ? this.remote
            ? ` (branch name → ${this.remote}/${spec.name} when it exists there)`
            : ''
          : spec.kind === 'rev'
            ? ' (used as given)'
            : '';
      return [{ source: 'flag', why: `--base ${input}${how}`, specs: [spec], required: true }];
    }
    if (this.opts.local) {
      const why = `--${this.opts.local.mode} reviews the changes on top of HEAD`;
      return [{ source: 'local', why, specs: [{ kind: 'rev', rev: 'HEAD' }], required: true }];
    }
    const { base } = this.settings;
    if (base.useCi) {
      const ci = await detectCiPullRequest(this.env);
      if (ci) {
        const pr = ci.number ? ` (PR #${ci.number})` : '';
        return [
          {
            source: 'ci',
            why: `${ci.label}${pr}: ${ci.baseVar}=${ci.baseBranch}`,
            specs: [{ kind: 'branch', name: ci.baseBranch }],
            required: true,
            ci,
          },
        ];
      }
    }

    const options: BaseOption[] = [];
    const branch = this.selectionBranch(headPlan);
    // gh / glab look up the PR of the checked-out branch: only ask them when that is the reviewed one.
    if (base.useForge && branch && branch === this.branch && this.remote && !this.hardOffline) {
      const url = await this.repo.configGet(`remote.${this.remote}.url`);
      const platform = parseRemote(url)?.platform;
      if (platform) {
        // Started now so the lookup overlaps with the ls-remote probe.
        const lookup = findOpenPullRequest({
          cwd: this.repo.root,
          platform,
          env: this.env,
          signal: this.signal,
          timeoutMs: FORGE_TIMEOUT_MS,
        });
        options.push({ source: 'forge', why: '', specs: [], lazy: () => this.forgeCandidates(lookup) });
      }
    }
    if (branch) {
      const keys = [
        `branch.${branch}.gh-merge-base`,
        `git-town-branch.${branch}.parent`,
        `gitflow.branch.${branch}.base`,
      ];
      const values = await Promise.all(keys.map((k) => this.repo.configGet(k)));
      keys.forEach((key, i) => {
        const value = values[i];
        if (value && value !== branch) {
          options.push({
            source: 'branch-config',
            why: `git config ${key}=${value}`,
            specs: [classifyRef(value, this.remotes)],
          });
        }
      });
      const matched = base.rules.filter((rule) => untrustedGlobMatcher(rule.match)(branch));
      const names = [...new Set(matched.flatMap((r) => r.base))].filter(
        (n) => n !== branch && isValidBranchName(n),
      );
      if (names.length > 0) {
        const globs = matched.flatMap((r) => (Array.isArray(r.match) ? r.match : [r.match]));
        const rule = globs.filter((g) => untrustedGlobMatcher(g)(branch)).map((g) => `"${g}"`);
        options.push({
          source: 'rules',
          why: `rule ${rule.join(', ')} for ${branch}`,
          specs: names.map((name) => ({ kind: 'branch', name })),
          nearest: true,
        });
      }
    }
    if (base.default && base.default !== 'auto') {
      options.push({
        source: 'default',
        why: `git.base.default=${base.default}`,
        specs: [classifyRef(base.default, this.remotes)],
      });
    }
    options.push({ source: 'default', why: '', specs: [], lazy: () => this.remoteDefault() });
    return options;
  }

  private async forgeCandidates(
    lookup: Promise<ForgePullRequest | undefined>,
  ): Promise<Candidates | undefined> {
    const pr = await lookup;
    this.signal?.throwIfAborted();
    if (!pr) return undefined;
    const remote = (await this.remoteForRepo(pr.baseRepoUrl)) ?? this.remote;
    return {
      specs: [{ kind: 'branch', name: pr.baseBranch, remote }],
      why: `open ${pr.tool === 'gh' ? 'PR' : 'MR'} #${pr.number} (${pr.tool}) targets ${pr.baseBranch}`,
    };
  }

  /** The remote whose URL points at `webUrl` (the repository a PR targets, e.g. `upstream` for forks). */
  private async remoteForRepo(webUrl: string | undefined): Promise<string | undefined> {
    if (!webUrl) return undefined;
    const wanted = webUrl.toLowerCase();
    for (const remote of this.remotes) {
      const info = parseRemote(await this.repo.configGet(`remote.${remote}.url`));
      if (info?.webUrl.toLowerCase() === wanted) return remote;
    }
    return undefined;
  }

  private async remoteDefault(): Promise<Candidates> {
    const r = this.remote;
    if (r && this.remoteHead && (await this.locate({ kind: 'branch', name: this.remoteHead }))) {
      return {
        specs: [{ kind: 'branch', name: this.remoteHead }],
        why: `default branch of ${r} (${r}/HEAD)`,
      };
    }
    const advertised = r ? this.probes.get(r)?.defaultBranch : undefined;
    if (r && advertised) {
      return { specs: [{ kind: 'branch', name: advertised }], why: `default branch of ${r} (ls-remote)` };
    }
    return {
      specs: FALLBACK_DEFAULT_BRANCHES.map((name) => ({ kind: 'branch', name })),
      why: `first existing of ${FALLBACK_DEFAULT_BRANCHES.join(', ')}`,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Network

  private networkFor(remote: string): boolean {
    return !this.offline && this.remotes.includes(remote) && !this.failed.has(remote);
  }

  private remoteOf(spec: RefSpec): { remote: string; name: string } | undefined {
    if (spec.kind === 'remote') return { remote: spec.remote, name: spec.name };
    if (spec.kind === 'branch') {
      const remote = spec.remote ?? this.remote;
      return remote ? { remote, name: spec.name } : undefined;
    }
    return undefined;
  }

  /** One `ls-remote` per remote for every branch any base option or the head might need. */
  private async initialProbe(options: BaseOption[], head: HeadPlan): Promise<void> {
    if (this.offline) return;
    const names = new Map<string, Set<string>>();
    const add = (remote: string, name: string) => {
      const set = names.get(remote) ?? new Set<string>();
      set.add(name);
      names.set(remote, set);
    };
    for (const option of options) {
      for (const spec of option.specs) {
        const at = this.remoteOf(spec);
        if (at) add(at.remote, at.name);
      }
    }
    let wantHead = false;
    const r = this.remote;
    if (r && options.some((o) => o.lazy)) {
      if (this.remoteHead) add(r, this.remoteHead);
      else wantHead = true;
      for (const name of FALLBACK_DEFAULT_BRANCHES) add(r, name);
    }
    for (const w of this.headWants(head)) add(w.remote, w.branch);
    await Promise.all(
      [...names].map(([remote, set]) => this.probe(remote, [...set], remote === r && wantHead)),
    );
  }

  private async probe(remote: string, names: string[], defaultBranch = false): Promise<void> {
    if (!this.networkFor(remote)) return;
    let p = this.probes.get(remote);
    if (!p) {
      p = { ok: true, asked: new Set(), askedHead: false, heads: new Map() };
      this.probes.set(remote, p);
    }
    const probe = p;
    const fresh = [...new Set(names)].filter((n) => isValidBranchName(n) && !probe.asked.has(n)).sort();
    const wantHead = defaultBranch && !probe.askedHead;
    if (fresh.length === 0 && !wantHead) return;
    const res = await this.repo.lsRemote(remote, fresh, {
      defaultBranch: wantHead,
      timeoutMs: this.settings.fetchTimeoutMs,
      signal: this.signal,
    });
    if (!res.ok || !res.result) {
      probe.ok = false;
      this.networkFailed(remote, res);
      return;
    }
    for (const n of fresh) probe.asked.add(n);
    if (wantHead) probe.askedHead = true;
    for (const [name, sha] of res.result.heads) probe.heads.set(name, sha);
    if (res.result.defaultBranch && isValidBranchName(res.result.defaultBranch)) {
      probe.defaultBranch = res.result.defaultBranch;
    }
  }

  private networkFailed(remote: string, res: NetworkResult): void {
    if (res.aborted || this.signal?.aborted) {
      this.signal?.throwIfAborted();
      throw new Error('Aborted');
    }
    const reason = res.error ?? 'unknown error';
    if (this.settings.fetch === 'always') {
      throw new Error(
        `Could not fetch from ${remote}: ${reason}. git.fetch is "always"; pass --offline to use cached refs.`,
      );
    }
    if (!this.failed.has(remote)) {
      this.failed.set(remote, reason);
      this.warn(`Could not fetch from ${remote} (${reason}); using cached refs.`);
    }
  }

  private async remoteHas(remote: string, name: string): Promise<boolean> {
    const p = this.probes.get(remote);
    if (p?.ok && p.asked.has(name)) return p.heads.has(name);
    return (await this.repo.tryResolve(`refs/remotes/${remote}/${name}`)) !== undefined;
  }

  private wantFor(loc: Located): Want[] {
    return loc.kind === 'remote' && loc.remote && loc.branch
      ? [{ remote: loc.remote, branch: loc.branch, dst: loc.ref }]
      : [];
  }

  private headWants(plan: HeadPlan): Want[] {
    const wants: Want[] = [];
    const up = this.upstream;
    if (up && this.remotes.includes(up.remote))
      wants.push({ remote: up.remote, branch: up.branch, dst: up.trackingRef });
    const at = plan.spec ? this.remoteOf(plan.spec) : undefined;
    if (at && this.remotes.includes(at.remote)) {
      wants.push({ remote: at.remote, branch: at.name, dst: `refs/remotes/${at.remote}/${at.name}` });
    }
    return wants;
  }

  /** Fetches the wanted branches that exist on their remote and differ from the cached copy. */
  private async sync(wants: Want[]): Promise<void> {
    const byRemote = new Map<string, Map<string, Want>>();
    for (const w of wants) {
      const p = this.probes.get(w.remote);
      if (!this.networkFor(w.remote) || !p?.ok || !p.heads.has(w.branch)) continue;
      const list = byRemote.get(w.remote) ?? new Map<string, Want>();
      list.set(w.dst, w);
      byRemote.set(w.remote, list);
    }
    await Promise.all([...byRemote].map(([remote, list]) => this.syncRemote(remote, [...list.values()])));
  }

  private async syncRemote(remote: string, wants: Want[]): Promise<void> {
    const probe = this.probes.get(remote)!;
    const log = this.fetchLog.get(remote) ?? { fetched: [], current: [] };
    this.fetchLog.set(remote, log);
    const cached = await Promise.all(wants.map((w) => this.repo.tryResolve(w.dst)));
    const stale: Array<Want & { isNew: boolean }> = [];
    wants.forEach((w, i) => {
      if (cached[i] && cached[i] === probe.heads.get(w.branch)) {
        this.synced.add(w.dst);
        log.current.push(w.branch);
      } else stale.push({ ...w, isNew: cached[i] === undefined });
    });
    if (stale.length === 0) return;
    // In a shallow clone a branch fetched for the first time would otherwise arrive with its whole history.
    const groups = this.shallow ? [stale.filter((w) => !w.isNew), stale.filter((w) => w.isNew)] : [stale];
    for (const [i, group] of groups.entries()) {
      if (group.length === 0) continue;
      const res = await this.repo.fetchRefs(
        remote,
        group.map((w) => `+refs/heads/${w.branch}:${w.dst}`),
        {
          depth:
            this.shallow && i === 1
              ? Math.max(1, Math.min(INITIAL_SHALLOW_DEPTH, this.settings.maxDeepen))
              : undefined,
          timeoutMs: this.settings.fetchTimeoutMs,
          signal: this.signal,
        },
      );
      if (!res.ok) {
        this.networkFailed(remote, res);
        return;
      }
      for (const w of group) {
        this.synced.add(w.dst);
        log.fetched.push(w.branch);
      }
    }
  }

  private fetchLines(): string[] {
    if (this.offline) return [`no fetch (${this.offline})`];
    const lines: string[] = [];
    for (const [remote, reason] of this.failed)
      lines.push(`could not fetch from ${remote} (${reason}): using cached refs`);
    for (const [remote, log] of this.fetchLog) {
      if (this.failed.has(remote)) continue;
      const parts: string[] = [];
      if (log.fetched.length) parts.push(`fetched ${listNames(log.fetched)}`);
      if (log.current.length) parts.push(`${listNames(log.current)} already up to date`);
      if (parts.length) lines.push(`${remote}: ${parts.join('; ')}`);
    }
    return lines.length ? lines : ['nothing to fetch'];
  }

  // ---------------------------------------------------------------------------------------------
  // Resolution

  private async locate(spec: RefSpec, preferLocal = false): Promise<Located | undefined> {
    switch (spec.kind) {
      case 'branch': {
        const remote = spec.remote ?? this.remote;
        const [onRemote, onLocal] = await Promise.all([
          remote ? this.remoteHas(remote, spec.name) : false,
          this.repo.refExists(`refs/heads/${spec.name}`),
        ]);
        const remoteLoc = onRemote && remote ? this.remoteLocated(remote, spec.name) : undefined;
        const local = onLocal ? this.localLocated(spec.name) : undefined;
        if (preferLocal && local) return local;
        if (remoteLoc) return remoteLoc;
        if (local) {
          const probed = remote ? this.probes.get(remote) : undefined;
          const note = !remote
            ? undefined
            : probed?.ok && probed.asked.has(spec.name)
              ? `${remote} has no branch ${spec.name}; using local ${spec.name}`
              : `no cached ${remote}/${spec.name}; using local ${spec.name}`;
          return { ...local, note };
        }
        // Tags and other refs with a branch-like name.
        return (await this.repo.tryResolve(spec.name))
          ? { kind: 'rev', ref: spec.name, display: spec.name }
          : undefined;
      }
      case 'remote':
        return (await this.remoteHas(spec.remote, spec.name))
          ? this.remoteLocated(spec.remote, spec.name)
          : undefined;
      case 'local':
        return (await this.repo.refExists(`refs/heads/${spec.name}`))
          ? this.localLocated(spec.name)
          : undefined;
      case 'rev':
        return (await this.repo.tryResolve(spec.rev))
          ? { kind: 'rev', ref: spec.rev, display: spec.rev }
          : undefined;
    }
  }

  private remoteLocated(remote: string, name: string): Located {
    return {
      kind: 'remote',
      ref: `refs/remotes/${remote}/${name}`,
      display: `${remote}/${name}`,
      branch: name,
      remote,
    };
  }

  private localLocated(name: string): Located {
    return { kind: 'local', ref: `refs/heads/${name}`, display: name, branch: name };
  }

  private async chooseBase(
    options: BaseOption[],
  ): Promise<{ option: BaseOption; why: string; found: Located[] }> {
    for (const option of options) {
      const expanded: Candidates | undefined = option.lazy ? await option.lazy() : option;
      if (!expanded) continue;
      // Candidates not covered by the initial probe (e.g. a forge base on another remote).
      const extra = new Map<string, string[]>();
      for (const spec of expanded.specs) {
        const at = this.remoteOf(spec);
        if (at) extra.set(at.remote, [...(extra.get(at.remote) ?? []), at.name]);
      }
      await Promise.all([...extra].map(([remote, names]) => this.probe(remote, names)));
      const located = await Promise.all(expanded.specs.map((s) => this.locate(s)));
      const found = located.filter((l): l is Located => l !== undefined);
      if (found.length > 0) {
        return { option, why: expanded.why, found: option.nearest ? found : found.slice(0, 1) };
      }
      if (option.ci) {
        const fallback = await this.ciFallback(option.ci);
        if (fallback) return { option, why: fallback.why, found: [fallback.loc] };
      }
      const what = expanded.specs.map((s) => this.describe(s));
      if (option.required) throw new Error(this.notFound(option, what));
      if (option.source !== 'default' || option.why) {
        this.lines.base.push(`skipped ${expanded.why}: ${listNames(what)} not found`);
      }
    }
    throw new Error(
      'Could not determine the base branch (no remote default branch and no main/master/trunk). Pass --base <ref>.',
    );
  }

  private describe(spec: RefSpec): string {
    switch (spec.kind) {
      case 'branch':
        return spec.name;
      case 'remote':
        return `${spec.remote}/${spec.name}`;
      case 'local':
        return `refs/heads/${spec.name}`;
      case 'rev':
        return spec.rev;
    }
  }

  private notFound(option: BaseOption, what: string[]): string {
    const name = what[0] ?? '';
    const failure = this.remote ? this.failed.get(this.remote) : undefined;
    const where = this.remote ? `on ${this.remote} or locally` : 'locally';
    const fetchHint = failure
      ? ` (fetch failed: ${failure})`
      : this.offline && this.remote
        ? ` (not fetched: ${this.offline})`
        : '';
    if (option.ci) {
      return `${option.ci.label} targets ${name}, but it was not found ${where}${fetchHint}. Fetch it (git fetch ${this.remote ?? 'origin'} ${name}) or pass --base <ref>.`;
    }
    return `Base ref "${name}" not found ${where}${fetchHint}. Check the name, or pass a sha or tag.`;
  }

  /** CI jobs whose target branch cannot be fetched: the CI's base sha or the merge commit's first parent. */
  private async ciFallback(ci: CiPullRequest): Promise<{ loc: Located; why: string } | undefined> {
    if (ci.baseSha && (await this.repo.hasCommit(ci.baseSha))) {
      const sha = await this.repo.tryResolve(ci.baseSha);
      if (sha) {
        return {
          loc: { kind: 'rev', ref: sha, display: sha.slice(0, 12) },
          why: `${ci.label} base commit (${ci.baseBranch} is not available)`,
        };
      }
    }
    if (ci.provider === 'github' || ci.provider === 'azure') {
      const head = await this.repo.tryResolve('HEAD');
      const parents = head ? await this.repo.parents(head) : [];
      if (parents.length === 2 && parents[0]) {
        return {
          loc: { kind: 'rev', ref: parents[0], display: 'HEAD^1' },
          why: `first parent of the ${ci.label} merge commit (${ci.baseBranch} is not available)`,
        };
      }
    }
    return undefined;
  }

  private async resolveHead(plan: HeadPlan): Promise<Resolved> {
    if (plan.spec) {
      const found = await this.locate(plan.spec, !plan.preferRemote);
      const loc = found && (await this.usable(found));
      if (loc) {
        this.lines.head.push(`head ${loc.display}: ${plan.why}`);
        if (loc.note && !plan.fallbackToHead) this.notes.push(loc.note);
        return { ...loc, sha: await this.repo.resolveCommit(loc.ref) };
      }
      if (!plan.fallbackToHead)
        throw new Error(`Head ref "${plan.input}" not found. Check the name, or pass a sha.`);
      this.notes.push(`${this.describe(plan.spec)} does not exist; reviewing the local HEAD instead`);
    }
    const sha = await this.repo.tryResolve('HEAD');
    if (!sha) throw new Error('HEAD does not point to a commit yet; commit something first.');
    if (this.opts.local) return this.localHead(sha);
    const display = this.branch ? `HEAD (${this.branch})` : `HEAD (detached at ${sha.slice(0, 7)})`;
    this.lines.head.push(
      `head ${display}: ${this.branch ? 'local branch, including unpushed commits' : 'local checkout'}`,
    );
    return { kind: 'local', ref: 'HEAD', display, branch: this.branch, sha, isHead: true };
  }

  /** The staged or uncommitted changes, committed on top of HEAD (`headSha`). */
  private async localHead(headSha: string): Promise<Resolved> {
    const { mode, ...options } = this.opts.local!;
    const local = await commitLocalChanges(this.repo, mode, options);
    const where = this.branch ? `on ${this.branch}` : `at ${headSha.slice(0, 7)}`;
    const display = `${mode} changes ${where}`;
    const what =
      mode === 'staged'
        ? 'the index, as `git commit` would record it'
        : `tracked changes${local.untracked ? ` and ${plural(local.untracked, 'untracked file')}` : ''} of the working tree`;
    this.lines.head.push(`head ${display}: ${what}, as snapshot ${local.sha.slice(0, 7)} on top of HEAD`);
    return { kind: 'rev', ref: local.sha, display, branch: this.branch, sha: local.sha, isHead: true, local };
  }

  /**
   * `loc` when it resolves; a remote branch that is not cached (its fetch failed) falls back to the local
   * branch of the same name, with a note; undefined when neither exists.
   */
  private async usable(loc: Located): Promise<Located | undefined> {
    if (loc.kind !== 'remote' || (await this.repo.tryResolve(loc.ref))) return loc;
    if (loc.branch && (await this.repo.refExists(`refs/heads/${loc.branch}`))) {
      return {
        ...this.localLocated(loc.branch),
        note: `${loc.display} is not available (fetch failed); using the local ${loc.branch}`,
      };
    }
    return undefined;
  }

  private async nearest(found: Located[], headSha: string): Promise<{ loc: Located; detail: string }> {
    const counts = await Promise.all(found.map((l) => this.repo.countCommits(`${l.ref}..${headSha}`)));
    let best = 0;
    for (let i = 1; i < found.length; i++) if (counts[i]! < counts[best]!) best = i;
    const detail = found.map((l, i) => `${l.display} +${counts[i]}`).join(', ');
    return { loc: found[best]!, detail: `nearest ancestor by commits on head (${detail})` };
  }

  private async mergeBase(base: Resolved, head: Resolved): Promise<string> {
    const mb = await this.repo.tryMergeBase(base.sha, head.sha);
    if (mb) return mb;
    if (!this.shallow) {
      throw new Error(
        `${base.display} and ${head.display} have no common history. Pass --base <ref> to choose another base.`,
      );
    }
    return this.deepen(base, head);
  }

  /** Deepens a shallow clone step by step (up to git.maxDeepen commits) until a merge-base exists. */
  private async deepen(base: Resolved, head: Resolved): Promise<string> {
    const max = this.settings.maxDeepen;
    const remote = base.remote ?? head.remote ?? this.upstream?.remote ?? this.remote;
    const stuck = (why: string) =>
      new Error(
        `No merge-base between ${base.display} and ${head.display} in this shallow clone (${why}). ` +
          `Fetch more history (git fetch --unshallow${remote ? ` ${remote}` : ''}) or raise git.maxDeepen.`,
      );
    if (!remote || !this.networkFor(remote))
      throw stuck(this.offline ? `not fetching: ${this.offline}` : 'remote unavailable');
    if (max <= 0) throw stuck('git.maxDeepen is 0');
    const refspecs = new Set<string>();
    for (const loc of [base, head]) {
      if (loc.kind === 'remote' && loc.remote === remote && loc.branch)
        refspecs.add(`+refs/heads/${loc.branch}:${loc.ref}`);
    }
    const up = this.upstream;
    if (up && up.remote === remote) refspecs.add(`+refs/heads/${up.branch}:${up.trackingRef}`);
    // Shallow boundaries are only deepened along the wanted history, so ask for the local commits too.
    let wants = [...new Set([base, head].filter((l) => l.kind !== 'remote').map((l) => l.sha))];
    let total = 0;
    let step = DEEPEN_STEP;
    while (total < max) {
      const n = Math.min(step, max - total);
      const opts = { deepen: n, timeoutMs: this.settings.fetchTimeoutMs, signal: this.signal };
      let res = await this.repo.fetchRefs(remote, [...refspecs], { ...opts, wants });
      if (!res.ok && !res.aborted && wants.length > 0 && refspecs.size > 0) {
        // The server refuses unadvertised (e.g. unpushed) commits: deepen along the branches only.
        wants = [];
        res = await this.repo.fetchRefs(remote, [...refspecs], opts);
      }
      if (!res.ok) {
        if (res.aborted) this.signal?.throwIfAborted();
        throw stuck(`deepening failed: ${res.error}`);
      }
      total += n;
      step *= 2;
      const mb = await this.repo.tryMergeBase(base.sha, head.sha);
      if (mb) {
        this.lines.extra.push(
          `shallow clone: fetched ${total} more commits of history to find the merge-base`,
        );
        return mb;
      }
      if (!(await this.repo.isShallow())) break;
    }
    throw stuck(`deepened by ${total} commits, git.maxDeepen=${max}`);
  }

  private nothingToReview(
    base: Resolved,
    head: Resolved,
    onBase: boolean,
    why: string,
    dirty: number,
  ): string {
    const what = onBase
      ? `You are on ${this.branch}, the base branch itself, and it has no commits that ${base.display} does not already contain.`
      : `${head.display} has no commits that ${base.display} does not already contain (base from ${why}).`;
    const dirtyHint = dirty > 0 ? ' Uncommitted changes are not reviewed: commit them first, or' : '';
    return `Nothing to review: ${what}${dirtyHint} pass --base <ref> to choose what to compare against (e.g. --base HEAD~1 for the last commit).`;
  }

  // ---------------------------------------------------------------------------------------------
  // Notices

  /** Explains remote-tracking refs that were not refreshed this run (offline or fetch failure). */
  private async cacheNotices(loc: Resolved): Promise<Notices> {
    if (loc.kind !== 'remote' || !loc.remote || this.synced.has(loc.ref)) return {};
    const failure = this.failed.get(loc.remote);
    if (!failure && !this.offline) return {};
    const updated = await this.repo.refUpdatedAt(loc.ref);
    const fetched = updated ? undefined : await this.repo.lastFetchAt();
    const age = updated
      ? `last updated ${formatAge(Date.now() - updated.getTime())}`
      : fetched
        ? `last fetch ${formatAge(Date.now() - fetched.getTime())}`
        : 'age unknown';
    return failure
      ? { notes: [`${loc.display} could not be fetched (${failure}); using the cached ref, ${age}`] }
      : { extra: [`${loc.display} not fetched (${this.offline}): cached ref, ${age}`] };
  }

  private async headNotices(head: Resolved, plan: HeadPlan): Promise<Notices> {
    const up = this.upstream;
    const branch = this.branch;
    if (!branch) return {};
    if (head.isHead) {
      if (!up) return { head: [`${branch} has no upstream branch: all its commits are local`] };
      const upDisplay = up.trackingRef.replace(/^refs\/remotes\//, '');
      if (!(await this.repo.refExists(up.trackingRef))) {
        return { head: [`upstream ${upDisplay} is not available locally: unpushed commits unknown`] };
      }
      const { left: ahead, right: behind } = await this.repo.aheadBehind('HEAD', up.trackingRef);
      const notes: string[] = [];
      if (ahead > 0) notes.push(`${plural(ahead, 'unpushed commit')} on ${branch} included in the review`);
      if (behind > 0) {
        notes.push(
          `local ${branch} is ${behind} behind ${upDisplay}; those commits are not reviewed (pull to include them)`,
        );
      }
      return { notes };
    }
    // git.headSource=remote: say which local commits the review leaves out.
    if (
      plan.fallbackToHead &&
      head.kind === 'remote' &&
      (await this.repo.refExists(`refs/heads/${branch}`))
    ) {
      const { left: ahead } = await this.repo.aheadBehind(`refs/heads/${branch}`, head.ref);
      if (ahead > 0) {
        const verb = ahead === 1 ? 'is' : 'are';
        return {
          notes: [
            `${plural(ahead, 'local commit')} on ${branch} not pushed to ${head.display} ${verb} not reviewed (git.headSource=remote)`,
          ],
        };
      }
    }
    return {};
  }

  /** "local develop is 3 behind origin/develop" when the base is a remote branch with a local twin. */
  private async baseNotices(base: Resolved, head: Resolved): Promise<Notices> {
    if (base.kind !== 'remote' || !base.branch) return {};
    if (head.isHead && base.branch === this.branch) {
      return {
        base: [`on the base branch ${this.branch} itself: reviewing its commits not in ${base.display}`],
      };
    }
    const local = `refs/heads/${base.branch}`;
    if (!(await this.repo.refExists(local))) return {};
    const { left: ahead, right: behind } = await this.repo.aheadBehind(local, base.ref);
    if (ahead === 0 && behind === 0) return {};
    const state =
      ahead > 0 && behind > 0
        ? `has diverged from ${base.display} (${ahead} ahead, ${behind} behind)`
        : behind > 0
          ? `is ${behind} behind ${base.display}`
          : `is ${ahead} ahead of ${base.display} (unpushed)`;
    return { notes: [`local ${base.branch} ${state}; comparing against ${base.display}`] };
  }
}
