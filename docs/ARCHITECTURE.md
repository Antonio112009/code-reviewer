# Architecture

## Data flow

```
 CLI (commander)       config: defaults < depth preset < ~/.code-reviewer < project < profile < flags
   │                   cli/lifecycle.ts: Ctrl+C → abort signal; 2nd Ctrl+C / exit → kill process groups
   ▼
 review/pipeline.ts  (phases emit ReviewEvents → cli/ui: live dashboard | plain lines | JSON)
   1. refs        git/refs.ts          base: --base | CI PR env | gh/glab PR | branch config | rules | default
                                       fetch remote base (deepen shallow clones), merge-base, commit count
                  git/local-changes.ts --staged / --uncommitted: head = snapshot commit on top of HEAD, base HEAD
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
                  chunking/expand.ts   review.expand: impact map / excerpts of unchanged usages and called definitions
                  review/pipeline.ts   review.passes: one copy of each chunk per focused pass (local, contracts)
   5. skills      skills/detector.ts   per chunk: group detection + gates + signals + versions → budget fill
   6. snapshot    git/snapshot.ts      isolated, sanitized worktree of head (agents / cross-provider fallback)
   7. review      review/execute.ts    one AgentTask per chunk (p-limit), ModelRouter: retry / fallback / fail
                  providers/*          ACP agents or Bedrock; read-only tools + submit_findings;
                                       findings submitted as verified (several calls add up);
                                       out of time/steps/output → one short "submit the rest" turn
                  review/findings.ts   submit payload → fallback JSON in text → one repair retry
                  review/pipeline.ts   still failed: split the chunk (≤ 2 levels) or retry once with 2× time
                  models/pricing.ts    usage of every attempt → cost (reported, or tokens × `pricing`)
   8. validate    review/validate.ts   unknown files, out-of-range lines, far from changed hunks; hint claims;
                                       critical/major without a failure path lowered a level (requireFailurePath)
      dedupe      review/dedupe.ts     same file + overlapping lines + similar title / same span
   9. critique    review/critique.ts   batches per file → submit_verdicts → confirmed/uncertain/rejected
      notes       review/critique.ts   category `maintainability` (review.notes) skips the defect critic:
                                       critiqueNotes keeps a note that is true of the changed code; capped by
                                       review.maxNotes → run.notes (reports and the summary comment only)
  10. threshold   minConfidence (non-rejectable static findings bypass it); below advisoryConfidence or
                  info → run.advisory ("worth a look": reports only, not published, SARIF or --fail-on)
  11. authors     review/attribution   git blame → author, commit/line URLs (GitHub/GitLab)
      fingerprint review/fingerprint   stable id per kept finding (file, category, rule, normalised code)
  12. persist     runs/store.ts        run.json, run.log (every message and event), chunk artifacts (prompt,
                                       reply, submission; failed parts too), report/* → md/json/html/sarif/codequality
  13. publish     publish/*            optional (`review --post`, `runs publish`): PR/MR inline comments +
                                       a summary comment, after the run and its reports are saved

 eval (cli/commands/eval.ts)   YAML cases → per case × --repeat: temp repo → runReview → score → result.json
 upgrade (cli/commands/upgrade.ts, util/upgrade.ts)
                               install kind (npm global / pnpm / yarn / bun / npx / project / source) →
                               npm view → npm install --global (npm only; others get the command) →
                               CHANGELOG sections in between. Interactive reviews ask the registry for the
                               latest version once a day (cached in the OS cache dir) and print a notice.
```

## Key contracts

- **`Provider.run(AgentTask) → AgentResult`** (`src/providers/types.ts`) is the only thing the pipeline
  knows about models.
  - The task carries: instructions, prompt, model, reasoning level, review root, read tools, timeout,
    stall timeout and an abort signal.
  - The result carries: the collected `submit_*` payload, the final text, usage, tool usage and warnings,
    plus `interruptedBy` (our timeout / stall watchdog) and `salvaged` (a partial answer: the model was
    asked for an early answer, or was cut short after submitting some findings).
  - `Usage` holds uncached input, cached input, output and reasoning tokens, the number of model
    requests, `estimated` (the provider reported no token counts) and `reportedCost` (ACP `usage_update`).
- **Read tools** (`src/tools/definitions.ts`, the same for ACP agents over MCP and for direct APIs):
  `read_file`, `grep`, `find_symbol`, `find_references`, `list_dir`, `git_log`, `git_blame`.
  - `grep` runs `git grep -P` (PCRE, so `\b`, `\w`, `(?:…)` work; POSIX ERE with a translation when git
    lacks PCRE), `-F` for plain text (no metacharacters, or `literal: true`), 20 s at most. A pattern that
    does not compile is searched as plain text, with a note; any other git error is returned as an error,
    never as "No matches.", which a model would take as evidence. A glob without `/` matches in every
    directory (`*.java` → `**/*.java`).
  - `find_symbol` greps definition forms only: declaration keywords (JS/TS, Python, Go, Rust, Kotlin,
    Swift, …) and C-family definitions (return type and modifiers before `name(` on a line without `;`,
    so calls and prototypes are left out), not in docs or data files.
  - `find_references` greps a name as a whole word (`git grep -w -F`, code files only) and groups the hits by
    file and by the enclosing declaration (`chunking/expand.ts#enclosingDeclaration`), marking definitions:
    the callers of a changed function in one call (at most 30 files, 80 references).
  - Every call is logged (`runTool` → `SubmissionCollector.noteCall`: name, clipped arguments, result
    size, error, duration) to `run.log` and the chunk artifacts; ACP agents' MCP server hands the log back
    through the submission file.
- **Structured output through a tool.** ACP has no response-schema field, so every provider gets the same
  `submit_findings` / `submit_verdicts` tool with zod-validated input. A finding carries a `failurePath`
  (input or state → code path → failure); the critic checks it step by step, and reports and inline
  comments show it.
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
  - `coverage` (`review/coverage.ts`): per changed file, whether every part that owned it answered in full,
    only with an early answer, partly or not at all, or the file was skipped; changed lines and whether the
    model opened the file with a tool. Reports show it as "Coverage", problem files first, and the CLI
    summary names files that were not fully reviewed;
  - `usage` and `cost` of the run (`amount`, `basis`, calls without a known cost, unpriced routes);
  - fallbacks, refs, stack, analyzer runs, skills and tools used;
  - rejected findings with `droppedReason` (`unknown-file`, `line-out-of-range`, `outside-changed-lines`,
    `hint-not-confirmed`, `critique`, `below-threshold`).
- **`ReviewEvent`** (`src/review/events.ts`) is the UI contract: `phase`/`phase-done`, `refs`, `stack`,
  `analyzers`, `plan`, `chunk-start`/`chunk-activity`/`chunk-done`, `critique-start`/`critique-progress`,
  `fallback`, `warning`, `done`. The live dashboard, the plain renderer and `--json` all consume the same
  stream.

## Review depth

`review.depth` is `full` (the default) or `essential`. It is resolved first, from the highest-priority
layer that sets it. `config/load.ts` then puts `DEPTH_PRESETS[depth]` between the built-in defaults and
the config files and flags, so explicit settings always win.

| Setting | essential | full |
|---|---|---|
| `minSeverity` | major | info |
| `skillTokenBudget` | 3500 | 6000 |
| `maxSteps` | 15 | 25 |
| `contextShare` | 0.1 | 0.2 |
| `minConfidence` | 0.7 | 0.3 |
| `advisoryConfidence` | 0 | 0.6 |
| `secondOpinion` | off | on |
| `notes` | off | on |

The depth also affects:
- **Prompts.** The review instructions (`prompts.ts#depthRules`) narrow the scope to serious production
  defects and require a concrete fix. At full depth they ask for recall instead: go through every changed
  hunk and report each plausible defect, partly confirmed ones with a lower confidence, since the critic
  and the confidence threshold remove the false positives.
- **Critique.** At essential depth the critic also rejects real but low-impact findings. At full depth it
  rejects only claims it can refute from the code (misread, already handled, impossible), confirms correct
  low-impact ones at a lower severity, and the threshold is 0.3 (below 0.6 only "worth a look"). On AACR-Bench ctx30 the stricter critic
  and threshold had dropped 16 of the 26 findings that matched expert-verified references.
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
2. **`cluster.ts`** — groups changed files by import edges, call edges, test ↔ source pairs and
   same-directory siblings, deterministically. Each chunk records its `groupReasons`. A call edge
   (`graph.ts#callEdges`) links a file whose changed lines call a function with the file that changes that
   function's declaration, when the caller can refer to it (same directory, or it names the module): the
   changed function and its changed call sites land in one chunk even when imports do not resolve (a Go
   package, C headers). Names changed in more than 3 files or called from more than 8 are skipped.
3. **`chunker.ts` / `pack.ts`** — packs clusters into chunks within the budget. The budget is the context
   window minus output, instructions, the skill budget and hints.
   - Large files are split into windows around the changed hunks.
   - A file owned by one chunk can appear as read-only `context` in another, up to `review.contextShare`
     of the budget.
4. **`render.ts`** — PR-style blocks: new code with new-file line numbers and `+` markers, plus a
   budgeted "removed code" block per hunk.
5. **`expand.ts`** (`review.expand`, `--expand`; `map` by default) — related *unchanged* code. `map` gives
   each chunk an impact map (`chunk.impact`, "Impact map" in the prompt): per changed declaration the
   plausible places that use it (file:line and enclosing declaration, nearest first, at most 6 plus a count
   of further files; a removed or redeclared name with none says so), and where the functions the new code
   calls are defined; at most 800 tokens. `refs` and `deep` add the code itself, as read-only `related`
   parts under "Related unchanged code":
   - **Changed declarations** come from the hunks: declared on a removed line and gone (`removed`) or still
     declared (`signature`), or enclosing changed lines (`body`). Bounded regexes per language family;
     C/C++ `static` functions are file-local and skipped.
   - **Usages** of those names in unchanged source files come from one `git grep -w -F` at the head commit
     (fixed-string identifiers, source extensions only, a few matches per file). A name found in more than
     20 files is dropped as too common, and a match counts only if its file shares the changed file's
     directory or names its module (import, `#include`, Go package qualifier).
   - **Definitions** of functions the added lines call are shown when the changed files refer to the file
     that defines them. At `deep`, the callers of the usages are added too (one more hop).
   - Excerpts are windows around each site (from the enclosing declaration when it is close), at most three
     sites per file, within 15% (`refs`) or 25% (`deep`) of the chunk budget. The reviewer is told to report
     a defect the change causes there on the changed line that causes it. A split drops them, like context.

### Function audit (`review.audit`, `--audit`; experimental, off)

The prompt lists the chunk's changed functions (`chunk.declarations` without removed ones, computed even with
`expand: off`) under "Changed functions to audit", and the instructions ask to check each one — early returns
restoring state, edge-case inputs, parsed values, calls, callers — and to keep checking a function after its
first defect. The model records each function in `submit_findings.audit`; the chunk record keeps
`audit: { listed, audited }`. Aimed at the reviewer reporting one defect per place where several exist.

### Second pass (`review.deepen`, `--deepen`; off)

With `review.deepen`, `deepen` in `review/pipeline.ts` runs every reviewed part a second time as an independent
task: the same prompt and instructions, `reasoning: high` (`SECOND_PASS_REASONING`), told nothing about the
first pass. Its findings join the part's: a finding the first pass already reported (same file, overlapping
lines, similar title) is kept once with `passes: 2`, the others get `passes: 1`, and the chunk record keeps how
many the second pass added (`deepened`). `critiqueFindingIdentity` shows the critic which findings both passes
reported ("reportedBy"), as evidence to check, not a verdict. The first pass is cached under its usual key and
the second under its own (`SECOND_PASS`), so a run with `--deepen` after one without it pays only for the
second pass. A failed second pass keeps the first and its usage.

Without `--deepen`, `review/advice.ts` suggests it after a run with findings (`run.advice.deepen`: every
reviewed chunk and an estimate of `DEEPEN_COST_FACTOR` × the first pass's cost, left out when a chunk's cost is
unknown); `deepenAdviceText` renders it in the summary and the markdown report.

### Self-critique (`review/critique.ts`)

Every kept finding goes to the critic in batches per file with a code excerpt around its lines; in a diff
review the excerpt marks the lines the change added or modified with `+`, so a pre-existing problem can be
told apart. Under the excerpt, `calleeNotes` lists where the functions called on the reported lines are
defined (`findDefinitions`, the search behind `find_symbol`; product code before tests, up to three per name,
nothing for library calls or names defined in more than six places): verifiers did not look these up
themselves, and a claim about what happens behind an interface or handler call can only be checked there.
The critic's instructions (`critiqueInstructions`) come from a hand audit of AACR-Bench findings
that matched no reference (`evals/aacr/README.md`): a finding is judged by its headline claim, but an
overstated headline over a verified defect is kept with a corrected `title` (`critique.originalTitle` keeps
the reviewer's); a "not handled / not checked" claim needs the next layer read (callee, wrapper, callers); a
claim resting on an external system's schema, limits or API that the repository does not show is `uncertain`
with confidence at most 0.4 (below `advisoryConfidence`, so "worth a look" rather than a main finding);
"probably false" is `rejected`, not `uncertain`; test-only hygiene and harmless leftover logging are not
listed at all. At full depth the critic has three outcomes, not two: a claim that is wrong about the code is
rejected; a true observation with no realistic way to fail (a redundant check, formally undefined but working
behaviour, hardening advice) is confirmed as `info` with a confidence of at most 0.5 and lands under "worth a
look"; everything else is a defect, with a lower severity when its impact is small. At essential depth the
middle kind is rejected.

Second opinion (`review.secondOpinion`, `--second-opinion`; on at full depth through `DEPTH_PRESETS`, off at
essential): findings the critic kept with a confidence
from 0.1 below to 0.15 above the bar of the main report (`secondOpinionRange`: `advisoryConfidence`, else
`minConfidence`) go to a second verifier, two per task with the full step budget. Its instructions are the
critic's plus the task of refuting each finding with code the first did not read (implementations behind an
interface, callers, what produces the value), and it sees the first verdict. Its verdict replaces the first;
`critique.firstOpinion` keeps the first. Its verdicts are cached under their own instructions. A second
opinion that does not arrive leaves the first verdict.

### Review passes (`review.passes`, `--passes`)

`[general]` (the default) reviews each chunk once. A list of focused passes reviews every chunk once per
pass instead: `withPasses` copies the chunk (`c001-local`, `c001-contracts`), and `reviewInstructions` adds
the pass's focus. The copies go through scheduling, recovery, the cache and dedupe like any chunk.
- `local` — the changed lines hunk by hunk; told not to spend steps on callers elsewhere.
- `contracts` — the declarations the change touches and their consumers. It always gets `expand`
  (`refs` unless `review.expand` says `deep`) and a "Changed declarations" checklist, is asked to construct
  counterexamples to the guarantees the change modifies, and reports on the changed line.

## Skills (`src/skills/`, `skills/`)

- **Attribution.** Checklists are shown to the model as `### Name [id]`; a finding may name the one that led to
  it (`checklist`), kept only when the chunk had that skill (`review/findings.ts#toFinding`). Reports count
  findings per skill, and `skills usage` sums chunks and findings over the saved runs (`RunStore.recent`).
- **Selection record.** Each chunk record keeps why every skill was picked (`skillReasons`: `content:/re/`,
  `stack:…`, `file:…`, `always-on`, …) and which matching skills did not fit `review.skillTokenBudget`
  (`skillsDropped`). The plan, the markdown report ("Skills per chunk") and `skills usage` ("over budget")
  show them. `test/skill-selection.test.ts` holds golden cases: a small change per technology must pick the
  skills about it and none about other technologies.
- **Tree.** The skill id is its path (`javascript/react/effects`). Every folder has a `_group.yaml` with
  `name`, `description`, `category`, `priority`, `tier` and `detect`. Category, priority and tier are
  inherited by the skills below. A bullet marked `[full]` is left out at essential depth (see Review
  depth).
- **Matching** (`detector.ts#matchSkill`), **one file at a time**: a skill matches a chunk when it matches
  one of its files on that file's language, path, content and added lines (the stack gate uses the
  chunk's techs). So Java lines cannot trigger a C++ skill in a mixed chunk. Prose files (`markdown`,
  `text`) feed `content` signals only to skills whose own or group `languages` name that language (a CMake
  file is `text`, and the C/C++ group names it). Per file:
  1. Every ancestor group's `detect` must match. Gates (`stack`, `languages`, `versions`) must pass. If
     signals are declared, one of them must hit: `files` on the path, `content` on the **full content**.
  2. The skill's own gates must pass.
  3. Its signals must hit. In diff mode, `content` runs on the **added lines**.
  4. The score is priority + specificity (content 40 > files 30 > stack 20 > language 10) + depth × 3; the
     best-scoring file counts. On the AACR-Bench chunks this removed every wrong-language pick found
     (8 of 38 chunks changed, each only by those picks and what filled their budget).
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
- **No loading on demand.** `list_skills` / `get_skill` tools were removed: in 875 recorded review tasks
  (AACR-Bench and the eval corpus) models never called them, and they cost ~380 tokens per request.
- **Validation.** `test/skills-library.test.ts` validates the library: tree, groups, frontmatter, tech
  and language ids, version ranges, ReDoS timing on adversarial inputs, glob examples, size and bullet
  limits, source URLs. `code-reviewer skills lint` runs the loader checks on a user directory.

## Static analyzers (`src/analyzers/`)

- **Built-in.**
  - secretlint (preset-recommend);
  - regex pattern rules (`patterns/rules-*.ts`), restricted to changed ranges.
- **External "safe" tools**, run when found on PATH: gitleaks, shellcheck, hadolint, ruff, cppcheck, and
  ast-grep for the skills' structural checks — it also ships with the package (`@ast-grep/cli`, an optional
  dependency, read from its platform package so it works without install scripts; none for musl Linux), used
  when PATH has none, and like any program it must lie outside the reviewed code (`analyzers/ast-grep.ts`: the loaded skills' `checks` are
  written to one rules file in the sandbox's scratch dir and run with `scan --rule` and every ignore source
  off; a hit's rule id is `<skill>#<check>`). The analyzers wait for the skills to load.
  - Explicit flags make them ignore repository configs and plugins.
  - They run with a sanitized environment, a timeout and a process-group kill.
- **Project tools**, opt-in only: eslint, tsc, golangci-lint, phpstan, semgrep/opengrep, osv-scanner. They
  load repository configs or plugins, so they are allowed only via `--analyzers` or the global config.
- **Output.** Results are normalized to `StaticHit` by SARIF or tool-specific parsers, with paths confined
  to the root.
- **Suppression comments.** A change that adds one (`nosec`, `noqa`, `eslint-disable`, `NOLINT`, …) may
  be hiding the very defect a tool would report, so a newly added marker becomes an `info` hint.

## Providers

### Direct APIs (`providers/ai-sdk-agent.ts`: Bedrock, Anthropic, OpenAI-compatible)
- One tool loop for all of them: Vercel AI SDK v7 `generateText` with `tools`, capped by `isStepCount(maxSteps)`.
  A review continues after submitting findings until the model answers without a tool call; a critique ends
  at its first `submit_verdicts`. The last step (or one after 80% of the time) offers only the submit tool,
  and a review's submission there ends the loop. The portable `reasoning` level maps to the provider's reasoning settings.
- **Prompt caching.** Every step of the loop sends the whole conversation again, so the prefix is cached:
  the Anthropic API gets request-level `cache_control` (it places the breakpoint itself); Bedrock gets a
  `cachePoint` on the instructions and on the newest message of each step (moved, not piled up: at most
  four per request), for Anthropic models only. Cache reads and writes are recorded in `Usage`.
- **Bedrock** (`bedrock.ts`): the region is validated; credentials come from the AWS provider chain unless
  `AWS_BEARER_TOKEN_BEDROCK` is set.
- **Anthropic** (`anthropic.ts`): `ANTHROPIC_API_KEY`, no configurable base URL. Compared with Claude Code
  over ACP a task carries only our instructions, prompt and tools: in the eval corpus Claude Code read
  ~143k input tokens per review task for a ~5k-token prompt (its own system prompt and tools, re-read every
  turn).
- **OpenAI-compatible** (`openai.ts`, `@ai-sdk/openai-compatible`): chat completions at `baseUrl` (default
  `https://api.openai.com/v1`) with the key from `apiKeyEnv` (default `OPENAI_API_KEY`; `none` sends no
  key). Built in: `openai`, `openrouter`, `ollama` (localhost, no key). No default model and no catalog:
  the model comes from `--model`, the role or `defaultModel`; `providers models` lists `GET /models`, and a
  model missing from that list is `unverified`, not unavailable (Azure deployments, LiteLLM wildcard
  routes). `reasoning_effort` is sent only with `reasoningEffort: true`, since models without reasoning
  reject it. No prompt caching option: OpenAI caches long prefixes by itself.

### ACP (`providers/acp/`)
- **`presets.ts`** — for each agent: how to launch it, its read-only lever, and whether model/effort are
  set per session (config options) or per process (Copilot flags).
- **`connection.ts`** — one agent process (its own process group, neutral cwd) plus an ACP client.
  - An adapter launched through `npx` (`LaunchSpec.offlineFirst`) is started from npm's cache first
    (`npm_config_offline=true`): `npx -y pkg@range` otherwise asks the registry at every start, and a slow
    registry stalled starts until `initialize` timed out. Only when npm answers `ENOTCACHED` (the first use
    of an adapter version) is the start repeated online. The adapter therefore changes version when the
    preset's range changes or the cache is cleared, not on every patch release.
  - Each task gets a **fresh session** with our MCP server attached:
    `code-reviewer mcp-serve --root <snapshot> --kind findings --submit-file <tmp>`.
  - Model, effort and read-only mode are applied with `session/set_config_option`. The option list
    returned by each call replaces the current one.
  - Every request has a timeout. A stall watchdog cancels a turn with no activity for
    `review.stallTimeoutMs`.
- **`permissions.ts`**:
  - reads and our own MCP tools (exact names) are allowed;
  - edit/delete/move/execute/fetch/switch_mode are always rejected.
- **`provider.ts`** — a pool of up to `concurrency` processes. Broken connections are replaced.

### Model routing (`review/execute.ts`, `models/*`)
- **Routes** (`pipeline.ts#resolveRouting`): the review uses its role's model, else the provider's
  `defaultModel`. The critic runs on the review provider unless a critique role names another; without a
  model of its own it takes the provider's `critiqueModel` (claude: `sonnet`), else the review's model on the
  same provider, else that provider's default. `--model` sets the review model only.
- **Preflight.** It discovers the models of each provider and classifies them (tier, vendor). If a
  configured model is missing, it runs `resolveFallback` (`ask | fallback | fail`) before the run
  starts.
- **During the run**, `runRouted` classifies each error:
  - transient: back off and retry, up to 3 attempts;
  - unavailable or refusal: `ModelRouter.replace()`. One shared decision per failed model moves every
    chunk to the same replacement;
  - authentication: fatal, remaining chunks are skipped.
- Fallbacks are recorded in the run and shown in the summary.

## Local changes (`git/local-changes.ts`, `cli/commands/hook.ts`)

- `review --staged` / `--uncommitted` turn the changes into a commit whose parent is HEAD, so the rest of
  the pipeline (diff, snapshot, blame, `git grep`, cache) runs unchanged:
  - `staged`: `git write-tree` of the index — the one a pre-commit hook was given (`GIT_INDEX_FILE`, a
    temporary index for `git commit -a`), else the repository's;
  - `uncommitted`: a temporary copy of the index, `add --update`, then the untracked, non-ignored files
    (literal pathspecs; the runs directory excluded), then `write-tree`;
  - `commit-tree --no-gpg-sign` as "Not Committed Yet" (what `git blame` shows for such lines). No hook
    runs, and no ref, index or working-tree file is written; the objects are unreachable and left to
    `git gc`. An unchanged tree is "nothing to review" (exit 0), unmerged entries are an error.
- The base is HEAD (`baseSource: local`) unless `--base` is given, which adds the branch's commits.
  `RunTarget.local` marks the run: no forge links, and `publish` refuses it.
- Every other git child runs without `GIT_INDEX_FILE` (`git/repo.ts#gitEnv`): a review started from a
  hook must not let `status` or `worktree add` use, or write, the index being committed.
- `hook install` writes `pre-commit` into `git rev-parse --git-path hooks` with a marker line; it
  replaces or removes only a hook with that marker, and with `core.hooksPath` set (husky, lefthook) it
  prints the command instead. The script runs `code-reviewer review --staged -y --fail-on <severity>`
  from `PATH`; exit 1 (findings) blocks the commit, any other failure lets it through with a message.

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
  - `history.ts`: the summary comment carries a hidden, base64-encoded state marker (head and up to 100
    findings: fingerprint, file:line, severity, title). The next publication reads it back from our own
    summary only, validates it with a strict schema, and renders "Since the previous review": fixed (thread
    resolved), no longer reported, new, still open. Nothing is shown when the same commit is published again.
  - One-click changes (`render.ts#suggestionBlock`): a finding's `replacement` (the fixed text of exactly its
    lines) becomes a ```` ```suggestion ```` block (GitLab: `suggestion:-N+M` around its single anchor line)
    only when validation kept it (≤ 30 lines replaced, ≤ 60 written, differs from the code, no fence) and the
    critic set `replacementOk`; never on a `--force`d publication to a moved head.
  - `github.ts` / `gitlab.ts` implement `ForgeAdapter` (`load` → head + posted fingerprints, `postInline`,
    `upsertSummary`, `openThreads`, `resolveThread`). GitHub: one `COMMENT` review, single comments after a
    422, the summary as an issue comment edited in place, review threads through GraphQL
    (`reviewThreads`, `resolveReviewThread`; `/api/graphql` on Enterprise Server). GitLab: one positioned
    discussion per finding (`diff_refs`), the summary as an MR note updated with PUT, threads resolved with
    `PUT …/discussions/:id?resolved=true`.
  - `resolve.ts` (`publish.resolveFixed`, on the reviewed head only) picks the threads of fixed findings.
    A model may simply not report a finding again, so every sign must agree: no finding or advisory finding
    of the run has the fingerprint; the file was reviewed without a failed chunk (or the PR no longer
    changes it); `git diff -U0 <comment commit> <head> -- <path>` touches the commented lines (a commit
    missing locally, e.g. after a force push, proves nothing); and no finding of the run lies within three
    lines of where those lines went (the same issue in rewritten code gets a new fingerprint). The reply
    carries `<!-- code-reviewer:resolved -->`, so a thread someone reopens is not resolved again. Forge
    errors (a token that may comment but not resolve) become a summary note.
  - `http.ts` is a small `fetch` client (injectable): timeouts plus the run's abort signal, 429/5xx retries
    honouring `Retry-After` (3 attempts), `Link` pagination, no redirects, same-origin requests only.
  - `render.ts` escapes model/repository text like the Markdown report and also defuses mentions,
    `#123`/`!123` references, links, autolinks and line-leading `/` (GitLab quick actions). Hidden markers
    (`<!-- code-reviewer:summary -->`, `<!-- code-reviewer:fp=… -->`, `<!-- code-reviewer:resolved -->`)
    identify our comments.

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
   - Claude review sessions load **no settings files** (`settingSources: []`; the adapter's default is
     user, project and local): the user's plugins, hooks and skills stay out — no language servers or hooks
     run in a snapshot of untrusted code, and no one's personal setup changes a review. Only `env` and
     `apiKeyHelper` of the user's `settings.json` are handed over (`claudeAuthSettings`), so gateways and
     Bedrock/Vertex routing keep working; `providers.claude.userSettings: true` (global config only) loads
     the user settings instead. Built-in tools are limited to `Read`, `Grep` and `Glob` (`tools`), and
     sub-agents (`Task`, `Agent`), whose calls and cost we cannot see, are disallowed. On a one-file review
     this took a task from 75k to 22k cache-written tokens ($0.32 → $0.10) with the same finding.
   - Codex cannot be confined to read-only by its adapter: it is flagged `unconfined`, never picked as an
     automatic fallback, and a warning is shown when it is configured.
5. **Paths.** Every path from a model or tool call goes through `resolveInside`, a lexical check plus a
   `realpath` check. The one exception is installed dependency sources (`tools/dependencies.ts`,
   `review.dependencySources`): the Go module cache and Cargo registry from the user's environment, and
   `node_modules` / a virtualenv's `site-packages` of the user's checkout, only as real directories with no
   symlink between the checkout and them. `read_file`, ACP read permissions and `fs/read_text_file` accept
   an absolute path there only when its real path is an existing file inside one of them, so a link from
   `node_modules` to `~/.ssh` is refused. The instructions list the directories. `files` mode and skill loading skip symlinks, and findings must name a regular file
   inside the root.
6. **Agent processes.** They start in a neutral temp directory, so a repository's `.npmrc` cannot
   redirect `npx`.
7. **Project configs.**
   - Only YAML/JSON is accepted. Unknown keys are errors.
   - They may not set `models`, `analyzers.project`, provider `command`/`args`/`env`, provider
     `baseUrl`/`apiKeyEnv` (where the code and which secret are sent) or
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
   - The non-git `grep` fallback rejects backtracking-prone patterns and vets globs like other untrusted
     globs; `git grep -P` relies on PCRE's backtracking limit and a 20 s timeout.
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
  `maxTimeoutMs`. A model still calling tools when the time is up (a call in the last minute) gets more
  time in steps of ¼ of the timeout (at least 30 s), up to `review.activeExtension` × the timeout in all
  (`providers/deadline.ts`); a model that went quiet is cut off on time. The stall watchdog, request
  timeouts and the grace period after `session/cancel` all apply. A timed-out or exited agent is marked `broken` and replaced.
- **Ctrl+C** (`cli/lifecycle.ts`):
  - First press: the abort signal fires. Running sessions get `session/cancel`, no new agents are
    spawned, critique and blame are skipped, and the run is saved with status `partial` (exit 130).
  - Second press: SIGKILL to every registered process group, synchronous worktree removal, exit.
- **Removed code** is budgeted (≤40% of a part, truncated with a note) and shown once per hunk.
- **Long lines** (minified code, inline base64) are clipped at 2,000 characters. Pieces still over
  budget are split again.
- **Unfinished turns** are never recorded as a clean review. Recovery, cheapest first:
  1. **Early answer.** Reviews submit findings as they verify them (`submit_findings` calls add up), so a
     cut-off review keeps what it submitted. A turn that ran out of time (task timeout, stall watchdog),
     steps or output gets one short extra turn (`providers/salvage.ts`, ¼ of the timeout, 30–90 s): "stop,
     call `submit_findings` with what you have" — or, after earlier submissions, with what it has not
     submitted yet. A critique gets it only when it submitted nothing: verdicts come in one call. ACP agents
     get it as a follow-up prompt in the same session; the direct API loop (Anthropic, Bedrock, OpenAI-compatible) offers only
     the submit tool on its last step, or once 80% of the time is gone (not a forced tool choice, which
     extended thinking rejects), and ends with that submission. Findings from such a turn are kept; the
     chunk's `recovery` says so.
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
- **Budget** (`review.maxCost`, `CostBudget`): `runRouted` checks it before every attempt and adds each
  call's cost when it returns; a task that may not start fails with `BudgetExceededError` (failure kind
  `budget`, never split or retried). With self-critique on, review tasks stop at 85% of the budget
  (`CRITIQUE_RESERVE`) and critique batches may use the rest. Running tasks finish, so a run can exceed the
  budget by what they spend. Calls without a known cost (no price, another currency than USD) do not count
  and are named once in a warning.

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
  within a tolerance, best fit first; a finding whose title matches the defect's `note` or the case title
  beats a closer one about something else); duplicates (a title like the matched finding's) apart from other
  issues next to a labelled defect (listed for labelling, not counted), unexpected findings, false positives on
  clean cases;
  the self-critique effect from the run's removed findings; micro-averaged totals per pass.
- **`compare.ts`** (pure) — deltas against a previous result over the common cases. **`store.ts`** —
  `result.json`, validated when loaded for `--compare`.
- **`evals/`** — the built-in corpus; `test/evals-corpus.test.ts` checks every case (fields, lines in
  the head file and in the changed hunks, no hint markers, size).

## Extension points

- **New provider type:** implement `Provider` (an AI SDK model: reuse `runAiSdkTask`), add a schema variant
  in `config/schema.ts`, and wire it in `providers/registry.ts`, `providers/detect.ts`,
  `models/discovery.ts` and the model catalog.
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

- Resolving PR/MR threads of fixed findings; Bitbucket / Azure DevOps comments; GitHub/GitLab username
  resolution.
- An LLM run summary (`roles.summary` is reserved); a cost budget that stops a run.
- The Codex, Copilot and Gemini presets need more live verification.
