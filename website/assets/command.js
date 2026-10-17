// The "already installed" half of the setup wizard: pick what to review and the options, get the exact command
// line with its flags explained. Every flag exists in `code-reviewer review --help`; defaults follow
// src/config/schema.ts. setup.js hosts the steps.
import { escapeHtml } from './site.js';

const CDN = 'https://cdn.jsdelivr.net/npm/simple-icons@16.33.0/icons/';
const ICON = (name) => `<img src="${CDN}${name}.svg" alt="">`;
const MONO = (text, cls = '') => `<span class="logo-mono ${cls}">${text}</span>`;

const WHAT = [
  {
    id: 'branch',
    label: 'My branch against its base',
    hint: 'The base is detected: the open pull request, your branch rules, or main.',
    cmd: 'review',
  },
  {
    id: 'base',
    label: 'My branch against a branch I name',
    hint: 'Like a pull request into that branch: what my branch changed since it left it.',
    cmd: 'review',
    inputs: ['base'],
  },
  {
    id: 'two',
    label: 'One branch against another',
    hint: 'A release branch against the previous one, a colleague’s branch against develop.',
    cmd: 'review',
    inputs: ['base', 'head'],
  },
  {
    id: 'staged',
    label: 'What I am about to commit',
    hint: 'The staged changes, exactly what git commit would record.',
    cmd: 'review',
    flag: '--staged',
  },
  {
    id: 'uncommitted',
    label: 'Everything I changed locally',
    hint: 'The working tree, untracked files included.',
    cmd: 'review',
    flag: '--uncommitted',
  },
  {
    id: 'files',
    label: 'Whole files or folders',
    hint: 'Not a diff: the complete contents of a path, for legacy code or a one-off audit.',
    cmd: 'files',
    inputs: ['path'],
  },
];
const INPUTS = {
  base: { label: 'Base branch', placeholder: 'BASE_BRANCH', example: 'main' },
  head: { label: 'Branch to review', placeholder: 'HEAD_BRANCH', example: 'feature/login' },
  path: { label: 'File or folder', placeholder: 'PATH', example: 'src/payments' },
};

// Cost figures: Martian's 50 pull requests, 0.12.0 with Claude Sonnet on the Anthropic API (BENCHMARKS.md).
const FULL_COST = [0.3, 0.4];
const DEPTH = [
  {
    id: 'essential',
    label: 'Essential',
    hint: 'Only what can hurt production. Critical and major findings, each with a fix.',
    cost: '≈ half of full; finds far less (8% of known bugs)',
    mult: 0.5,
  },
  {
    id: 'full',
    label: 'Full',
    tag: 'default',
    hint: 'Every real defect, the whole-diff sweep and up to five checked maintainability notes.',
    cost: '≈ $0.30–0.40 per pull request with Claude Sonnet on the API',
    mult: 1,
  },
  {
    id: 'deepen',
    label: 'Full + second pass',
    hint: 'Every chunk reviewed twice, independently; agreement is evidence for the critic.',
    cost: '≈ 1.5–2× full; finds the most (72% of known bugs)',
    mult: 1.7,
  },
];

const PROVIDERS = [
  {
    id: '',
    label: 'Configured default',
    icon: MONO('⚙', 'logo-mono-light'),
    hint: 'Whatever .code-reviewer/config.yaml says; Claude Code with Sonnet after init.',
    models: [],
  },
  {
    id: 'claude',
    label: 'Claude Code',
    icon: ICON('claude'),
    hint: 'Your Claude Code login.',
    models: ['sonnet', 'opus', 'haiku', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    note: 'Aliases follow Claude Code’s current models; a full id pins a version.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic API',
    icon: ICON('anthropic'),
    hint: 'ANTHROPIC_API_KEY, prompt caching.',
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
    note: 'Sonnet 5.5 is the default. Opus costs more and measured the same recall; Haiku is the cheap option for essential depth.',
  },
  {
    id: 'bedrock',
    label: 'AWS Bedrock',
    icon: MONO('aws'),
    hint: 'AWS credentials or a role.',
    models: [
      'global.anthropic.claude-sonnet-5-5',
      'global.anthropic.claude-opus-5-5',
      'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    ],
    note: 'Inference profile ids; us. and eu. prefixes work too.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    icon: MONO('AI'),
    hint: 'OPENAI_API_KEY; a model is required.',
    models: ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.5'],
    note: 'No default: name a model that supports tool calling.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    icon: ICON('openrouter'),
    hint: 'Any OpenRouter model id.',
    models: ['qwen/qwen3-coder', 'anthropic/claude-sonnet-5.5', 'openai/gpt-5.5'],
    note: 'Any id from openrouter.ai/models.',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    icon: ICON('ollama'),
    hint: 'A local model; nothing leaves the machine.',
    models: ['qwen3-coder:30b', 'gpt-oss:120b', 'devstral:24b'],
    note: 'Needs tool calling and a context window that fits a chunk (OLLAMA_CONTEXT_LENGTH).',
  },
  { id: 'codex', label: 'Codex CLI', icon: MONO('AI'), hint: 'Your Codex login. Experimental.', models: [] },
  {
    id: 'copilot',
    label: 'Copilot CLI',
    icon: ICON('githubcopilot'),
    hint: 'Your Copilot login. Experimental.',
    models: [],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    icon: ICON('googlegemini'),
    hint: 'Your Gemini login. Experimental.',
    models: [],
  },
];

const SEVERITIES = ['critical', 'major', 'minor', 'info'];
const FORMATS = ['md', 'json', 'html', 'sarif', 'codequality'];

/**
 * Options. `on` ones are off by default and add `flag` when picked; `off` ones are on by default and add `flag`
 * when unpicked. `control` adds an inline input whose value goes into the flag.
 */
const OPTIONS = [
  {
    group: 'Result',
    id: 'post',
    kind: 'on',
    label: 'Comment on the pull request',
    flag: '--post',
    hint: 'Inline comments and one summary on the branch’s pull or merge request; later runs update them.',
    prs: true,
  },
  {
    group: 'Result',
    id: 'failon',
    kind: 'on',
    label: 'Fail the run on findings',
    flag: '--fail-on',
    hint: 'Exit code 1 when a finding of this severity or worse remains, or when part of the change was not reviewed.',
    control: 'severity',
  },
  {
    group: 'Result',
    id: 'formats',
    kind: 'on',
    label: 'Write report files',
    flag: '--format',
    hint: 'Copies the chosen reports into ./reports. SARIF for GitHub code scanning, codequality for the GitLab widget.',
    control: 'formats',
  },
  {
    group: 'Result',
    id: 'json',
    kind: 'on',
    label: 'Print the run as JSON',
    flag: '--json',
    hint: 'The whole run on stdout, for scripts; human logs stay on stderr.',
  },
  {
    group: 'Result',
    id: 'minsev',
    kind: 'on',
    label: 'Hide minor and info findings',
    flag: '--min-severity major',
    hint: 'Drops findings below major from the report; --fail-on is unaffected.',
  },
  {
    group: 'Result',
    id: 'authors',
    kind: 'on',
    label: 'Attribute findings to authors',
    flag: '--authors',
    hint: 'git blame on each finding: who last changed the line, with a link to the commit.',
  },
  {
    group: 'Before spending',
    id: 'dry',
    kind: 'on',
    label: 'Plan only, no model calls',
    flag: '--dry-run',
    hint: 'Files, chunks, skills, static hints and a token estimate. Costs nothing.',
  },
  {
    group: 'Before spending',
    id: 'explain',
    kind: 'on',
    label: 'Explain how base and head were chosen',
    flag: '--explain-refs',
    hint: 'Prints the branch rules and the pull request that decided the two refs.',
  },
  {
    group: 'Before spending',
    id: 'cap',
    kind: 'on',
    label: 'Stop spending at a limit',
    flag: '--max-cost',
    hint: 'No model call starts once the run has spent this much; the report says what was skipped.',
    control: 'money',
  },
  {
    group: 'Context',
    id: 'offline',
    kind: 'on',
    label: 'Do not fetch',
    flag: '--offline',
    hint: 'Compare local refs only; no fetch and no forge lookups.',
  },
  {
    group: 'Context',
    id: 'expand',
    kind: 'on',
    label: 'More of the unchanged code',
    flag: '--expand refs',
    hint: 'Excerpts of the code that uses what changed, next to each chunk. The default, map, lists only file:line.',
  },
  {
    group: 'Context',
    id: 'analyzers',
    kind: 'on',
    label: 'Run the project’s own linters',
    flag: '--analyzers eslint,tsc',
    hint: 'Opt-in because they load repository configs: eslint and tsc feed the model exact lines.',
  },
  {
    group: 'Always on: unpick to turn off',
    id: 'critique',
    kind: 'off',
    label: 'Self-critique',
    flag: '--no-self-critique',
    hint: 'A second model verifies every finding. Off: cheaper and noisier.',
  },
  {
    group: 'Always on: unpick to turn off',
    id: 'sweep',
    kind: 'off',
    label: 'Whole-diff sweep',
    flag: '--no-sweep',
    hint: 'One more call reads the entire change for what the chunks missed. About 30% of a run’s cost; on at full depth.',
  },
  {
    group: 'Always on: unpick to turn off',
    id: 'notes',
    kind: 'off',
    label: 'Maintainability notes',
    flag: '--no-notes',
    hint: 'Up to five checked notes on what the change makes harder to maintain. On at full depth.',
  },
  {
    group: 'Always on: unpick to turn off',
    id: 'second',
    kind: 'off',
    label: 'Second opinion',
    flag: '--no-second-opinion',
    hint: 'Another verifier re-checks findings the critic was unsure about. On at full depth.',
  },
  {
    group: 'Always on: unpick to turn off',
    id: 'tools',
    kind: 'off',
    label: 'Read-only tools',
    flag: '--no-tools',
    hint: 'read_file, grep, find_references and the rest. Off, the model sees only the chunk.',
  },
  {
    group: 'Always on: unpick to turn off',
    id: 'static',
    kind: 'off',
    label: 'Static pre-pass',
    flag: '--no-analyzers',
    hint: 'Secret scanning, bug-pattern rules and ast-grep checks, as hints the model confirms.',
  },
  {
    group: 'Always on: unpick to turn off',
    id: 'cache',
    kind: 'off',
    label: 'Result cache',
    flag: '--no-cache',
    hint: 'Answers for unchanged code are reused: a re-run after a fix pays only for what changed.',
  },
];

const state = {
  what: 'branch',
  depth: 'full',
  provider: '',
  model: '',
  base: '',
  head: '',
  path: '',
  on: new Set(['post', 'critique', 'sweep', 'notes', 'second', 'tools', 'static', 'cache']),
  severity: 'major',
  formats: new Set(['md', 'html']),
  cap: '5',
  reasoning: 'medium',
  batch: false,
};

/**
 * The command is a list of tokens: plain flags, a value the user typed (`user`), or a placeholder (`ph`) when the
 * field is empty. HTML and the copied text are both rendered from it, so nothing is parsed back out of HTML.
 */
const value = (key) => {
  const v = state[key].trim();
  return v ? { user: v } : { ph: INPUTS[key].placeholder };
};
const tokenText = (t) => (typeof t === 'string' ? t : (t.user ?? `<${t.ph}>`));
const tokenHtml = (t) =>
  typeof t === 'string'
    ? escapeHtml(t)
    : t.user !== undefined
      ? `<span class="tok-s">${escapeHtml(t.user)}</span>`
      : `<span class="ph">&lt;${escapeHtml(t.ph)}&gt;</span>`;
const prOk = () => ['branch', 'base', 'two'].includes(state.what);
const what = () => WHAT.find((w) => w.id === state.what);
const provider = () => PROVIDERS.find((p) => p.id === state.provider);

function command() {
  const w = what();
  const parts = ['code-reviewer', w.cmd];
  const why = [];
  let mult = DEPTH.find((d) => d.id === state.depth).mult;
  if (w.id === 'files') {
    parts.push(value('path'));
    why.push([
      'files <PATH>',
      'Whole files, not a diff. A folder is reviewed file by file, each with its related files as context.',
    ]);
  }
  if (w.inputs?.includes('base')) {
    parts.push('--base', value('base'));
    why.push([
      '--base',
      'The branch the work started from. A bare name means the freshly fetched remote branch.',
    ]);
  }
  if (w.inputs?.includes('head')) {
    parts.push('--head', value('head'));
    why.push(['--head', 'The branch with the work. Defaults to HEAD, unpushed commits included.']);
  }
  if (w.flag) {
    parts.push(w.flag);
    why.push([
      w.flag,
      w.id === 'staged'
        ? 'A throw-away commit of the index is reviewed; your refs stay as they are.'
        : 'A throw-away commit of the working tree, untracked files included.',
    ]);
  }
  if (state.depth === 'essential') {
    parts.push('--essential');
    why.push([
      '--essential',
      'Only security, data loss, crashes, leaks, overload and costly performance, reported as critical or major with a fix.',
    ]);
  }
  if (state.depth === 'deepen') {
    parts.push('--deepen');
    why.push([
      '--deepen',
      'An independent second review pass over every chunk at high reasoning; agreement between passes is evidence for the critic.',
    ]);
  }
  const p = provider();
  if (p.id) {
    parts.push(`--provider ${p.id}`);
    why.push([
      `--provider ${p.id}`,
      `Review and verification with ${p.label} instead of the configured default.`,
    ]);
    const model = state.model.trim() || (p.id === 'openai' ? p.models[0] : '');
    if (model) {
      parts.push('--model', { user: model });
      why.push([
        `--model ${model}`,
        'The model for the review role; --critique-model changes the verifier separately.',
      ]);
    }
    if (p.id === 'anthropic' && state.batch) {
      parts.push('--batch');
      why.push([
        '--batch',
        'The whole-diff sweep goes out as a Message Batches request at half price; a run costs about 15% less.',
      ]);
    }
  }
  if (state.reasoning !== 'medium') {
    parts.push(`--reasoning ${state.reasoning}`);
    why.push([
      `--reasoning ${state.reasoning}`,
      'Reasoning effort of the review model. Medium is the default; high measured no better on real bugs, so spend it on --deepen instead.',
    ]);
  }
  for (const o of OPTIONS) {
    const active = state.on.has(o.id);
    if (o.kind === 'on' && !active) continue;
    if (o.kind === 'off' && active) continue;
    if (o.prs && !prOk()) continue;
    let flag = o.flag;
    if (o.control === 'severity') flag = `--fail-on ${state.severity}`;
    if (o.control === 'formats') {
      const list = FORMATS.filter((f) => state.formats.has(f));
      if (!list.length) continue;
      flag = `--format ${list.join(',')} --out reports`;
    }
    if (o.control === 'money') flag = `--max-cost ${Number(state.cap) > 0 ? Number(state.cap) : 5}`;
    parts.push(flag);
    why.push([flag, o.hint]);
    if (o.id === 'sweep') mult *= 0.7;
    if (o.id === 'critique') mult *= 0.75;
    if (o.id === 'dry') mult = 0;
  }
  const cost =
    mult === 0
      ? 'nothing: no model is called'
      : `≈ $${(FULL_COST[0] * mult).toFixed(2)}–${(FULL_COST[1] * mult).toFixed(2)} per pull request with Claude Sonnet, going by the 50 benchmark pull requests; yours will differ with size`;
  return { line: parts.map(tokenHtml).join(' '), plain: parts.map(tokenText).join(' '), why, cost };
}

const tile = (name, it, checked, extra = '') =>
  `<label class="tile${it.icon ? ' tile-sm' : ''}"><input type="radio" name="${name}" value="${it.id}"${checked ? ' checked' : ''}><span class="tile-check" aria-hidden="true"></span>${it.icon ? `<span class="tile-icon">${it.icon}</span>` : ''}<span class="tile-text"><b>${escapeHtml(it.label)}${it.tag ? ` <span class="badge badge-blue">${it.tag}</span>` : ''}</b><small>${escapeHtml(it.hint)}</small>${extra}</span></label>`;

const optionCard = (o) => `<label class="opt${o.prs && !prOk() ? ' off' : ''}" data-opt="${o.id}">
  <input type="checkbox" name="opt" value="${o.id}"${state.on.has(o.id) ? ' checked' : ''}${o.prs && !prOk() ? ' disabled' : ''}>
  <span class="tile-check" aria-hidden="true"></span>
  <span class="opt-text">
    <b>${escapeHtml(o.label)}</b>
    <code>${escapeHtml(o.control === 'severity' ? '--fail-on …' : o.control === 'formats' ? '--format … --out reports' : o.control === 'money' ? '--max-cost …' : o.flag)}</code>
    <small>${escapeHtml(o.hint)}</small>
    ${o.control === 'severity' ? `<span class="inline-ctl"><span class="segmented seg-sm">${SEVERITIES.map((s) => `<button type="button" data-sev="${s}" aria-pressed="${s === state.severity}">${s}</button>`).join('')}</span></span>` : ''}
    ${o.control === 'formats' ? `<span class="inline-ctl"><span class="chips">${FORMATS.map((f) => `<button type="button" class="chip${state.formats.has(f) ? ' on' : ''}" data-fmt="${f}">${f}</button>`).join('')}</span></span>` : ''}
    ${o.control === 'money' ? `<span class="inline-ctl"><span class="money"><i>$</i><input type="number" name="cap" min="0.1" step="0.5" value="${state.cap}" aria-label="Cost limit in dollars"></span></span>` : ''}
  </span>
</label>`;

/** The steps setup.js shows after "already installed". */
export const commandSteps = [
  {
    id: 'what',
    title: 'What do you want to review?',
    short: 'What',
    label: () => what().label,
    render: () => `
      <div class="tiles">${WHAT.map((w) => tile('what', w, w.id === state.what)).join('')}</div>
      <div class="cmd-inputs">${Object.entries(INPUTS)
        .map(
          ([k, v]) =>
            `<label class="cmd-input" data-input="${k}"${what().inputs?.includes(k) ? '' : ' hidden'}><span>${v.label}</span><input type="text" name="${k}" value="${escapeHtml(state[k])}" placeholder="${escapeHtml(v.example)}" autocomplete="off" spellcheck="false"></label>`,
        )
        .join('')}</div>`,
  },
  {
    id: 'cdepth',
    title: 'How deep?',
    short: 'Depth',
    label: () => DEPTH.find((d) => d.id === state.depth).label,
    render: () =>
      `<div class="tiles">${DEPTH.map((d) => tile('depth', d, d.id === state.depth, `<em class="cost">${escapeHtml(d.cost)}</em>`)).join('')}</div>`,
  },
  {
    id: 'cprovider',
    title: 'Which model?',
    short: 'Model',
    label: () => `${provider().label}${state.model ? ` · ${state.model}` : ''}`,
    render: () => `
      <div class="tiles provider-tiles">${PROVIDERS.map((p) => tile('provider', p, p.id === state.provider)).join('')}</div>
      <div class="model-box" data-model${provider().id ? '' : ' hidden'}>
        <div class="cmd-inputs model-row">
          <label class="cmd-input"><span>Model</span><input type="text" name="model" value="${escapeHtml(state.model)}" placeholder="${escapeHtml(provider().models[0] ?? 'model id')}" autocomplete="off" spellcheck="false"></label>
          <span class="chips">${provider()
            .models.map(
              (m) =>
                `<button type="button" class="chip${state.model === m ? ' on' : ''}" data-chip="${escapeHtml(m)}">${escapeHtml(m)}</button>`,
            )
            .join('')}</span>
        </div>
        ${provider().note ? `<p class="fine">${escapeHtml(provider().note)}</p>` : ''}
        ${provider().id === 'anthropic' ? `<label class="opt opt-inline"><input type="checkbox" name="batch"${state.batch ? ' checked' : ''}><span class="tile-check" aria-hidden="true"></span><span class="opt-text"><b>Sweep as a batch request</b><code>--batch</code><small>Half price for the whole-diff sweep, about 15% off the run; answered within 20 minutes or sent normally.</small></span></label>` : ''}
      </div>
      <div class="model-extra">
        <p class="opt-group">Reasoning effort</p>
        <div class="segmented seg-sm">${['none', 'low', 'medium', 'high'].map((r) => `<button type="button" data-reasoning="${r}" aria-pressed="${r === state.reasoning}">${r}${r === 'medium' ? ' · default' : ''}</button>`).join('')}</div>
        <p class="fine">Applies to the review model. High reasoning measured no better on real bugs than medium; a second pass (--deepen) does.</p>
      </div>`,
  },
  {
    id: 'copts',
    title: 'Anything else?',
    short: 'Options',
    label: () => {
      const n = OPTIONS.filter((o) =>
        o.kind === 'on' ? state.on.has(o.id) && !(o.prs && !prOk()) : !state.on.has(o.id),
      ).length;
      return n ? `${n} chosen` : 'Defaults';
    },
    render: () =>
      `<p class="fine opt-intro">Pick what you want added. The last group is what a review does anyway: unpick a card there to turn that part off.</p>${[
        ...new Set(OPTIONS.map((o) => o.group)),
      ]
        .map(
          (g) =>
            `<p class="opt-group">${escapeHtml(g)}</p><div class="opt-grid">${OPTIONS.filter(
              (o) => o.group === g,
            )
              .map(optionCard)
              .join('')}</div>`,
        )
        .join('')}`,
  },
];

export function renderCommandOut() {
  const { line, plain, why, cost } = command();
  const w = what();
  const after = [];
  if (!state.on.has('dry')) after.push(['code-reviewer runs open latest', 'the HTML report of this run']);
  if (state.on.has('post') && prOk())
    after.push(['code-reviewer runs publish latest --dry-run', 'what would be posted, before posting']);
  if (w.id === 'branch' || w.id === 'base')
    after.push(['code-reviewer review --explain-refs', 'why these two refs']);
  return `
    <div class="setup-out-head"><div><h3>Your command</h3></div><span class="muted">Updates as you choose.</span></div>
    <div class="cmd-line">
      <button class="copy" type="button" data-copy="${escapeHtml(plain)}"><span class="copy-label">Copy</span></button>
      <pre><span class="tok-p">$ </span>${line}</pre>
    </div>
    <p class="cmd-cost"><b>Cost</b> ${cost}.${w.inputs ? ' Capitals are placeholders: fill the fields in step 2 or replace them in the command.' : ''}</p>
    <dl class="flag-list">${why.map(([f, t]) => `<div><dt><code>${escapeHtml(f)}</code></dt><dd>${escapeHtml(t)}</dd></div>`).join('')}</dl>
    ${after.length ? `<p class="cmd-after-title">Afterwards</p><div class="code-block"><pre>${after.map(([c, n]) => `<span class="tok-p">$ </span>${escapeHtml(c)}   <span class="tok-c"># ${escapeHtml(n)}</span>`).join('\n')}</pre></div>` : ''}
    <p class="fine"><code>code-reviewer review --help</code> lists every flag; each has a key in <code>.code-reviewer/config.yaml</code>.</p>`;
}

/**
 * Handles an event inside a command step. Returns what to re-render: 'step' (the panel too) or 'out' (the
 * stepper and the output only), or false when the event was not ours.
 */
export function onCommandEvent(e) {
  const el = e.target;
  if (e.type === 'change') {
    if (el.name === 'what') {
      state.what = el.value;
      return 'step';
    }
    if (el.name === 'depth') {
      state.depth = el.value;
      return 'out';
    }
    if (el.name === 'provider') {
      state.provider = el.value;
      state.model = '';
      return 'step';
    }
    if (el.name === 'opt') {
      if (el.checked) state.on.add(el.value);
      else state.on.delete(el.value);
      return 'out';
    }
    if (el.name === 'batch') {
      state.batch = el.checked;
      return 'out';
    }
    return false;
  }
  if (e.type === 'input') {
    if (el.name in INPUTS || el.name === 'model' || el.name === 'cap') {
      state[el.name] = el.value;
      return 'out';
    }
    return false;
  }
  if (e.type === 'click') {
    const sev = el.closest('[data-sev]');
    const fmt = el.closest('[data-fmt]');
    const chip = el.closest('[data-chip]');
    const reasoning = el.closest('[data-reasoning]');
    if (!sev && !fmt && !chip && !reasoning) return false;
    e.preventDefault();
    if (sev) {
      state.severity = sev.dataset.sev;
      state.on.add('failon');
    } else if (fmt) {
      if (state.formats.has(fmt.dataset.fmt)) state.formats.delete(fmt.dataset.fmt);
      else state.formats.add(fmt.dataset.fmt);
      state.on.add('formats');
    } else if (reasoning) {
      state.reasoning = reasoning.dataset.reasoning;
    } else {
      state.model = state.model === chip.dataset.chip ? '' : chip.dataset.chip;
    }
    return 'step';
  }
  return false;
}
