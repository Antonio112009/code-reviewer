# Architecture

## Data flow

```
 CLI (commander)       config: defaults < depth preset < ~/.code-reviewer < project < profile < flags
   │                   cli/lifecycle.ts: Ctrl+C → abort signal; 2nd Ctrl+C / exit → kill process groups
   ▼
 review/pipeline.ts  (phases emit ReviewEvents → cli/ui: live dashboard | plain lines | JSON)
   1. refs        git/refs.ts          base: --base | CI PR env | gh/glab PR | branch config | rules | default
                                       fetch remote base (deepen shallow clones), merge-base, commit count
   2. collect     sources/*            ReviewUnit[] (diff hunks + new content | whole files), excludes
   3. context     in parallel:
                  context/stack/*      manifests → techs, package roots, versions (never runs repo code)
                  analyzers/*          secretlint + pattern rules + safe external tools → StaticHit[]
                  chunking/graph.ts    import graph (TS/JS, Python, Go, JVM, C#, PHP, Ruby, Rust, C/C++, Dart)
                  context/project-rules CLAUDE.md, AGENTS.md… (diff mode: read from the BASE commit)
                  skills/loader.ts     skill tree (builtin < global < project)
                  models/preflight.ts  is every configured model available? → fallback decisions
   4. chunking    chunking/*           clusters of related files (imports, tests, siblings) → chunks ≤ budget;
                                       shared files added read-only as context to other chunks
   5. skills      skills/detector.ts   per chunk: group detection + gates + signals + versions → budget fill
   6. snapshot    git/snapshot.ts      isolated, sanitized worktree of head (agents / cross-provider fallback)
   7. review      review/execute.ts    one AgentTask per chunk (p-limit), ModelRouter: retry / fallback / fail
                  providers/*          ACP agents or Bedrock; read-only tools + submit_findings;
                                       out of time/steps/output → one short "submit what you have" turn
                  review/findings.ts   submit payload → fallback JSON in text → one repair retry
                  review/pipeline.ts   still failed: split the chunk (≤ 2 levels) or retry once with 2× time
                  models/pricing.ts    usage of every attempt → cost (reported, or tokens × `pricing`)
   8. validate    review/validate.ts   unknown files, out-of-range lines, far from changed hunks; hint claims
      dedupe      review/dedupe.ts     same file + overlapping lines + similar title / same span
   9. critique    review/critique.ts   batches per file → submit_verdicts → confirmed/uncertain/rejected
  10. threshold   minConfidence (non-rejectable static findings bypass it)
  11. authors     review/attribution   git blame → author, commit/line URLs (GitHub/GitLab)
      fingerprint review/fingerprint   stable id per kept finding (file, category, rule, normalised code)
  12. persist     runs/store.ts        run.json, run.log (every message and event), chunk artifacts (prompt,
                                       reply, submission; failed parts too), report/* → md/json/html/sarif/codequality
  13. publish     publish/*            optional (`review --post`, `runs publish`): PR/MR inline comments +
                                       a summary comment, after the run and its reports are saved

 eval (cli/commands/eval.ts)   YAML cases → per case × --repeat: temp repo → runReview → score → result.json
```

## Key contracts

- **`Provider.run(AgentTask) → AgentResult`** (`src/providers/types.ts`) is the only thing the pipeline
  knows about models.
  - The task carries: instructions, prompt, model, reasoning level, review root, read tools, skill
    catalog, timeout, stall timeout and an abort signal.
  - The result carries: the collected `submit_*` payload, the final text, usage, tool usage and warnings,
    plus `interruptedBy` (our timeout / stall watchdog) and `salvaged` (the model was asked for an early
    answer).
  - `Usage` holds uncached input, cached input, output and reasoning tokens, the number of model
    requests, `estimated` (the provider reported no token counts) and `reportedCost` (ACP `usage_update`).
- **Structured output through a tool.** ACP has no response-schema field, so every provider gets the same
  `submit_findings` / `submit_verdicts` tool with zod-validated input.
  - Invalid input returns an error to the model, so it can fix it.
  - If the model never calls the tool, JSON is extracted from its reply.
  - If that also fails, a cheap "repair" task converts the reply.
- **`Finding`** (`src/types.ts`) fields:
  - location: file and new-file line range;
  - classification: severity (`critical | major | minor | info`) and category;
  - content: title, failure scenario, suggestion, evidence;
  - confidence;
  - context: skills, source chunks, critique verdict, author;
  - static origin: analyzer and rule, `nonRejectable`;
  - `fingerprint`: stable across runs and line shifts (see Publishing).
- **`RunRecord`** holds everything needed to re-render reports later (`runs export`):
  - chunk records (status, provider/model, attempts, timeout, hints, tools used, usage and cost of every
    attempt, `failure` kind, `recovery` notes);
  - `usage` and `cost` of the run (`amount`, `basis`, calls without a known cost, unpriced routes);
  - fallbacks, refs, stack, analyzer runs, skills and tools used;
  - rejected findings with `droppedReason` (`unknown-file`, `line-out-of-range`, `outside-changed-lines`,
    `hint-not-confirmed`, `critique`, `below-threshold`).
- **`ReviewEvent`** (`src/review/events.ts`) is the UI contract: `phase`/`phase-done`, `refs`, `stack`,
  `analyzers`, `plan`, `chunk-start`/`chunk-activity`/`chunk-done`, `critique-start`/`critique-progress`,
  `fallback`, `warning`, `done`. The live dashboard, the plain renderer and `--json` all consume the same
  stream.

## Review depth

`review.depth` is `essential` (the default) or `full`. It is resolved first, from the highest-priority
layer that sets it. `config/load.ts` then puts `DEPTH_PRESETS[depth]` between the built-in defaults and
the config files and flags, so explicit settings always win.

| Setting | essential | full |
|---|---|---|
| `minSeverity` | major | info |
| `skillTokenBudget` | 3500 | 6000 |
| `maxSteps` | 15 | 25 |
| `contextShare` | 0.1 | 0.2 |

The depth also affects:
- **Prompts.** The review instructions (`prompts.ts#depthRules`) narrow the scope to serious production
  defects and require a concrete fix. At essential depth the critic also rejects real but low-impact
  findings.
- **Skills.** `skillsForDepth(skills, depth)` keeps only `tier: essential` skills and swaps in their
  `essentialBody`, i.e. without bullets marked `[full]`. The same view feeds per-chunk selection,
  hint-linked skills, the in-process skill catalog and `mcp-serve --depth` for ACP agents. An explicit
  `--skills a,b` list is honoured as given.
- **Threshold.** Findings below `minSeverity` are dropped as `below-severity`. Non-rejectable static
  findings (secrets, vulnerable dependencies) are kept.

## Chunking (`src/chunking/`)

1. **`imports.ts` / `graph.ts`** — a regex-level import scanner per language. It resolves relative imports,
   tsconfig `paths`, Go modules, PSR-4 and similar. It reads only small config files of the reviewed
   revision.
2. **`cluster.ts`** — groups changed files by import edges, test ↔ source pairs and same-directory
   siblings, deterministically. Each chunk records its `groupReasons`.
3. **`chunker.ts` / `pack.ts`** — packs clusters into chunks within the budget. The budget is the context
   window minus output, instructions, the skill budget and hints.
   - Large files are split into windows around the changed hunks.
   - A file owned by one chunk can appear as read-only `context` in another, up to `review.contextShare`
     of the budget.
4. **`render.ts`** — PR-style blocks: new code with new-file line numbers and `+` markers, plus a
   budgeted "removed code" block per hunk.

## Skills (`src/skills/`, `skills/`)

- **Tree.** The skill id is its path (`javascript/react/effects`). Every folder has a `_group.yaml` with
  `name`, `description`, `category`, `priority`, `tier` and `detect`. Category, priority and tier are
  inherited by the skills below. A bullet marked `[full]` is left out at essential depth (see Review
  depth).
- **Matching** (`detector.ts#matchSkill`):
  1. Every ancestor group's `detect` must match the chunk. Gates (`stack`, `languages`, `versions`) must
     pass. If signals are declared, one of them must hit: `files` on the chunk's paths, `content` on the
     **full content** of the chunk's files.
  2. The skill's own gates must pass.
  3. Its signals must hit. In diff mode, `content` runs on the **added lines**.
  4. The score is priority + specificity (content 40 > files 30 > stack 20 > language 10) + depth × 3.
- **Versions.** The stack detector records the lowest version each manifest allows, per package root
  (`TechHit.version` / `versions`). `planning.ts#techVersionsForChunk` resolves each chunk file to its
  nearest package. If the files disagree, the version is unknown, and an unknown version passes every
  gate.
- **Selection** (`selectSkills`):
  - greedy by score within `review.skillTokenBudget`, then the `extends` closure;
  - skills tied to fired analyzer rules are added too;
  - output is in a deterministic category order, for prompt caching.
- **Sources and overrides.** Loading order is builtin < global < project. User skills inherit builtin
  groups for folders they do not define. Project skills cannot be always-on or replace always-on skills.
  Their regexes are length- and nested-quantifier-checked, since they come from an untrusted checkout.
- **Loading on demand.** Agents can call `list_skills` (prefix / query / category filters) and `get_skill`
  to load checklists that were not preselected.
- **Validation.** `test/skills-library.test.ts` validates the library: tree, groups, frontmatter, tech
  and language ids, version ranges, ReDoS timing on adversarial inputs, glob examples, size and bullet
  limits, source URLs. `code-reviewer skills lint` runs the loader checks on a user directory.

## Static analyzers (`src/analyzers/`)

- **Built-in.**
  - secretlint (preset-recommend);
  - regex pattern rules (`patterns/rules-*.ts`), restricted to changed ranges.
- **External "safe" tools**, run when found on PATH: gitleaks, shellcheck, hadolint, ruff, cppcheck.
  - Explicit flags make them ignore repository configs and plugins.
  - They run with a sanitized environment, a timeout and a process-group kill.
- **Project tools**, opt-in only: eslint, tsc, golangci-lint, phpstan, semgrep/opengrep, osv-scanner. They
  load repository configs or plugins, so they are allowed only via `--analyzers` or the global config.
- **Output.** Results are normalized to `StaticHit` by SARIF or tool-specific parsers, with paths confined
  to the root.
- **Suppression comments.** A change that adds one (`nosec`, `noqa`, `eslint-disable`, `NOLINT`, …) may
  be hiding the very defect a tool would report, so a newly added marker becomes an `info` hint.

## Providers

### Bedrock (`providers/bedrock.ts`)
- Uses Vercel AI SDK v7 `generateText` with `tools` and
  `stopWhen: [isStepCount(maxSteps), hasToolCall(submit)]`.
- The portable `reasoning` level is mapped to Bedrock `reasoningConfig`.
- The region is validated. Credentials come from the AWS provider chain unless
  `AWS_BEARER_TOKEN_BEDROCK` is set.

### ACP (`providers/acp/`)
- **`presets.ts`** — for each agent: how to launch it, its read-only lever, and whether model/effort are
  set per session (config options) or per process (Copilot flags).
- **`connection.ts`** — one agent process (its own process group, neutral cwd) plus an ACP client.
  - Each task gets a **fresh session** with our MCP server attached:
    `code-reviewer mcp-serve --root <snapshot> --kind findings --submit-file <tmp> --project-root <repo>`.
  - Model, effort and read-only mode are applied with `session/set_config_option`. The option list
    returned by each call replaces the current one.
  - Every request has a timeout. A stall watchdog cancels a turn with no activity for
    `review.stallTimeoutMs`.
- **`permissions.ts`**:
  - reads and our own MCP tools (exact names) are allowed;
  - edit/delete/move/execute/fetch/switch_mode are always rejected.
- **`provider.ts`** — a pool of up to `concurrency` processes. Broken connections are replaced.

### Model routing (`review/execute.ts`, `models/*`)
- **Preflight.** It discovers the models of each provider and classifies them (tier, vendor). If a
  configured model is missing, it runs `resolveFallback` (`ask | fallback | fail`) before the run
  starts.
- **During the run**, `runRouted` classifies each error:
  - transient: back off and retry, up to 3 attempts;
  - unavailable or refusal: `ModelRouter.replace()`. One shared decision per failed model moves every
    chunk to the same replacement;
  - authentication: fatal, remaining chunks are skipped.
- Fallbacks are recorded in the run and shown in the summary.

## Reports and publishing

- **Fingerprints** (`review/fingerprint.ts`). Right before the findings are stored, each kept finding gets
  a hash of its path, category, static rule (`analyzer/ruleId`, static findings only) and the
  whitespace-normalised code of its lines, read from the review root (confined by `resolveInside`). Line
  numbers are not part of it, so unrelated edits above a finding keep it. Unreadable code falls back to
  path + title. Collisions within a run are disambiguated by the title. Runs saved without fingerprints get
  them at publish time from the reviewed commit (`git show`).
- **SARIF** (`report/sarif.ts`): SARIF 2.1.0 with one rule per category (`code-reviewer/<category>`,
  security split per severity so GitHub can rank it via `security-severity`) or per static rule, levels
  critical/major → error, minor → warning, info → note, `partialFingerprints`, repository-relative URIs under
  `SRCROOT`, `versionControlProvenance` for credential-free https remotes, failed chunks as tool execution
  notifications. **Code Quality** (`report/codequality.ts`): GitLab's JSON array with the same rule ids and
  fingerprints. Both export kept findings only, as clipped plain text.
- **Publishing** (`publish/`):
  - `target.ts` resolves forge, API URL, repository and PR/MR number: flags, then CI variables, then the
    remote and `gh`/`glab`. It also holds the token destination rules (Safety model, 13).
  - `plan.ts` computes the commentable lines from the local `mergeBase..headSha` diff (3 context lines, new
    side) and splits findings into inline comments (whole range inside one hunk, `publish.minSeverity`,
    `publish.maxInlineComments`, worst first) and summary entries. Fingerprints already posted by the same
    account are skipped. When the PR/MR head is not the reviewed commit, nothing goes inline unless `--force`.
  - `github.ts` / `gitlab.ts` implement `ForgeAdapter` (`load` → head + posted fingerprints, `postInline`,
    `upsertSummary`). GitHub: one `COMMENT` review, single comments after a 422, the summary as an issue
    comment edited in place. GitLab: one positioned discussion per finding (`diff_refs`), the summary as an
    MR note updated with PUT.
  - `http.ts` is a small `fetch` client (injectable): timeouts plus the run's abort signal, 429/5xx retries
    honouring `Retry-After` (3 attempts), `Link` pagination, no redirects, same-origin requests only.
  - `render.ts` escapes model/repository text like the Markdown report and also defuses mentions,
    `#123`/`!123` references, links, autolinks and line-leading `/` (GitLab quick actions). Hidden markers
    (`<!-- code-reviewer:summary -->`, `<!-- code-reviewer:fp=… -->`) identify our comments.

## Safety model

The code under review, and therefore model output, is treated as untrusted.

1. **Isolated snapshot.** Agents get a detached worktree of the reviewed commit under a temp dir owned
   by this process.
   - Hooks, LFS smudge filters and the user's sparse-checkout cone are disabled.
   - Agent instruction and config files are removed at any depth: `CLAUDE.md`, `AGENTS.md`,
     `GEMINI.md`, `.mcp.json`, `.cursorrules`, the `.claude/`, `.codex/`, `.gemini/`, `.cursor/` and
     similar folders, and Copilot's `.github/{instructions,prompts,skills,agents,hooks}`.
   - `files` mode writes the working tree over it with the same filter (`isAgentConfigPath`).
   - Plain folders and repositories without commits get an isolated copy.
   - Stale snapshots of dead processes are swept.
2. **Programs are never taken from the reviewed code** (`util/executables.ts`).
   - `git`, agents, `npx` and analyzers are resolved to absolute paths from trusted `PATH` entries only.
     Not trusted: the checkout, snapshots, the start directory, relative entries and
     `node_modules/.bin`. Paths are compared case-insensitively on macOS/Windows, and through symlinks.
   - Agents get the filtered `PATH`.
   - Windows `.cmd` shims run through `cmd.exe` with escaped arguments, and
     `NoDefaultCurrentDirectoryInExePath` is set.
3. **ACP permissions** (`providers/acp/permissions.ts`).
   - Every mutating kind is rejected.
   - Reads and searches are allowed only when every path they name is inside the review root.
   - Our tools are recognised only by exact name.
4. **Presets.**
   - Claude runs in its `default` permission mode, whatever the user's settings say, with write, shell
     and web tools disallowed. Failing to apply a read-only mode fails the task. `ENABLE_TOOL_SEARCH=false`
     loads our MCP tools up front: behind Claude Code's ToolSearch, a model that skips the search ends
     without calling `submit_findings`.
   - Codex cannot be confined to read-only by its adapter: it is flagged `unconfined`, never picked as an
     automatic fallback, and a warning is shown when it is configured.
5. **Paths.** Every path from a model or tool call goes through `resolveInside`, a lexical check plus a
   `realpath` check. `files` mode and skill loading skip symlinks, and findings must name a regular file
   inside the root.
6. **Agent processes.** They start in a neutral temp directory, so a repository's `.npmrc` cannot
   redirect `npx`.
7. **Project configs.**
   - Only YAML/JSON is accepted. Unknown keys are errors.
   - They may not set `models`, `analyzers.project`, provider `command`/`args`/`env` or
     `publish.githubApiUrl`/`gitlabApiUrl`, profiles included.
   - The search stops at the repository root, never walks up outside a repository, and never takes the
     global config for a project config. `CODE_REVIEWER_HOME` counts only when absolute.
   - If any changed path, even an excluded one, touches `.code-reviewer/`, or the directory is a symlink,
     project skills are disabled for that run.
8. **Bounded untrusted patterns.**
   - Globs from project configs and project skills are validated (`util/globs.ts`: no extglobs, one `*`
     per segment, at most two `**`).
   - Project-skill regexes are vetted against adversarial inputs in a worker with a hard time limit
     (`skills/regex-guard.ts`) and only ever run on bounded text.
   - The non-git `grep` fallback rejects backtracking-prone patterns.
9. **Project rules.** In diff mode they are read from the base commit.
10. **Analyzers.** They never execute repository code without an explicit opt-in. Hits in untrusted text
    are parsed linearly (tokenizer, import graph, JSON extraction and rendering are all bounded).
11. **Prompts and reports.** Repository text in prompts is clipped, and prompts state that the code is
    data, not instructions. Markdown reports escape HTML, backticks, images and fences in untrusted text.
    Run ids are validated before they become paths.
12. **Checkout check.** `git status` of the user's checkout is compared before and after the run.
13. **Forge tokens** (`publish/target.ts`, `publish/http.ts`).
    - `GITHUB_TOKEN`/`GH_TOKEN` and `GITLAB_TOKEN` are only sent to api.github.com / gitlab.com, to the API URL
      the running CI declares (`GITHUB_API_URL` only when `GITHUB_ACTIONS=true`, `CI_API_V4_URL` only when
      `GITLAB_CI=true`), or to `publish.githubApiUrl`/`gitlabApiUrl` from the global config or `--api-url`.
    - The remote URL (and `gh`/`glab`) only names the repository, and only when its host matches the API host;
      otherwise publishing stops with an error.
    - API URLs must be https (http only for loopback) without credentials; requests never follow redirects or
      pagination links to another origin; tokens are never logged.
    - The CI templates run the review without the token and post in a separate step (`runs publish`), so
      agents never see it.
    - Only the account's own comments count as ours (summary updates, de-duplication): a marker pasted by
      someone else is ignored.
14. **Posted text.** Comments are rendered from untrusted text: escaped, clipped to the API limits, with
    mentions, references, links, images, HTML and GitLab quick actions defused.

## Robustness

- **Timeouts.** Each task has one: `review.timeout: auto` = 120 s + 12 s per 1k chunk tokens, capped at
  `maxTimeoutMs`. The stall watchdog, request timeouts and the grace period after `session/cancel` all
  apply. A timed-out or exited agent is marked `broken` and replaced.
- **Ctrl+C** (`cli/lifecycle.ts`):
  - First press: the abort signal fires. Running sessions get `session/cancel`, no new agents are
    spawned, critique and blame are skipped, and the run is saved with status `partial` (exit 130).
  - Second press: SIGKILL to every registered process group, synchronous worktree removal, exit.
- **Removed code** is budgeted (≤40% of a part, truncated with a note) and shown once per hunk.
- **Long lines** (minified code, inline base64) are clipped at 2,000 characters. Pieces still over
  budget are split again.
- **Unfinished turns** are never recorded as a clean review. Recovery, cheapest first:
  1. **Early answer.** A turn that ran out of time (task timeout, stall watchdog), steps or output without
     submitting gets one short extra turn (`providers/salvage.ts`, ¼ of the timeout, 30–90 s): "stop, call
     `submit_findings` with what you have". ACP agents get it as a follow-up prompt in the same session;
     Bedrock offers only the submit tool on its last step, or once 80% of the time is gone (not a forced
     tool choice, which extended thinking rejects). Findings from such a turn are kept; the chunk's
     `recovery` says so.
  2. **Split.** A chunk that still failed with `timeout`, `step-limit`, `output-limit` or `context-limit` is
     halved (`chunking/chunker.ts#splitChunk`, at a file boundary near the middle, read-only context
     dropped) and each half is reviewed on its own, up to two levels (four parts).
  3. **Retry.** A single part that timed out gets one retry with twice the time (capped by
     `maxTimeoutMs`); a stalled agent gets one fresh retry.
  - Anything else (`no-output`, refusal, auth, …) fails the chunk. A refusal first goes to the model
    fallback; hints of a failed part are carried to the critic.
  - The chunk record gets a `failure` kind; the summary and reports print what to change for it
    (`report/common.ts#failureAdvice`).
  - Critique batches that run out of time, steps or output are retried once as two smaller batches.
- **Transient errors** (rate limits, overload, network) are retried up to 3 attempts with exponential
  backoff and jitter (≈3 s, ≈9 s).
- **Secrets and vulnerable dependencies** are never dropped silently. If no claiming finding survives
  validation, they are reported as static findings, including hints beyond the per-chunk cap.
- **CI gate.** `--fail-on` exits with an error when chunks failed, because unreviewed code must not
  pass a gate.

## Result cache (`src/cache/`)

- **What is cached.** A chunk's (or split part's) findings, and the critic's verdict per finding. Early
  (salvaged) answers are partial and never cached. A chunk that had to be split is remembered as `split`,
  so the next run starts with its halves. `eval` turns the cache off: it measures the model.
- **Key** (`cache/review.ts`): the route (provider, model, reasoning), the full instructions (rules,
  project, skills, depth), `prompts.ts#reviewPromptIdentity` — the chunk's rendered code and context,
  files, grouping, stack line and hints by content — and the tool settings. Left out on purpose: chunk
  numbering, commit shas, the list of other files and hint ids, which change with any commit elsewhere in
  the change. Cached answers refer to hints by identity (`analyzer|rule|file|lines`), mapped back to the
  run's ids. A verdict's key is the finding as the critic sees it (`critiqueFindingIdentity`), its code
  excerpt, the critique instructions and the critic's route.
- **Files the model read.** Our `read_file` / `grep` (`SubmissionCollector.noteRead`, also through
  `mcp-serve`) and the ACP agent's own read/search tool calls (`locations`) and `fs/read_text_file` requests
  are recorded (`AgentResult.reads`). Their content hashes are stored with the answer; a lookup re-hashes
  them in the review root and misses when one changed (or appeared). Files matched by nothing in a search
  are not tracked: `--no-cache` after large refactors.
- **Store** (`cache/store.ts`): `<dir>/v1/<kind>/<xx>/<sha256>.json`, written atomically (temp file +
  rename), safe with concurrent runs. Every entry carries an HMAC-SHA256 over kind, key and data, with a
  secret from `CODE_REVIEWER_CACHE_KEY` or `~/.code-reviewer/cache.key` (created 0600): a planted, edited
  or foreign entry is a miss, never an error. Entries are validated with zod on read; reads refresh the
  mtime for LRU pruning. `autoPrune` runs at most daily (`cache.maxAgeDays`, `cache.maxSizeMb`); `clear`
  removes only the `v1/` tree, since the directory may be shared.
- **Location** (`cache/location.ts`): `CODE_REVIEWER_CACHE_DIR` (absolute only), `cache.dir` (global config
  only: an absolute path or `project`), the platform cache directory (macOS `~/Library/Caches`, Windows
  `%LOCALAPPDATA%` — never the roaming profile, Linux `$XDG_CACHE_HOME` / `~/.cache`), then the temp
  directory; the first writable one wins, none → no cache and a warning.
- The run records `cache` (hits, misses, verdict hits, tokens saved) and `cached` per chunk.

## Usage and cost (`review/execute.ts`, `models/pricing.ts`)

- `runRouted` records the usage of **every attempt** (`Spend`: provider, model, usage), failed ones too:
  retries, repairs and split parts are not free. Errors carry their spend (`spendOf(err)`).
- **Tokens.** When a provider reports no token counts (Copilot over ACP, custom agents), they are
  estimated from the prompt and the reply and marked `estimated`: a lower bound, since tool results and
  hidden reasoning are not seen.
- **Cost of a call:** the cost the provider reported itself (ACP `usage_update.cost`, e.g. Claude Code),
  else tokens × the configured `pricing` (keys `provider:model`, `model`, `provider`; per million input,
  cached input and output tokens, or per request for request-billed agents), else unknown.
- **Run cost** (`CostMeter`): the known amount, its `basis` (`reported`, `priced`, `estimated`), the number
  of calls without a known cost and the routes without a price. One currency per run.
- `--dry-run` shows a lower bound for the review prompts (code, instructions, skills, hints) and, with a
  price for the review model, its input cost.

## Evals (`src/eval/`, `evals/`)

`code-reviewer eval` measures review quality on cases with known defects (format and metrics:
`docs/evals.md`).
- **`cases.ts`** — loads and validates YAML cases (inline base/head files, or a real repository and two
  commit shas); ids are paths relative to the corpus; `--filter` by tag, id glob or prefix.
- **`repo.ts`** — materialises a case: a throw-away repository (base on `main`, change on
  `feature/change`, no user git config, no hooks), or a clone without a working tree in
  `~/.code-reviewer/eval-cache/` for real repositories. Git runs through `runManaged` with the trusted
  git; nothing from a case is executed.
- **`runner.ts`** — checks the models once, then reviews every case with `runReview` (offline, a shared
  `ProviderRegistry`, runs saved in the eval directory; `project.*` and opt-in project analyzers
  dropped). Progress goes out as `EvalEvent`s; Ctrl+C yields an `interrupted` result.
- **`metrics.ts`** (pure) — matches findings to expected defects one to one (same file, line ranges
  within a tolerance, best fit first); duplicates, unexpected findings, false positives on clean cases;
  the self-critique effect from the run's removed findings; micro-averaged totals per pass.
- **`compare.ts`** (pure) — deltas against a previous result over the common cases. **`store.ts`** —
  `result.json`, validated when loaded for `--compare`.
- **`evals/`** — the built-in corpus; `test/evals-corpus.test.ts` checks every case (fields, lines in
  the head file and in the changed hunks, no hint markers, size).

## Extension points

- **New provider type:** implement `Provider`, add a schema variant in `config/schema.ts`, and wire it in
  `providers/registry.ts` and `providers/detect.ts`.
- **New ACP agent:** add a preset in `providers/acp/presets.ts` (or use `preset: custom` in the global
  config).
- **New tool:** add a `ToolDef` in `tools/definitions.ts`. Both the AI SDK and MCP adapters pick it up.
- **New skill:** add a Markdown file in the right `skills/<language>/<technology>/` folder, with a
  `_group.yaml` if the folder is new. Then run
  `SKILLS_SUBTREE=<folder> npx vitest run test/skills-library.test.ts`.
- **New technology to detect:** add its id in `context/stack/techs.ts` and its manifest rules in
  `context/stack/rules.ts`.
- **New analyzer:** add an `AnalyzerDef` in `analyzers/external.ts` (safe) or `analyzers/project.ts`
  (opt-in).
- **New report format:** add a renderer in `report/`, a value in `REPORT_FORMATS` and its file name in
  `REPORT_FILE_NAMES`.
- **New forge:** implement `ForgeAdapter` (`publish/plan.ts`) next to `publish/github.ts`, add it to
  `ForgeKind`, target resolution and the token rules in `publish/target.ts`, and to `adapterFor`.
- **New eval case:** add a YAML file under `evals/<language>/` and run
  `npx vitest run test/evals-corpus.test.ts`.

## Known limitations / roadmap

- Reviewing uncommitted or staged changes.
- Resolving PR/MR threads of fixed findings; Bitbucket / Azure DevOps comments; GitHub/GitLab username
  resolution.
- An LLM run summary (`roles.summary` is reserved); a cost budget that stops a run.
- Anthropic/OpenAI direct API providers.
- The Codex, Copilot and Gemini presets need more live verification.
