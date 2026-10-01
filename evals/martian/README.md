# Martian Code Review Bench, offline

The summary of every benchmark, with charts and history, is [BENCHMARKS.md](../../BENCHMARKS.md); this file is the method and the per-run numbers.

[Martian's code-review benchmark](https://github.com/withmartian/code-review-benchmark) (MIT) scores review
tools against **real bugs**: 50 pull requests from Sentry, Grafana, Cal.com, Discourse and Keycloak with 173
hand-verified "golden comments" — 139 of them in the defect categories (bug, security, concurrency, data,
api), the rest performance, test gaps, documentation, style and speculative remarks. Where AACR-Bench measures
agreement with what human and LLM reviewers wrote (mostly maintainability, see `evals/aacr/README.md`), this
set answers the question we care about most: how many of the known bugs in a change does the review find,
and how much else does it report.

## Running

Requires a built `dist/`, `git`, `python3` and a logged-in Claude Code (`claude -p` is the judge). About
6 GB of clones the first time (blobless), $12–25 of reviews and a few hundred judge calls per run.

```bash
npm run build
evals/martian/setup.sh                         # once: benchmark checkout, five clones, every PR's commits
evals/martian/run.sh m-1 --concurrency 3       # review the 50 PRs, judge with Sonnet, score
evals/martian/run.sh m-2 --concurrency 3 -- --full --deepen
evals/martian/run.sh m-1 --stage judge --tier all   # re-judge with "worth a look" and notes as candidates
evals/martian/judge.py --baseline claude-code  # a published tool's candidates under the same judge
evals/martian/report.py m-1 m-2 baseline-claude-code

# the leaderboard's judge model, for numbers to publish (about $0.012 a judge call)
evals/martian/judge.py m-1 --tier all --judge-model claude-opus-4-5-20251101 --no-thinking
evals/martian/report.py m-1:claude-opus-4-5-20251101-nothink:all
```

- `$MARTIAN_DIR` (default `~/.cache/code-reviewer-martian`) holds the benchmark's `offline/` directory at a
  pinned commit, the clones, the results and the judge cache.
- `prs.json` freezes the 50 pull requests: golden URL, where to fetch from (35 are real upstream PRs, 15 live in
  benchmark mirrors), `base`, `mergeBase` and `head`. Our CLI reviews `merge-base..head`, which is the diff the
  published tools saw; for 9 PRs the benchmark's `base` is past the merge-base.
- Each PR is reviewed in a detached worktree at its head commit with `--offline`, so the reviewer never sees
  the later history that contains the fixes.
- A result file per PR keeps the full report; a PR with a result file is skipped on re-run.

## How it is scored

The judge prompt and its system message are the benchmark's own, read from the pinned checkout and answered
by `claude -p`: Sonnet by default (cheap, for iteration), or `--judge-model claude-opus-4-5-20251101
--no-thinking`, the leaderboard's judge model called as the leaderboard calls it, for the numbers we publish.
Each judging is kept as `results/<run>/eval-<judge>-<tier>.json` (`<judge>` is the model, with `-nothink`
without extended thinking); `report.py <run>:<judge>:<tier>` scores one. Every golden comment is compared
with every candidate of the PR, text against text — no file, line or diff. A golden comment is matched by the candidate the judge is most confident about;
a candidate counts as matched when it is that best match for some golden comment; the rest are false
positives. Precision = TP / (TP + FP), recall = TP / (TP + FN), micro-averaged over the PRs. Profiles restrict
TP and FN to categories (strict, core, all); false positives always count.

Two deliberate differences from the published pipeline:

- **Candidates are our findings** — title and description, one per finding (`--tier main`: the main list;
  `--tier all`: also "worth a look" and maintainability notes). The published pipeline sends every comment
  body through an LLM that extracts and de-duplicates issues; our findings are already one defect each.
- **The judge runs through `claude -p`**, not Martian's gateway (which calls the model at temperature 0;
  `claude -p` cannot), and it is stricter than the published scores: re-judged with Opus 4.5, published
  tools' candidates lose 1.6 to 5.4 F1 points (the calibration in [BENCHMARKS.md](../../BENCHMARKS.md)).
  Extended thinking and the system message do not change that. So compare a run with published tools
  re-judged by `--baseline <tool>` (their checked-in candidates and de-duplication groups under the same
  judge), not with the published table; the same holds for Sonnet, which is stricter still.

Published rows for orientation (core profile, Opus 4.5 judge, P / R / F1): Qodo Extended 67.1 / 64.6 / 65.8,
Cubic 61.5 / 65.8 / 63.6, Augment 59.5 / 65.2 / 62.2, Bugbot 56.9 / 46.8 / 51.4, Greptile v4 50.9 / 51.3 /
51.1, Copilot 38.5 / 66.5 / 48.7, Claude Code 46.3 / 48.1 / 47.2, CodeRabbit 32.6 / 59.5 / 42.2.

## Results

2026-10-01, benchmark commit `e616e849`, 50 PRs, judge `claude-opus-4-5-20251101` through `claude -p` without
extended thinking. code-reviewer 0.7.0 (`eb5c564`, `--full`) and the plain model (`evals/plain-llm.py`) ran
twice each (per-run F1 in brackets); the published tools are their checked-in candidates under the same judge.
One golden comment is 0.6 recall points.

| Core profile (158 golden comments) | Candidates / PR | Precision | Recall | F1 | Cost / PR |
|---|---|---|---|---|---|
| code-reviewer 0.7.0, main report | 1.6 | 73.3% | 37.3% | 49.5% (49.6, 49.4) | $0.40 |
| code-reviewer 0.7.0, main report + "worth a look" | 2.6 | 64.0% | 54.1% | 58.7% (60.0, 57.3) | $0.40 |
| plain model, one call per PR | 5.9 | 39.0% | 71.5% | 50.5% (48.7, 52.4) | $0.08 |
| Qodo Extended (published candidates; 65.8% as published) | 3.0 | 61.4% | 59.5% | 60.5% | — |
| Augment (published candidates; 62.2% as published) | 3.6 | 58.1% | 63.3% | 60.6% | — |
| Claude Code CLI (published candidates; 47.2% as published) | 3.5 | 41.8% | 41.8% | 41.8% | — |

- Strict profile (139 defects): code-reviewer's full report 62.2% / 56.8% / 59.4%, the plain model 37.6% /
  76.6% / 50.5%, Qodo Extended 59.3% / 61.9% / 60.6%, Augment 55.0% / 63.3% / 58.9%.
- Paired bootstrap over PRs, core F1: code-reviewer's full report − the plain model +8.2 (95% interval
  +0.7..+15.4); − Qodo Extended −1.8 (−10.0..+5.9).
- Of the 36 golden comments a plain run matched and neither code-reviewer run did, the reviewer had found 4
  (the critic rejected them) and never reported 32 (judged against the runs' rejected findings with the same
  judge).
- Earlier judgings: Sonnet with an earlier system message, main report 48.7% and with "worth a look" 58.2%;
  Opus 4.5 with extended thinking, Claude Code CLI 42.1% and run m-1 49.2% / 61.0%.

## Caveats

- The golden set is incomplete and unversioned (it grew from 137 to 173 comments in August 2026; every result
  records its SHA-256). Real findings outside it count as false positives, so precision is understated.
- Severity is not scored; 46 of the 173 comments are Low. One golden comment is about 0.7 recall points, so
  single-run differences of a few points are noise: run each variant at least twice.
- Contamination: famous repositories, public golden comments, and about 2,500 public forks with other tools'
  reviews of exactly these PRs. Four PRs end in a synthetic commit written for the benchmark; two of them
  share it.
- The published tools reviewed a GitHub PR with its title and body; our CLI sees the diff and the checkout.
