# Changelog

## Unreleased

- **`code-reviewer upgrade`.** Updates an npm global install in place (retrying while a just-published version
  is still reaching the registry) and prints the CHANGELOG sections between the old and the new version.
  `--check` / `--json` only report, `--to <version>` installs an exact version. For pnpm, yarn, bun, npx, a
  project dependency or a source checkout it prints the command to run. Interactive reviews say once a day
  when a newer version exists (off in CI, with `--json`/`--quiet`, and with `CODE_REVIEWER_NO_UPDATE_CHECK=1`).
- **Install size back to about 200 MB.** 0.5.1 installed 635 MB: npm installs every platform's optional
  package listed in a dependency's `npm-shrinkwrap.json`, so all eight ast-grep binaries were downloaded. The
  package no longer ships a shrinkwrap; its direct dependencies are pinned to the tested versions instead, and
  CI checks that an install gets a single ast-grep binary.
- **Skill attribution works with Claude.** Reviews on Claude Sonnet never filled a finding's `checklist`, so
  `skills usage` credited no findings to any skill. The prompt now asks for the id without its brackets (and
  brackets are stripped when a model copies them), and a finding that confirms a skill's ast-grep check is
  credited to that skill. A live review of a small change now attributes every finding.
- **Eval fixes.** An `also` range in another file was checked against the wrong file, so the click case failed
  with "does not exist in the head version"; a reported optional defect is now counted as found, and the
  summary no longer lists optional defects under "Missed".
- **Optional defects in eval cases.** `optional: true` marks a real but lesser defect: finding it counts as
  acceptable, missing it is not counted, and a case with only optional defects stays clean. The built-in
  corpus labels five such issues that reviews kept reporting (CSV formula injection and an in-memory export,
  unhandled interruption of part downloads, an error left on screen, an unvalidated `order` parameter that was
  counted as a false positive on a clean case) and one more place for the click regression.
- **Which skills each chunk used, and why.** Runs record for every chunk why each skill was picked (a regex on
  the changed lines, the stack, a file pattern, always-on) and which matching skills the skill budget left out.
  The dry-run plan and the markdown report ("Skills per chunk") show both, and `skills usage` counts how often
  each skill was left out. Golden tests check that small changes in React, Go, Django, JNI and plain docs pick
  the right skills and none of other technologies.
- **Clearer help.** `code-reviewer --help` groups the commands (review, results, setup, measure quality) and
  shows examples; `review --help` groups its options (what to review, models, depth and filters, output and
  CI, cost and speed, advanced, pull request comments) and ends with examples, starting with comparing two
  branches. The README has a "Compare two branches" section.
- **README badge.** The Node.js badge rendered as broken text on GitHub (a `>` in its alt text).

## 0.5.1 — 2026-09-30

The skills' structural checks now work out of the box: ast-grep is installed with the package.

### Packaging

- **ast-grep ships with the package.** The skills' structural checks now run for everyone, without installing
  ast-grep: `@ast-grep/cli` is an optional dependency (macOS, glibc Linux and Windows; not musl Linux), found
  even when install scripts are disabled. An ast-grep on PATH still takes precedence. The installed package
  grows by about 100 MB.
- **The package is tested as users install it.** CI packs it, installs it globally and reviews a planted
  defect on Linux, macOS and Windows (the bundled ast-grep must flag it) and on Alpine (the install and review
  must work without ast-grep).

## 0.5.0 — 2026-09-29

Pull request comments can be applied with one click and say what changed since the previous review; findings
name the skill that led to them; ten structural checks run through ast-grep; and Claude Sonnet 5.5 is supported
— it reviews at the same quality as Sonnet 5 for about a third less per run, in less than half the time.

### Pull requests

- **One-click fixes in pull request comments.** When a fix changes only the lines a finding is about, the model
  gives the exact replacement, the self-critique checks that it compiles and fixes the defect, and the inline
  comment carries it as a suggested change ("Commit suggestion" on GitHub, "Apply suggestion" on GitLab).
  Reports show it too, marked checked or not; an unchecked one is never offered in a comment.
- **What changed since the previous review.** After a new push, the pull request summary lists the findings
  that were fixed, those no longer reported, the new ones, and how many are still open. The previous review
  is remembered in a hidden marker of our own summary comment.

### Review quality

- **Claude Sonnet 5.5.** The Anthropic API provider reviews with `claude-sonnet-5-5` by default (was
  `claude-sonnet-5`); the Claude Code, API and Bedrock model lists include it. Claude Code 2.1.284 already
  maps its `sonnet` alias to it. Same price per token as Sonnet 5; on AACR-Bench ctx30 it matched Sonnet 5
  (F1 12.2%) for a third less cost per run (fewer output tokens) in under half the time.
- **Six more structural checks** (ast-grep, when it is on PATH): `realloc` result written over the pointer it
  frees on failure (C/C++), `WaitGroup.Add` inside the goroutine it counts (Go), `useEffect` starting an
  interval or listener without a cleanup (React), strings compared with `==` (Java), empty `catch` blocks
  (Java, JavaScript/TypeScript, C#), `async void` methods that are not event handlers (C#). Every check now
  also lists `counterexamples` — correct code it must not flag — and the library test runs both.
- **Which skills find bugs.** A finding names the checklist that led to it ("from checklist: …" in the
  reports), and `code-reviewer skills usage` shows, over the saved runs, how many chunks each skill was in and
  how many findings it led to — the skills that never help become visible.
- **JNI skill** (`c-cpp/jni`): unchecked NULL results and pending exceptions, a cached `JNIEnv*`, local
  references kept or piling up in loops, unreleased buffers, critical regions and 32-bit lengths. On
  AACR-Bench the reviewer found 1 of 5 such defects in one opencv change.
- **Two more traps in the general checklist**: flags where any non-empty string (`"false"`) means on, and
  in-progress flags or counters not restored on an early return.

### Experimental

- **Function audit (experimental, `--audit`).** The prompt lists every changed function and the model audits
  each one — early returns restoring state, edge-case and parsed inputs, calls, callers — instead of stopping
  at the first defect of a function. Measured on AACR-Bench ctx30 it did not raise recall (7.2% either way), so
  it stays off.

### Measuring

- **Eval matching tells issues apart.** When several findings sit next to a labelled defect, the one about the
  defect (its `note`, else the case title) is credited rather than the closest one, and the rest are split into
  duplicates (the same defect again) and other issues next to it, listed for labelling. Sonnet 5.5 reported
  several real bugs next to planted ones that used to show up as "duplicates".

## 0.4.0 — 2026-09-29

Reviews see further than the diff: every chunk gets an impact map of the unchanged code the change reaches, a
`find_references` tool lists a function's callers, installed dependencies can be read, and changed functions
share a chunk with their changed callers. Findings name their failure path, reports show which changed files
were really reviewed, and skills can carry ast-grep checks. On the eval corpus (33 cases) the results match
0.3.0 — recall 27/27, precision 96%, no false positives on the 8 clean changes — for about 3% more cost; all 38
findings came with a failure path.

### Changed defaults

- **Impact map.** Every chunk now lists where unchanged code uses the declarations the change modifies
  (file:line and the enclosing function, nearest first) and where the functions the new code calls are
  defined; a removed or redeclared name with no remaining uses says so. It costs a few hundred tokens at
  most and replaces the excerpts as the default: `review.expand` is now `map` (was `off`); `refs` and `deep`
  add the code as before. C++ classes declared with an export macro (`class MYLIB_API Name`) are now read
  by their name.
- **Findings name their failure path.** `submit_findings` asks for a `failurePath` — the input or state, the
  code path it takes, the failure (`empty cart from POST /checkout → total() divides by items.length → NaN
  is charged`). The critic checks it step by step, and reports and pull request comments show it. A critical
  or major finding without one is lowered a level before critique (`review.requireFailurePath: false` turns
  that off).

### New

- **`find_references` tool.** Every use of a function, method, class, field or variable, grouped by file and
  by the enclosing function, with definitions marked: the callers of a changed function in one call. Cross-file
  (repository-level) defects were the weakest spot on AACR-Bench: 6 of 45 such references were ever found.
- **The model can read installed dependencies.** `read_file` (and Claude Code's own reads) accept absolute
  paths into the Go module cache, the Cargo registry, and the checkout's `node_modules` and virtualenv, read
  only, so a review can check what a called library function really does. On AACR-Bench, models tried and
  were refused 7 times. Only real directories count, and a file must resolve inside one (no symlink out);
  `review.dependencySources: false` turns it off.
- **Changed functions and their changed callers share a chunk.** When one changed file calls a function
  whose declaration another changed file modifies, the two are grouped like importing files (`calls` in the
  plan), also where imports do not resolve: files of one Go package, C/C++ headers, dynamic imports.
- **More time while the model is working.** A review task that is still calling tools when its time runs out
  is extended in steps, up to `review.activeExtension` × its timeout (default 0.5; 0 turns it off). About 8%
  of review tasks were cut off by the time limit, and they were the most thorough ones.
- **Coverage map.** Reports show which changed files the review really covered: reviewed in full, cut short
  (the model gave an early answer), partly or not reviewed (failed chunks), or skipped (and why), with the
  changed lines, whether the model opened the file with a tool, and the findings in it. The terminal summary
  names the files that were not fully reviewed.
- **Structural checks in skills.** A skill can carry ast-grep rules (`checks:`), run before the review on
  the changed files when `ast-grep` is on PATH; matches on changed lines become hints. The first four:
  `async` callbacks passed to `forEach` and `async` Promise executors (JavaScript/TypeScript), `defer`
  inside a loop (Go, not inside a closure) and mutable default arguments (Python). The repository's
  `sgconfig.yml` and ignore files are never used; `fix` and `transform` are refused.
- **Skill signals are tested.** Every `content` regex of a skill or group now comes with `examples` of code it
  must match, and every example must match one of them (`test/skills-library.test.ts`); project skills may
  declare them too. Signals that fired on most code were narrowed: Go nil values (on 78% of Go samples from
  AACR-Bench, now 10%), C/C++ integer conversions (30% → 6%), Go `defer`, Go parallel tests and Rust
  secrets in `Debug`.

### Fixes

- **Regex escaping in `find_references`.** The fallback without git escapes every regex metacharacter (the
  name was already limited to identifier characters; flagged by CodeQL).

## 0.3.0 — 2026-09-28

Pull request threads of fixed findings are resolved, a run can be capped by cost, and reviews through Claude
Code cost about a third on small changes: sessions no longer load the user's plugins and get three built-in
tools. The search tools the model relies on no longer return empty results on errors, and skills are chosen
per file.

### New

- **Fixed findings resolve their threads.** When a push changes the code an earlier inline comment was on
  and the new review does not report that finding again, the comment's thread on the GitHub pull request or
  GitLab merge request gets a short reply and is resolved. A model can miss a finding it reported before, so
  nothing is resolved unless the commented lines changed, the file was reviewed in full and no new finding
  sits where the code went. A thread someone reopens stays open; `publish.resolveFixed: false` turns it off.

- **Cost limit per run.** `--max-cost <usd>` (`review.maxCost`) stops starting model calls once a run has
  spent that much, counting the provider's reported cost or your `pricing`. With self-critique on, reviews
  stop at 85% so the findings can still be verified. Unreviewed parts are marked `budget` (with advice) and
  keep a `--fail-on` gate from passing; calls without a known cost are named in a warning.

### Cheaper and more accurate reviews

- **Claude Code reviews cost about a third.** Review sessions no longer load the user's Claude Code
  settings (plugins, hooks, skills; the ACP adapter loaded user, project and local settings), get only the
  `Read`, `Grep` and `Glob` built-in tools next to ours, and cannot start sub-agents, whose calls and cost
  were invisible. A one-file review went from 75k to 22k cache-written tokens and from $0.32 to $0.10 with
  the same finding; a cross-file one still read the other file and found the bug. A run of the AACR-Bench
  ctx30 subset went from $19.8 to $14.3 at the same F1. It also keeps language
  servers and hooks from plugins out of snapshots of untrusted code. The `env` and `apiKeyHelper` of
  `~/.claude/settings.json` are still handed over for sign-in; `providers.claude.userSettings: true`
  (global config only) loads the user settings as before.

- **Search tools that do not mislead the model.** `grep` failed silently: an unbalanced `(`, `(?:`, `\b`,
  `\w` or `\d` (common in model-written patterns) returned "No matches." on macOS, and a glob like
  `*.java` searched the repository root only. It now takes Perl-compatible regexes, searches plain text
  as plain text, retries a pattern that does not compile as plain text (and says so), returns git's
  errors instead of an empty result, and matches directory-less globs everywhere. `find_symbol` now
  finds C, C++, Java, C# and Kotlin definitions instead of call sites, and skips docs.

- **Skills are matched per file.** A chunk's added lines used to be matched as one text, so Java lines
  picked C++ and Python skills in a mixed chunk, Go lines JavaScript skills, a Markdown table the crypto
  checklist and SQL in C++ strings the SQL skills, each taking budget from the chunk's own language. Now a
  skill must match one file on that file's language, content and added lines, and prose (Markdown, plain
  text) only feeds skills about it. On the 38 AACR-Bench chunks, the 8 that changed lost exactly those
  picks, and relevant skills took their budget.

- **Tool calls are logged.** Every read-tool call (arguments, result size, error, duration) is in
  `run.log` and the chunk artifacts, so empty searches and errors can be measured.

- `list_skills` / `get_skill` are gone: models never called them in 875 recorded review tasks, and they
  cost ~380 tokens per request plus loading every skill in each agent's MCP server.
## 0.2.1 — 2026-09-28

- **Installs get the dependencies this release was tested with.** The package ships `npm-shrinkwrap.json`,
  so `npm install -g @antonio112009/code-reviewer` installs the exact dependency tree that CI tested,
  not the newest versions within the ranges. Minutes after 0.2.0 was published, a dependency released out
  of order (`@ai-sdk/amazon-bedrock@5.0.98` required an `@ai-sdk/openai` version that did not exist yet)
  and broke fresh installs; likewise, a new version of a transitive dependency no longer reaches users
  before a release of ours. npm applies the shrinkwrap to installs from the registry only, not to the
  GitHub release tarball installed by URL.
- `npm-shrinkwrap.json` is left out of reviews by default, like the other lockfiles.

## 0.2.0 — 2026-09-28

Pull request comments and CI integration, reviews of uncommitted changes with a pre-commit hook, direct
Anthropic and OpenAI-compatible APIs (Ollama, OpenRouter, …), a result cache, cost tracking, quality
evals, and a full depth that finds more of what expert reviewers flag on AACR-Bench (see Review quality).

### New

- **Pull request comments.** `code-reviewer review --post` and `code-reviewer runs publish [id]` post a
  review to its GitHub pull request or GitLab merge request: inline comments on findings inside the diff
  (capped by `publish.maxInlineComments`, filtered by `publish.minSeverity`) and one summary comment that
  later runs update in place. Findings already commented on are not repeated, nothing goes inline when the
  pull request moved since the review (unless `--force`), and `--dry-run` shows what would be posted. The
  target comes from `--pr` / `--repo` / `--forge` / `--api-url`, the CI, or the remote and `gh` / `glab`.

- **CI integration.** A GitHub Action (`action.yml`: review, post, SARIF upload, report artifact) and a
  GitLab CI template (`ci/gitlab/code-reviewer.gitlab-ci.yml`); setup in `docs/ci.md`.

- **SARIF and GitLab Code Quality reports.** New `sarif` (`report.sarif`, for GitHub code scanning) and
  `codequality` (`report.codequality.json`) formats for `--format` / `output.formats` / `runs export`.

- **Stable finding fingerprints** (file, category, rule and normalised code, not line numbers) key SARIF
  results, Code Quality issues and pull request comments across runs.

- **Review changes before you commit.** `review --staged` reviews exactly what `git commit` would record,
  `review --uncommitted` every local change including untracked files; both compare against HEAD unless
  `--base` is given. The changes become a throw-away commit on top of HEAD, so index, working tree and
  refs are left alone and the review runs as for any commit. `code-reviewer hook install` adds a
  pre-commit hook (`--fail-on major` by default; findings block the commit, a review that cannot run does
  not). It never replaces a hook it did not write, and prints the command for husky / lefthook setups.

- **OpenAI-compatible providers.** A new provider type `openai` talks to any chat completions API with
  tool calling, through the same tool loop as the Anthropic and Bedrock providers. Built in: `openai`
  (`OPENAI_API_KEY`), `openrouter` (`OPENROUTER_API_KEY`) and `ollama` (a local server, no key, so the code
  never leaves the machine); vLLM, LM Studio, LiteLLM or Azure OpenAI take a `baseUrl` and `apiKeyEnv` in the
  global config. They have no default model (`--model`), `providers models` lists the server's `GET /models`,
  and `reasoning_effort` is sent only with `reasoningEffort: true`. A project config may not set `baseUrl` or
  `apiKeyEnv`: they decide where the code and which secret are sent.

- **Anthropic API provider** (`anthropic`, `ANTHROPIC_API_KEY`, `claude-sonnet-5` by default): no agent in
  between, so a task carries only our prompt — Claude Code reads ~25× more context per task. Meant for CI
  billed per token.

- **Result cache.** A second review of the same code costs nothing: model answers are reused per chunk
  (and the critic's verdicts per finding) while the code, instructions, skills, hints, model and every
  file the model read are unchanged; after a fix only the changed chunks go to the model. Chunks that had
  to be split start with their halves next time. Early (salvaged) answers are never cached and `eval`
  never uses the cache. Entries live in the platform cache directory (or `CODE_REVIEWER_CACHE_DIR`,
  global `cache.dir`), are signed with a per-user key (`~/.code-reviewer/cache.key` or
  `CODE_REVIEWER_CACHE_KEY`) so a planted entry is ignored, and are pruned daily (`cache.maxAgeDays`,
  `cache.maxSizeMb`). New `--no-cache` flag and `code-reviewer cache info | prune | clear`; runs and
  reports show hits and tokens saved.

- **Cost.** Runs record tokens, model requests and cost of every attempt, failed ones included. The cost
  comes from the provider (ACP `usage_update`, e.g. Claude Code) or from the new `pricing` config (per
  million tokens or per request); otherwise it is shown as unknown with the routes that need a price.
  Missing token counts (e.g. Copilot) are estimated and marked. `--dry-run` shows a prompt-token estimate
  and its cost. Transient errors back off exponentially with jitter.

- **Quality evals.** `code-reviewer eval` reviews cases with known defects and reports recall, precision,
  false positives on clean changes, the effect of self-critique (recall lost, noise removed), tokens and
  time, per case and in total. Cases are YAML files (inline base/head files, or two commits of a real
  repository); a built-in corpus of 17 cases covers JavaScript/TypeScript, React, Python, Go, Java, SQL,
  shell and Docker, 4 of them clean. `--repeat` measures LLM variance, `--compare` shows deltas against
  a previous result, and `--min-recall` / `--min-precision` make it a CI gate. See
  [docs/evals.md](docs/evals.md).

- **Hard eval cases** (`--filter hard`): 16 cases where a weak review fails — defects visible only in an
  unchanged file, a 1,100-line rename with one wrong call, subtle logic (keyset pagination, int overflow,
  retry double charges), tempting-but-clean code, and two real bugs from `click` and `werkzeug` replayed
  from their repositories. Case `also` ranges may point into another file (the caller that crashes), and
  `--filter` takes `!` exclusions (`hard,!real` runs offline).

- **Focused review passes (`--passes local,contracts`, `review.passes`).** Each chunk can be reviewed twice:
  once for defects in the changed lines, once for the declarations the change touches and their consumers
  (with the related unchanged code and a checklist of the changed declarations). Other reviewers found that
  splitting the work by concern, not by file, is what lifts cross-file recall. Off by default until measured.

- **Related unchanged code (`--expand refs|deep`, `review.expand`).** Each chunk can get excerpts of the
  unchanged code that uses the changed declarations and of the definitions the new code calls (`deep`: also
  the callers of those usages), so the reviewer sees how the change is used without searching for it. Found
  with one `git grep` per chunk at the head commit; names used all over the code base, files that do not
  refer to the changed module and C `static` functions are left out. Off by default.

- **"Worth a look" findings.** At `--full`, kept findings below confidence 0.6 (`review.advisoryConfidence`)
  and `info` findings are listed apart: in the terminal summary and the Markdown, HTML and JSON reports
  (`advisory`), but not posted to pull requests, exported to SARIF / Code Quality or counted by `--fail-on`;
  the PR summary says how many there are. On the eval corpus, three of the four remarks the new critic let
  through on clean changes land there.

### Review quality

- **Full depth reviews for recall.** At `--full` the reviewer goes through every changed hunk and reports
  each plausible defect (partly confirmed ones with a lower confidence), leaving precision to the critic
  and the confidence threshold. On a 10-PR subset of AACR-Bench (`evals/aacr`) precision went 30% → 45% and
  recall 5.5% → 9.1%; essential depth is unchanged.

- **Full-depth self-critique keeps what it cannot refute.** At `--full`, the critic rejects a finding only
  when the code refutes its claim; a correct finding with small, unlikely or edge-case impact is confirmed at
  a lower severity instead, and findings are kept from confidence 0.5 (was 0.7). On AACR-Bench ctx30 the old
  critic and threshold had dropped 16 of the 26 findings that matched expert-verified references (21 of 32
  with focused passes). Essential depth is unchanged.

- **Full depth keeps what the critic did not reject from confidence 0.3 (was 0.5).** Findings below 0.6 were
  already listed only as "worth a look", so the main list, PR comments and gates are unchanged. On AACR-Bench
  ctx30 the findings the critic confirmed or found uncertain at 0.3–0.5 matched expert-verified references about as often
  as the kept ones (33%). Keeping them raised F1 from 11.1% to 12.4% (single pass) and from 12.5% to 14.5%
  (focused passes), at about the same precision (41% → 40%).

- **Findings are submitted as they are verified.** `submit_findings` calls add up and no longer tell the
  model it is done, so a review cut off by its time limit keeps what it found; the extra turn after a
  timeout asks for the findings not submitted yet. The direct API loop continues after a submission until
  the model answers without a tool call; critiques still end at their first submission.

- **Opus checks the findings by default.** Providers can name a `critiqueModel` for the self-critique pass
  (`claude`: `opus`, `anthropic`: `claude-opus-5-5`), used when the critique role names no model; `--model`
  now sets the review model only. In the eval corpus, Sonnet + Opus critique kept every defect and dropped
  the weak findings Sonnet's critique let through (precision 95% → 100%) for ~17% more.

- **Sonnet by default.** Claude reviews with Sonnet at medium reasoning unless a model is configured
  (`--model opus` for a deeper, costlier pass); medium matched high on the eval corpus, hard cases included,
  with half the output tokens. The review's context window comes from the model
  catalog (Sonnet 5 and Opus 5.5: 1M tokens) instead of a fixed 200k.

- **An empty review is still an answer.** Prompts insist on `submit_findings` with an empty list when nothing
  is found; an ACP agent that ends its turn without handing anything in gets one short reminder turn, and
  the reply of a part that still fails is kept in the run's chunk artifacts.

- **Prompt caching for direct APIs.** The tool loop's growing prompt is cached (Anthropic: request-level
  `cache_control`; Bedrock: cache points for Anthropic models). Cache writes are now recorded (also from ACP
  agents) and priced (`pricing.<model>.cacheWrite`, default 1.25× input); summaries, reports and `eval`
  show them.

### Robustness and fixes

- **Recovery instead of failed chunks.** A model that runs out of time, tool steps or output is asked for
  the findings it already has (one short extra turn; on Bedrock the last step offers only
  `submit_findings`). A chunk that still fails is split in two and reviewed again (up to four parts); a
  timed-out single file gets one retry with twice the time, a stalled agent a fresh one. Critique batches
  are halved the same way. Bedrock runs that used every step are now reported as a step limit.

- **Failure reasons.** Failed chunks record why (`timeout`, `stalled`, `step-limit`, `output-limit`,
  `context-limit`, `no-output`, …); the summary and reports say what to change, and recoveries are listed.

- **Token safety.** `GITHUB_TOKEN` / `GH_TOKEN` / `GITLAB_TOKEN` are only sent to github.com / gitlab.com,
  the API URL the CI declares, or an API URL from the global config (`publish.githubApiUrl`,
  `publish.gitlabApiUrl`) or `--api-url`; project configs may not set these URLs.

- A review started from a git hook no longer passes the hook's `GIT_INDEX_FILE` on to its own git
  commands, which could have written the snapshot worktree's index into the commit being made.

- **Debugging.** Every run keeps `run.log` (every message, debug included, and the main events) and each
  chunk's prompt in its artifacts. `-v` now prints the version; debug output is `--verbose` only.

- Claude Code gets our MCP tools up front (`ENABLE_TOOL_SEARCH=false`) instead of behind its ToolSearch,
  which Sonnet sometimes skipped and then ended without handing in its review.

- `providers models` (and other commands that stop agents) no longer exit with code 13 while an orphaned
  agent process group is being terminated.

- `eval` counts prompt-cache reads in its token totals (Claude Code serves most input from the cache).
## 0.1.1 — 2026-09-28

- **npm.** Published as `@antonio112009/code-reviewer`; install with
  `npm install -g @antonio112009/code-reviewer`.
- **Releases.** A version tag runs GitHub Actions, which:
  - publishes the GitHub release with an attested `code-reviewer.tgz`;
  - stages the npm version through Trusted Publishing. It goes live after the maintainer's 2FA
    approval.
- **Agent skill `release`.** Claude Code, Codex and GitHub Copilot can follow the release procedure
  from `.claude/skills/` and `.agents/skills/`.

## 0.1.0 — first preview

Released under the [MIT License](LICENSE). Requires Node.js 24 or newer.
Install with `npm install -g @antonio112009/code-reviewer`.

- **Review targets.** Branch diffs are reviewed like a pull request: `merge-base(base, head)..head`, with
  the base picked from CI, an open PR/MR, branch rules or the remote default. Whole files and folders can
  be reviewed too.
- **Providers.**
  - Claude Code, Codex, Copilot and Gemini through the Agent Client Protocol;
  - AWS Bedrock through the Converse API;
  - a model per stage, with reasoning effort;
  - fallback to an alternative when a model is unavailable.
- **Pipeline.** Smart chunking of related files, read-only tools for the model, a strict JSON findings
  contract, validation, dedupe, self-critique, a confidence threshold, and author attribution with
  GitHub/GitLab links.
- **Two review depths.** `essential` (default) covers serious production issues only and uses fewer
  tokens; `full` covers every real defect.
- **Skills.** 851 skills in a tree by language and technology, with detection per folder, version gates
  and essential/full tiers. Custom global and project skills are supported.
- **Static pre-pass.**
  - secret scanning and 128 bug-pattern rules;
  - safe external linters (gitleaks, shellcheck, hadolint, ruff, cppcheck);
  - opt-in project linters.

  Their hits are confirmed or rejected by the model.
- **Terminal and reports.** A live dashboard and a summary at the end. Runs are saved and can be exported
  as Markdown, JSON or HTML. `code-reviewer init` sets up a project.
- **Safety.** Agents work on an isolated, sanitized snapshot. Nothing from the reviewed repository is
  executed: programs never come from the checkout, and project config, globs and regexes are bounded.
  Ctrl+C terminates every process tree.
