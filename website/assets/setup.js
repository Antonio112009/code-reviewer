// The setup builder on the home page: four short steps, and the exact commands for that setup on the right.
import { commandSteps, onCommandEvent, renderCommandOut } from './command.js';
import { escapeHtml } from './site.js';

const PKG = '@antonio112009/code-reviewer';
/** A GitHub Actions expression, `${{ … }}`, spelled so it is not a template literal. */
const GH = (expr) => `$${'{{'} ${expr} }}`;
const ICON = (name) =>
  `<img src="https://cdn.jsdelivr.net/npm/simple-icons@16.33.0/icons/${name}.svg" alt="">`;
const MONO = (text) => `<span class="logo-mono">${text}</span>`;
const SVG_TERMINAL =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m7 9 3 3-3 3M12 15h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const WHERE = [
  {
    id: 'terminal',
    label: 'My terminal',
    icon: SVG_TERMINAL,
    hint: 'A branch against its base, or the staged changes before you commit.',
  },
  {
    id: 'github',
    label: 'GitHub Actions',
    icon: ICON('github'),
    hint: 'The official action: comments, a summary and SARIF on every pull request.',
  },
  {
    id: 'gitlab',
    label: 'GitLab CI',
    icon: ICON('gitlab'),
    hint: 'A CI template: merge request comments and a Code Quality report.',
  },
  {
    id: 'bitbucket',
    label: 'Bitbucket Pipelines',
    icon: ICON('bitbucket'),
    hint: 'Reviews pull requests in Bitbucket Cloud.',
  },
  { id: 'azure', label: 'Azure Pipelines', icon: MONO('AZ'), hint: 'Threads on Azure DevOps pull requests.' },
  {
    id: 'gitea',
    label: 'Gitea / Forgejo',
    icon: ICON('gitea'),
    hint: 'Gitea and Forgejo Actions, Codeberg included.',
  },
];

const PROVIDERS = [
  {
    id: 'claude',
    label: 'Claude Code',
    icon: ICON('claude'),
    hint: 'The login you already have. Sonnet reviews and verifies.',
    model: 'sonnet',
  },
  {
    id: 'anthropic',
    label: 'Anthropic API',
    icon: ICON('anthropic'),
    hint: 'An API key. No agent in between, prompt caching: the cheapest in CI.',
    env: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'bedrock',
    label: 'AWS Bedrock',
    icon: MONO('aws'),
    hint: 'Your AWS credentials or an OIDC role. Claude on Bedrock.',
    model: 'global.anthropic.claude-sonnet-5',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    icon: MONO('AI'),
    hint: 'Your Codex login, over ACP. Experimental.',
    cliOnly: true,
  },
  {
    id: 'copilot',
    label: 'Copilot CLI',
    icon: ICON('githubcopilot'),
    hint: 'Your Copilot login, over ACP. Experimental.',
    cliOnly: true,
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    icon: ICON('googlegemini'),
    hint: 'Your Gemini login, over ACP. Experimental.',
    cliOnly: true,
  },
  {
    id: 'openai',
    label: 'OpenAI API',
    icon: MONO('AI'),
    hint: 'Any OpenAI model that supports tool calling.',
    env: 'OPENAI_API_KEY',
    model: 'gpt-5',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    icon: ICON('openrouter'),
    hint: 'Any model on OpenRouter, by its id.',
    env: 'OPENROUTER_API_KEY',
    model: 'qwen/qwen3-coder',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    icon: ICON('ollama'),
    hint: 'A local model. The code never leaves the machine.',
    model: 'qwen3-coder:30b',
    cliOnly: true,
  },
];

const DEPTHS = [
  {
    id: 'essential',
    label: 'Essential',
    hint: 'Only what can hurt production: security, data loss, crashes, leaks, overload. About a finding per three pull requests, a third cheaper.',
  },
  {
    id: 'full',
    label: 'Full',
    tag: 'default',
    hint: 'Every real defect, plus a sweep over the whole diff and up to five maintainability notes.',
  },
  {
    id: 'deepen',
    label: 'Full + second pass',
    hint: 'Every chunk reviewed twice, independently. For payments, auth, migrations. About twice the price.',
  },
];

const EXTRAS = [
  {
    id: 'post',
    label: 'Comment on the pull request',
    hint: 'Inline comments and one summary, updated in place on the next run.',
  },
  {
    id: 'gate',
    label: 'Block on major findings',
    hint: 'Exit code 1 in CI; a pre-commit hook on your machine.',
  },
  { id: 'sarif', label: 'GitHub code scanning', hint: 'Upload the findings as SARIF.', only: 'github' },
  { id: 'cap', label: 'Cap a run at $2', hint: 'No model call starts once that much is spent.' },
];

const SCRATCH_STEPS = [
  { id: 'where', title: 'Where will it run?', short: 'Where', items: WHERE, type: 'radio' },
  { id: 'provider', title: 'Which model?', short: 'Model', items: PROVIDERS, type: 'radio' },
  { id: 'depth', title: 'How deep?', short: 'Depth', items: DEPTHS, type: 'radio' },
  { id: 'extra', title: 'Anything else?', short: 'Options', items: EXTRAS, type: 'checkbox' },
];
const START = [
  {
    id: 'scratch',
    label: 'Starting from scratch',
    hint: 'Install, credentials, the first review, and CI if you want it. Everything to paste, in order.',
  },
  {
    id: 'command',
    label: 'Already installed',
    hint: 'Build the one command for the case in front of you: what to review, how deep, which flags.',
  },
];
const START_STEP = { id: 'start', title: 'Where are you?', short: 'Start' };

const state = {
  where: 'terminal',
  provider: 'claude',
  depth: 'full',
  post: true,
  gate: false,
  sarif: false,
  cap: false,
};

const sh = (cmd, comment) =>
  `<span class="tok-p">$ </span>${escapeHtml(cmd)}${comment ? `   <span class="tok-c"># ${escapeHtml(comment)}</span>` : ''}`;
const y = (s) => escapeHtml(s).replace(/^(\s*-?\s*)([\w-]+)(:)/gm, '$1<span class="tok-k">$2</span>$3');
const pick = (id) => PROVIDERS.find((x) => x.id === id);

function reviewFlags(p, forCi) {
  const f = [];
  if (p.id !== 'claude' || forCi) f.push(`--provider ${p.id}`);
  if (p.model && p.id !== 'claude') f.push(`--model ${p.model}`);
  if (state.depth === 'essential') f.push('--essential');
  if (state.depth === 'deepen') f.push('--deepen');
  if (state.cap) f.push('--max-cost 2');
  return f;
}

function credentials(p) {
  switch (p.id) {
    case 'claude':
      return { note: 'Already logged in: nothing to add.', lines: [] };
    case 'codex':
    case 'copilot':
    case 'gemini':
      return { note: `Install the ${p.label} and log in; Code Reviewer talks to it over ACP.`, lines: [] };
    case 'bedrock':
      return {
        note: 'Any AWS credential chain: a profile, SSO, a role.',
        lines: [sh('aws sso login --profile dev'), sh('export AWS_PROFILE=dev')],
      };
    case 'ollama':
      return {
        note: 'A model that supports tool calling, and a context length large enough for a chunk.',
        lines: [sh('ollama pull qwen3-coder:30b'), sh('export OLLAMA_CONTEXT_LENGTH=65536')],
      };
    default:
      return {
        note: 'In your shell profile or a secrets manager, never in the repository.',
        lines: [sh(`export ${p.env}=…`)],
      };
  }
}

const comment = (text) => `<span class="tok-c"># ${escapeHtml(text)}</span>`;

/** The whole terminal setup as one block: numbered comments, then the commands. */
function terminalBlocks(p) {
  const lines = [comment('1. install (Node.js 24 or newer)'), sh(`npm install -g ${PKG}`), ''];
  const cred = credentials(p);
  lines.push(comment(`2. credentials: ${cred.note}`), ...cred.lines);
  lines.push('');
  lines.push(
    comment('3. set the project up once'),
    sh('cd /path/to/your/project'),
    sh('code-reviewer init'),
    sh(`code-reviewer providers test ${p.id}`),
    '',
  );
  const flags = reviewFlags(p, false);
  const review = ['code-reviewer review', ...flags];
  if (state.post) review.push('--post');
  if (state.gate) review.push('--fail-on major');
  lines.push(
    comment('4. review'),
    sh(review.join(' '), 'your branch against its base'),
    sh(['code-reviewer review --staged', ...flags].join(' '), 'what you are about to commit'),
  );
  let n = 5;
  if (state.gate) {
    const hook = ['code-reviewer hook install --fail-on major'];
    const pass = flags.filter((f) => !f.startsWith('--deepen'));
    if (pass.length) hook.push('--', ...pass);
    lines.push(
      '',
      comment(`${n++}. block risky commits: major findings stop the commit, --no-verify skips it once`),
      sh(hook.join(' ')),
    );
  }
  if (state.post)
    lines.push(
      '',
      comment(`${n++}. a token for the pull request, found from the remote`),
      sh(
        'export GITHUB_TOKEN=…',
        'or GITLAB_TOKEN, GITEA_TOKEN, BITBUCKET_TOKEN + BITBUCKET_EMAIL, AZURE_DEVOPS_TOKEN',
      ),
      sh('code-reviewer runs publish latest --dry-run', 'what would be posted'),
    );
  const blocks = [{ title: 'Terminal', kind: 'sh', lines }];
  const cfg = ['review:'];
  if (state.depth === 'essential') cfg.push('  depth: essential');
  if (state.depth === 'deepen') cfg.push('  deepen: true');
  if (state.cap) cfg.push('  maxCost: 2');
  if (p.id !== 'claude') {
    const role = `{ provider: ${p.id}${p.model ? `, model: ${p.model}` : ''} }`;
    cfg.unshift('roles:', `  review: ${role}`, `  critique: ${role}`);
  }
  if (cfg.length > 1)
    blocks.push({
      title: '.code-reviewer/config.yaml — the same choices, committed with the project (flags still win)',
      kind: 'yaml',
      lines: cfg,
    });
  return { blocks, notes: [] };
}

const ciSecret = (p) => (p.id === 'bedrock' ? null : (p.env ?? 'ANTHROPIC_API_KEY'));

function githubBlocks(p) {
  const perms = ['      contents: read'];
  if (state.post) perms.push('      pull-requests: write');
  if (state.sarif) perms.push('      security-events: write');
  if (p.id === 'bedrock') perms.push('      id-token: write');
  const wf = [
    'name: Code review',
    'on: pull_request',
    'jobs:',
    '  review:',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 30',
    '    permissions:',
    ...perms,
    '    steps:',
    '      - uses: actions/checkout@v7',
    '        with:',
    `          ref: ${GH('github.event.pull_request.head.sha')}`,
    '          fetch-depth: 0',
  ];
  if (p.id === 'claude')
    wf.push(
      '      - uses: actions/setup-node@v7',
      '        with: { node-version: 24 }',
      '      - run: npm install -g @anthropic-ai/claude-code',
    );
  if (p.id === 'bedrock')
    wf.push(
      '      - uses: aws-actions/configure-aws-credentials@v6',
      '        with:',
      '          role-to-assume: arn:aws:iam::123456789012:role/code-reviewer',
      '          aws-region: us-east-1',
    );
  wf.push('      - uses: antonio112009/code-reviewer@main   # pin a tag or sha');
  const secret = ciSecret(p);
  if (secret) wf.push('        env:', `          ${secret}: ${GH(`secrets.${secret}`)}`);
  wf.push('        with:', `          provider: ${p.id}`);
  if (p.model && p.id !== 'claude') wf.push(`          model: ${p.model}`);
  if (state.depth === 'essential') wf.push('          depth: essential');
  if (state.gate) wf.push('          fail-on: major');
  wf.push(`          post: ${state.post}`, `          sarif: ${state.sarif}`);
  const args = [];
  if (state.depth === 'deepen') args.push('--deepen');
  if (state.cap) args.push('--max-cost 2');
  if (args.length) wf.push(`          args: "${args.join(' ')}"`);
  const notes = [];
  if (secret)
    notes.push(
      `Add <code>${secret}</code> under Settings → Secrets and variables → Actions. Only the review step receives it.`,
    );
  if (p.id === 'bedrock')
    notes.push(
      'An IAM role that trusts <code>token.actions.githubusercontent.com</code> for this repository and allows <code>bedrock:InvokeModel</code>: no stored AWS keys.',
    );
  notes.push(
    `Open a pull request: ${state.post ? 'inline comments and one summary, updated by later runs' : 'the reports are kept as an artifact'}${state.sarif ? '; findings also under Security → Code scanning' : ''}.`,
  );
  return { blocks: [{ title: '.github/workflows/code-review.yml', kind: 'yaml', lines: wf }], notes };
}

function gitlabBlocks(p) {
  const vars = [`    CODE_REVIEWER_PROVIDER: ${p.id}`];
  if (p.model) vars.push(`    CODE_REVIEWER_MODEL: ${p.model}`);
  if (p.id === 'claude') vars.push('    CODE_REVIEWER_EXTRA_PACKAGES: "@anthropic-ai/claude-code"');
  if (state.depth === 'essential') vars.push('    CODE_REVIEWER_DEPTH: essential');
  if (state.gate) vars.push('    CODE_REVIEWER_FAIL_ON: major');
  const args = [];
  if (state.depth === 'deepen') args.push('--deepen');
  if (state.cap) args.push('--max-cost 2');
  if (args.length) vars.push(`    CODE_REVIEWER_ARGS: "${args.join(' ')}"`);
  const ci = [
    'include:',
    '  - remote: https://raw.githubusercontent.com/antonio112009/code-reviewer/main/ci/gitlab/code-reviewer.gitlab-ci.yml',
    '',
    'code-reviewer:',
    '  variables:',
    ...vars,
  ];
  const secret = ciSecret(p);
  const notes = [
    'Runs on merge request pipelines; the Code Quality report shows in the merge request widget.',
  ];
  if (secret) notes.push(`CI/CD variable <code>${secret}</code>, masked.`);
  notes.push(
    state.post
      ? 'CI/CD variable <code>GITLAB_TOKEN</code>: a project access token with the api scope and the Reporter role, masked and not protected.'
      : 'Without <code>GITLAB_TOKEN</code> the job keeps the reports as an artifact and posts nothing.',
  );
  return { blocks: [{ title: '.gitlab-ci.yml', kind: 'yaml', lines: ci }], notes };
}

function scriptBlocks(p) {
  const flags = reviewFlags(p, true);
  const review = ['code-reviewer review --plain --yes --format md,json', ...flags];
  if (state.gate) review.push('--fail-on major');
  const secret = ciSecret(p);
  if (state.where === 'bitbucket') {
    const l = [
      'image: node:24',
      'pipelines:',
      '  pull-requests:',
      "    '**':",
      '      - step:',
      '          name: Code review',
      '          clone: { depth: full }',
      '          script:',
      `            - npm install -g ${PKG}`,
      `            - ${review.join(' ')}`,
    ];
    if (state.post) l.push('            - code-reviewer runs publish latest');
    const notes = [];
    if (secret) notes.push(`Secured repository variable <code>${secret}</code>.`);
    if (state.post)
      notes.push(
        'Secured variables <code>BITBUCKET_TOKEN</code> (an API token with pull request write) and <code>BITBUCKET_EMAIL</code>.',
      );
    return { blocks: [{ title: 'bitbucket-pipelines.yml', kind: 'yaml', lines: l }], notes };
  }
  if (state.where === 'azure') {
    const l = [
      'trigger: none',
      'pr: [main]',
      'pool: { vmImage: ubuntu-latest }',
      'steps:',
      '  - checkout: self',
      '    fetchDepth: 0',
      '  - task: NodeTool@0',
      "    inputs: { versionSpec: '24.x' }",
      `  - script: npm install -g ${PKG}`,
      `  - script: ${review.join(' ')} --head $(System.PullRequest.SourceCommitId)`,
    ];
    if (secret) l.push(`    env: { ${secret}: $(${secret}) }`);
    if (state.post)
      l.push(
        '  - script: code-reviewer runs publish latest',
        '    env: { SYSTEM_ACCESSTOKEN: $(System.AccessToken) }',
      );
    const notes = [
      '<code>--head</code> names the source commit, so comments anchor on the pull request’s own lines.',
    ];
    if (secret) notes.push(`<code>${secret}</code> as a secret pipeline variable.`);
    if (state.post)
      notes.push('The build service identity needs “Contribute to pull requests” on the repository.');
    return { blocks: [{ title: 'azure-pipelines.yml', kind: 'yaml', lines: l }], notes };
  }
  const l = [
    'on: pull_request',
    'jobs:',
    '  review:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with: { fetch-depth: 0 }',
    '      - uses: actions/setup-node@v4',
    '        with: { node-version: 24 }',
    `      - run: npm install -g ${PKG}`,
    `      - run: ${review.join(' ')} --head ${GH('github.event.pull_request.head.sha')}`,
  ];
  if (secret) l.push(`        env: { ${secret}: ${GH(`secrets.${secret}`)} }`);
  if (state.post)
    l.push(
      '      - run: code-reviewer runs publish latest',
      `        env: { GITEA_TOKEN: ${GH('secrets.GITEA_TOKEN')} }`,
    );
  const notes = [];
  if (secret) notes.push(`Secret <code>${secret}</code>.`);
  if (state.post)
    notes.push(
      'Secret <code>GITEA_TOKEN</code> (or <code>FORGEJO_TOKEN</code>) with write access to issues and pull requests.',
    );
  return {
    blocks: [
      { title: '.gitea/workflows/code-review.yml  (Forgejo: .forgejo/workflows/)', kind: 'yaml', lines: l },
    ],
    notes,
  };
}

function available(stepDef, item) {
  const ci = state.where !== 'terminal';
  if (stepDef.id === 'provider') return !(ci && item.cliOnly);
  if (stepDef.id === 'extra') return !item.only || item.only === state.where;
  return true;
}

let mode = '';
let step = 0;
const visited = new Set([0]);
const steps = () => [
  START_STEP,
  ...(mode === 'command' ? commandSteps : mode === 'scratch' ? SCRATCH_STEPS : []),
];

function scratchLabel(id) {
  switch (id) {
    case 'where':
      return WHERE.find((w) => w.id === state.where).label;
    case 'provider':
      return pick(state.provider).label;
    case 'depth':
      return DEPTHS.find((d) => d.id === state.depth).label;
    default:
      return (
        EXTRAS.filter((e) => state[e.id] && available(SCRATCH_STEPS[3], e))
          .map((e) => e.label.split(' ')[0])
          .join(', ') || 'None'
      );
  }
}

function renderStepper(root) {
  const all = steps();
  root.querySelector('[data-stepper]').innerHTML = all
    .map((s, i) => {
      const value =
        s.id === 'start'
          ? (START.find((x) => x.id === mode)?.label ?? 'Pick one')
          : s.label
            ? s.label()
            : scratchLabel(s.id);
      return `<li class="${i === step ? 'now' : visited.has(i) ? 'done' : ''}"><button type="button" data-goto="${i}" aria-current="${i === step ? 'step' : 'false'}"${!mode && i > 0 ? ' disabled' : ''}><span class="stepper-n">${i + 1}</span><span class="stepper-text"><small>${escapeHtml(s.short)}</small><b>${escapeHtml(value)}</b></span></button></li>`;
    })
    .join('');
}

function scratchTiles(s) {
  return s.items
    .map((it) => {
      const on = s.type === 'radio' ? state[s.id] === it.id : Boolean(state[it.id]);
      const off = !available(s, it);
      return `<label class="tile${off ? ' off' : ''}">
        <input type="${s.type}" name="${s.id}" value="${it.id}"${on && !off ? ' checked' : ''}${off ? ' disabled' : ''}>
        <span class="tile-check" aria-hidden="true"></span>
        ${it.icon ? `<span class="tile-icon">${it.icon}</span>` : ''}
        <span class="tile-text"><b>${escapeHtml(it.label)}${it.tag ? ` <span class="badge badge-blue">${it.tag}</span>` : ''}</b><small>${escapeHtml(it.hint)}${off ? ' Needs a logged-in CLI on the machine: pick an API for CI.' : ''}</small></span>
      </label>`;
    })
    .join('');
}

function renderStep(root) {
  const all = steps();
  const s = all[step];
  let body;
  if (s.id === 'start')
    body = `<div class="tiles start-tiles">${START.map(
      (it) =>
        `<label class="tile"><input type="radio" name="mode" value="${it.id}"${mode === it.id ? ' checked' : ''}><span class="tile-check" aria-hidden="true"></span><span class="tile-text"><b>${escapeHtml(it.label)}</b><small>${escapeHtml(it.hint)}</small></span></label>`,
    ).join('')}</div>`;
  else if (s.render) body = s.render();
  else body = `<div class="tiles${s.id === 'depth' ? ' tiles-1' : ''}">${scratchTiles(s)}</div>`;
  const last = Boolean(mode) && step === all.length - 1;
  root.querySelector('[data-step-panel]').innerHTML = `
    <h3>${escapeHtml(s.title)}</h3>
    ${body}
    <div class="setup-nav">
      <button class="btn btn-ghost" type="button" data-prev${step === 0 ? ' disabled' : ''}>Back</button>
      <span class="muted">${mode ? `Step ${step + 1} of ${all.length}` : 'Pick one to continue'}</span>
      <button class="btn btn-primary" type="button" data-next${!mode ? ' disabled' : ''}>${last ? 'Show the result' : 'Next'}</button>
    </div>`;
}

function renderOut(root) {
  const out = root.querySelector('[data-setup-out]');
  if (!mode) {
    out.innerHTML = '<p class="setup-empty">Your commands will appear here as you answer.</p>';
    return;
  }
  if (mode === 'command') {
    out.innerHTML = renderCommandOut();
    return;
  }
  const p = pick(state.provider);
  const { blocks, notes } =
    state.where === 'terminal'
      ? terminalBlocks(p)
      : state.where === 'github'
        ? githubBlocks(p)
        : state.where === 'gitlab'
          ? gitlabBlocks(p)
          : scriptBlocks(p);
  const done = visited.size === steps().length;
  const chips = [
    WHERE.find((w) => w.id === state.where).label,
    p.label,
    DEPTHS.find((d) => d.id === state.depth).label,
    ...EXTRAS.filter((e) => state[e.id] && available(SCRATCH_STEPS[3], e)).map((e) => e.label),
  ];
  out.innerHTML = `
    <div class="setup-out-head">
      <div><h3>${done ? 'Your setup' : 'Your setup so far'}</h3><p class="setup-chips">${chips.map((c) => `<span class="badge">${escapeHtml(c)}</span>`).join('')}</p></div>
      <span class="muted">${done ? 'Paste it in order.' : 'Updates as you choose.'}</span>
    </div>
    ${blocks
      .map(
        (b) =>
          `<div class="code-block setup-block"><div class="bar">${escapeHtml(b.title)}</div><button class="copy" type="button" data-copy=""><span class="copy-label">Copy</span></button><pre>${(b.kind === 'yaml' ? b.lines.map(y) : b.lines).join('\n')}</pre></div>`,
      )
      .join('')}
    ${notes.length ? `<ul class="setup-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
    <p class="fine"><code>code-reviewer review --help</code> lists every flag; each has a key in the config. <a href="https://github.com/antonio112009/code-reviewer/blob/main/docs/ci.md">CI setup in detail →</a></p>`;
}

function renderAll(root) {
  renderStepper(root);
  renderStep(root);
  renderOut(root);
}

function main() {
  const root = document.querySelector('[data-setup]');
  if (!root) return;
  const goto = (i) => {
    step = Math.max(0, Math.min(steps().length - 1, i));
    visited.add(step);
    renderAll(root);
  };
  const onEvent = (e) => {
    const el = e.target;
    if (e.type === 'change' && el.name === 'mode') {
      if (mode !== el.value) {
        mode = el.value;
        visited.clear();
        visited.add(0);
      }
      renderAll(root);
      return;
    }
    if (mode === 'command') {
      const what = onCommandEvent(e);
      if (what === 'step') renderAll(root);
      else if (what === 'out') {
        renderStepper(root);
        renderOut(root);
      }
      return;
    }
    if (e.type !== 'change' || !el.name) return;
    if (el.name === 'extra') state[el.value] = el.checked;
    else state[el.name] = el.value;
    if (state.where !== 'terminal' && pick(state.provider).cliOnly) state.provider = 'anthropic';
    renderStepper(root);
    renderOut(root);
  };
  root.addEventListener('change', onEvent);
  root.addEventListener('input', onEvent);
  root.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) {
      goto(Number(g.dataset.goto));
      return;
    }
    if (e.target.closest('[data-prev]')) {
      goto(step - 1);
      return;
    }
    if (e.target.closest('[data-next]')) {
      if (step === steps().length - 1) {
        for (let i = 0; i < steps().length; i++) visited.add(i);
        renderAll(root);
        root.querySelector('[data-setup-out]').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else goto(step + 1);
      return;
    }
    if (mode === 'command') onEvent(e);
  });
  if (location.hash === '#command') {
    mode = 'command';
    step = 1;
    visited.add(1);
  }
  renderAll(root);
}

main();
