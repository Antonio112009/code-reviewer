# AACR-Bench

[AACR-Bench](https://github.com/alibaba/aacr-bench) is Alibaba's public code review benchmark: 196 real pull
requests (the paper counts 200) from 50 open-source repositories in 10 languages, with 1,505 expert-verified
review comments. It is
the benchmark behind OpenCodeReview's published leaderboard, so it lets us compare code-reviewer with OCR,
Claude Code and Codex on the same data.

This folder plugs code-reviewer into the benchmark's own harness (`evaluation/`); nothing here ships in the
package, and `code-reviewer eval` ignores it (it only reads `*.yaml` cases).

| File | What it is |
|---|---|
| `setup.sh` | clones the harness at a pinned commit into `$AACR_DIR`, applies the patch, installs the adapter, creates the Python environment and converts the dataset |
| `run.sh` | runs a reviewer on all PRs or the pilot subset and scores it |
| `code_reviewer.py` | the reviewer adapter (installed as `evaluation/reviewers/code_reviewer.py`) |
| `harness.patch` | changes to the harness (below) |

## Running

Requires [uv](https://docs.astral.sh/uv/), a built `dist/` and a logged-in provider (Claude Code by default).

```bash
npm run build
evals/aacr/setup.sh                                  # once; re-run after changing the patch or the adapter
evals/aacr/run.sh pilot-1 --pilot --concurrency 3    # the 10-PR pilot subset (seed 42)
evals/aacr/run.sh full-1 --concurrency 3             # every PR
evals/aacr/run.sh full-1 --stage eval                # re-score a finished run (e.g. with another judge)
evals/aacr/run.sh opus-1 --pilot -- --full --model opus   # code-reviewer arguments after --
evals/aacr/run.sh cc-1 --pilot --reviewer claude     # baseline: Claude Code's /code-review, same judge
```

- `$AACR_DIR` (default `~/.cache/code-reviewer-aacr`) holds the harness, its results and the cloned
  repositories (partial clones, fetched once and shared by all runs).
- The benchmark measures whatever `dist/cli.js` contains. To pin a version while you keep editing, build a
  copy (`git archive <sha> | tar -x -C /tmp/cr && cd /tmp/cr && npm ci && npm run build`) and set
  `CODE_REVIEWER_CLI=/tmp/cr/dist/cli.js`.
- Results: `$AACR_DIR/aacr-bench/evaluation/results/<dataset>/<reviewer>/<run-id>/`. Each PR has a result
  file with the full `report.json`, and `runs/<instance>/` keeps the run directory (prompts, replies,
  `run.log`). Metrics are in the mirrored `metrics/` directory, and the console prints a summary.

## How it is scored

For each reference comment the harness looks for a generated comment on the same file and side, whose
lines overlap it or are within 1 line, and then asks a judge model whether the two "express the same
concern or suggestion". Our comment text is the finding's title, failure scenario and suggestion.

- **Semantic precision** = matched findings / all findings; **recall** = matched references / all references;
  F1 of the two. The line-only variants skip the judge.
- **The judge.** Without `JUDGE_API_KEY`, `claude -p --model sonnet` answers the harness's judge prompt
  (`JUDGE_CLAUDE_MODEL` changes the model). With `JUDGE_BASE_URL`, `JUDGE_API_KEY` and `JUDGE_MODEL`, the
  harness's own OpenAI-compatible judge is used. The leaderboard does not name its judge, so compare with it
  only roughly; for a fair comparison run the baselines with the same judge.
- **Missing PRs.** 11 PRs (87 references) cannot be reviewed any more: their head commits were deleted from
  GitHub (ComfyUI #7952, #9560; node #56185; uv #11088; ClickHouse #85266, #74070; keycloak #41672, #37465,
  #35645, #36457, #37504). The harness reports them as missing and leaves them out of every metric, so a
  full run covers 185 PRs and 1,419 references.
- **What the benchmark rewards.** 42% of the references are maintainability/readability comments, which our
  prompts deliberately do not ask for. Precision counts real bugs that the annotators did not write down as
  noise.

## What the patch changes

- `reviewers/code_reviewer.py` is registered as `--reviewer code-reviewer`, and `evaluate.py` reads its
  findings and token usage.
- `judge.py`: the `claude-cli` judge backend (concurrent `claude -p` calls, retries, cost and error counts in
  the summary). `evaluate.py` scores PRs concurrently; matching inside one PR stays sequential, as upstream.
- `repo_utils.py`: partial clones (`--filter=blob:none`). Several repositories are multi-GB.
- `reviewers/claude.py`: `CLAUDE_USE_SUBSCRIPTION=true` runs the Claude Code baseline on the logged-in
  account instead of an API gateway token.

## Results

| Date | code-reviewer | Setup | PRs | Precision | Recall | F1 | Findings / PR | Cost / PR |
|---|---|---|---|---|---|---|---|---|
| 2026-09-28 | `df35dd3` | `--full`, Sonnet review and critique, Sonnet judge | pilot, 9 of 10 | 30.0% (3/10) | 5.5% (3/55) | 9.3% | 1.1 | $1.03, 3.8 min |

For reference, the published leaderboard (unnamed judge, 1,505 references) has OpenCodeReview with Opus 4.6 at
33.9% precision, 20.0% recall and 25.1% F1 (about 4.5 comments per PR), and Claude Code with Opus 4.6 at 7.2%,
28.9% and 11.6% (about 30 comments per PR).

In the pilot, precision was on par with the leaderboard's best, and line-level precision was 50%. The 7
unmatched findings read as real bugs that the references do not contain. Recall is the gap:
- The reviewer reported about one finding per PR.
- Self-critique dropped only 2 of 12 findings.
- Even Code Defect references were found 3 times out of 36.

A full run would cost about $190 and take about 4 hours at concurrency 3.
