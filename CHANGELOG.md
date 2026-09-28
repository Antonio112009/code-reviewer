# Changelog

## Unreleased

- **Sonnet by default.** Claude reviews and critiques with Sonnet at high reasoning unless a model is
  configured (`--model opus` for a deeper, costlier pass). The review's context window comes from the model
  catalog (Sonnet 5 and Opus 5.5: 1M tokens) instead of a fixed 200k.
- **An empty review is still an answer.** Prompts insist on `submit_findings` with an empty list when nothing
  is found; an ACP agent that ends its turn without handing anything in gets one short reminder turn, and
  the reply of a part that still fails is kept in the run's chunk artifacts.
- `providers models` (and other commands that stop agents) no longer exit with code 13 while an orphaned
  agent process group is being terminated.
- `eval` counts prompt-cache reads in its token totals (Claude Code serves most input from the cache).
- **Debugging.** Every run keeps `run.log` (every message, debug included, and the main events) and each
  chunk's prompt in its artifacts. `-v` now prints the version; debug output is `--verbose` only.
- Claude Code gets our MCP tools up front (`ENABLE_TOOL_SEARCH=false`) instead of behind its ToolSearch,
  which Sonnet sometimes skipped and then ended without handing in its review.

- **Result cache.** A second review of the same code costs nothing: model answers are reused per chunk
  (and the critic's verdicts per finding) while the code, instructions, skills, hints, model and every
  file the model read are unchanged; after a fix only the changed chunks go to the model. Chunks that had
  to be split start with their halves next time. Early (salvaged) answers are never cached and `eval`
  never uses the cache. Entries live in the platform cache directory (or `CODE_REVIEWER_CACHE_DIR`,
  global `cache.dir`), are signed with a per-user key (`~/.code-reviewer/cache.key` or
  `CODE_REVIEWER_CACHE_KEY`) so a planted entry is ignored, and are pruned daily (`cache.maxAgeDays`,
  `cache.maxSizeMb`). New `--no-cache` flag and `code-reviewer cache info | prune | clear`; runs and
  reports show hits and tokens saved.

- **Recovery instead of failed chunks.** A model that runs out of time, tool steps or output is asked for
  the findings it already has (one short extra turn; on Bedrock the last step offers only
  `submit_findings`). A chunk that still fails is split in two and reviewed again (up to four parts); a
  timed-out single file gets one retry with twice the time, a stalled agent a fresh one. Critique batches
  are halved the same way. Bedrock runs that used every step are now reported as a step limit.
- **Failure reasons.** Failed chunks record why (`timeout`, `stalled`, `step-limit`, `output-limit`,
  `context-limit`, `no-output`, …); the summary and reports say what to change, and recoveries are listed.
- **Cost.** Runs record tokens, model requests and cost of every attempt, failed ones included. The cost
  comes from the provider (ACP `usage_update`, e.g. Claude Code) or from the new `pricing` config (per
  million tokens or per request); otherwise it is shown as unknown with the routes that need a price.
  Missing token counts (e.g. Copilot) are estimated and marked. `--dry-run` shows a prompt-token estimate
  and its cost. Transient errors back off exponentially with jitter.
- **Pull request comments.** `code-reviewer review --post` and `code-reviewer runs publish [id]` post a
  review to its GitHub pull request or GitLab merge request: inline comments on findings inside the diff
  (capped by `publish.maxInlineComments`, filtered by `publish.minSeverity`) and one summary comment that
  later runs update in place. Findings already commented on are not repeated, nothing goes inline when the
  pull request moved since the review (unless `--force`), and `--dry-run` shows what would be posted. The
  target comes from `--pr` / `--repo` / `--forge` / `--api-url`, the CI, or the remote and `gh` / `glab`.
- **Token safety.** `GITHUB_TOKEN` / `GH_TOKEN` / `GITLAB_TOKEN` are only sent to github.com / gitlab.com,
  the API URL the CI declares, or an API URL from the global config (`publish.githubApiUrl`,
  `publish.gitlabApiUrl`) or `--api-url`; project configs may not set these URLs.
- **SARIF and GitLab Code Quality reports.** New `sarif` (`report.sarif`, for GitHub code scanning) and
  `codequality` (`report.codequality.json`) formats for `--format` / `output.formats` / `runs export`.
- **Stable finding fingerprints** (file, category, rule and normalised code, not line numbers) key SARIF
  results, Code Quality issues and pull request comments across runs.
- **CI integration.** A GitHub Action (`action.yml`: review, post, SARIF upload, report artifact) and a
  GitLab CI template (`ci/gitlab/code-reviewer.gitlab-ci.yml`); setup in `docs/ci.md`.
- **Quality evals.** `code-reviewer eval` reviews cases with known defects and reports recall, precision,
  false positives on clean changes, the effect of self-critique (recall lost, noise removed), tokens and
  time, per case and in total. Cases are YAML files (inline base/head files, or two commits of a real
  repository); a built-in corpus of 17 cases covers JavaScript/TypeScript, React, Python, Go, Java, SQL,
  shell and Docker, 4 of them clean. `--repeat` measures LLM variance, `--compare` shows deltas against
  a previous result, and `--min-recall` / `--min-precision` make it a CI gate. See
  [docs/evals.md](docs/evals.md).

## 0.1.0 — first preview

Released under the [MIT License](LICENSE). Requires Node.js 24 or newer.

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
