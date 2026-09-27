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
                  providers/*          ACP agents or Bedrock; read-only tools + submit_findings
                  review/findings.ts   submit payload → fallback JSON in text → one repair retry
   8. validate    review/validate.ts   unknown files, out-of-range lines, far from changed hunks; hint claims
      dedupe      review/dedupe.ts     same file + overlapping lines + similar title / same span
   9. critique    review/critique.ts   batches per file → submit_verdicts → confirmed/uncertain/rejected
  10. threshold   minConfidence (non-rejectable static findings bypass it)
  11. authors     review/attribution   git blame → author, commit/line URLs (GitHub/GitLab)
  12. persist     runs/store.ts        run.json (+ chunk artifacts), report/* → md/json/html
```

## Key contracts

- **`Provider.run(AgentTask) → AgentResult`** (`src/providers/types.ts`) is the only thing the pipeline
  knows about models.
  - The task carries: instructions, prompt, model, reasoning level, review root, read tools, skill
    catalog, timeout, stall timeout and an abort signal.
  - The result carries: the collected `submit_*` payload, the final text, usage, tool usage and warnings.
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
  - static origin: analyzer and rule, `nonRejectable`.
- **`RunRecord`** holds everything needed to re-render reports later (`runs export`):
  - chunk records (status, provider/model, attempts, timeout, hints, tools used);
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
     and web tools disallowed. Failing to apply a read-only mode fails the task.
   - Codex cannot be confined to read-only by its adapter: it is flagged `unconfined`, never picked as an
     automatic fallback, and a warning is shown when it is configured.
5. **Paths.** Every path from a model or tool call goes through `resolveInside`, a lexical check plus a
   `realpath` check. `files` mode and skill loading skip symlinks, and findings must name a regular file
   inside the root.
6. **Agent processes.** They start in a neutral temp directory, so a repository's `.npmrc` cannot
   redirect `npx`.
7. **Project configs.**
   - Only YAML/JSON is accepted. Unknown keys are errors.
   - They may not set `models`, `analyzers.project` or provider `command`/`args`/`env`, profiles
     included.
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
- **Unfinished turns.** A turn cancelled by its own timeout or stall watchdog, or cut off by an output
  or step limit, fails the chunk. It is never recorded as a clean review.
  - The task's own timeout is not retried.
  - A refusal goes to the model fallback.
  - Hints of a failed chunk are carried to the critic.
- **Secrets and vulnerable dependencies** are never dropped silently. If no claiming finding survives
  validation, they are reported as static findings, including hints beyond the per-chunk cap.
- **CI gate.** `--fail-on` exits with an error when chunks failed, because unreviewed code must not
  pass a gate.

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
- **New report format:** add a renderer in `report/` and a value in `REPORT_FORMATS`.

## Known limitations / roadmap

- Reviewing uncommitted or staged changes; `--resume` of partial runs; a cache by chunk hash.
- Posting review comments to PRs/MRs; GitHub/GitLab username resolution.
- An LLM run summary (`roles.summary` is reserved); cost estimation.
- Anthropic/OpenAI direct API providers.
- The Codex, Copilot and Gemini presets need more live verification.
