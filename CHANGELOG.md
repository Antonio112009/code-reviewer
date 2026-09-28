# Changelog

## Unreleased

- **Fixed findings resolve their threads.** When a push changes the code an earlier inline comment was on
  and the new review does not report that finding again, the comment's thread on the GitHub pull request or
  GitLab merge request gets a short reply and is resolved. A model can miss a finding it reported before, so
  nothing is resolved unless the commented lines changed, the file was reviewed in full and no new finding
  sits where the code went. A thread someone reopens stays open; `publish.resolveFixed: false` turns it off.

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
