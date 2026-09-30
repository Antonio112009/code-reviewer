# Martian Code Review Bench, offline

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
evals/martian/run.sh m-1 --concurrency 3       # review the 50 PRs, judge, score
evals/martian/run.sh m-2 --concurrency 3 -- --full --deepen
evals/martian/run.sh m-1 --stage judge --tier all   # re-judge with "worth a look" and notes as candidates
evals/martian/judge.py --baseline claude-code  # a published tool's candidates under the same judge
evals/martian/report.py m-1 m-2 baseline-claude-code
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

The judge prompt is the benchmark's own, read from the pinned checkout and answered by `claude -p` (Sonnet by
default; `--judge-model`). Every golden comment is compared with every candidate of the PR, text against
text — no file, line or diff. A golden comment is matched by the candidate the judge is most confident about;
a candidate counts as matched when it is that best match for some golden comment; the rest are false
positives. Precision = TP / (TP + FP), recall = TP / (TP + FN), micro-averaged over the PRs. Profiles restrict
TP and FN to categories (strict, core, all); false positives always count.

Two deliberate differences from the published pipeline:

- **Candidates are our findings** — title and description, one per finding (`--tier main`: the main list;
  `--tier all`: also "worth a look" and maintainability notes). The published pipeline sends every comment
  body through an LLM that extracts and de-duplicates issues; our findings are already one defect each.
- **The judge is `claude -p`**, not the Opus 4.5 / Sonnet 4.5 / GPT-5.2 snapshots of the leaderboard, and the
  same tool output moves by up to 9.5 F1 points between those judges. Numbers here are therefore not
  comparable with the published table directly: compare with `--baseline <tool>`, which judges a published
  tool's checked-in candidates (with their de-duplication groups) under our judge.

Published rows for orientation (core profile, Opus 4.5 judge, P / R / F1): Qodo Extended 67.1 / 64.6 / 65.8,
Cubic 61.5 / 65.8 / 63.6, Augment 59.5 / 65.2 / 62.2, Bugbot 56.9 / 46.8 / 51.4, Greptile v4 50.9 / 51.3 /
51.1, Copilot 38.5 / 66.5 / 48.7, Claude Code 46.3 / 48.1 / 47.2, CodeRabbit 32.6 / 59.5 / 42.2.

## Caveats

- The golden set is incomplete and unversioned (it grew from 137 to 173 comments in August 2026; every result
  records its SHA-256). Real findings outside it count as false positives, so precision is understated.
- Severity is not scored; 46 of the 173 comments are Low. One golden comment is about 0.7 recall points, so
  single-run differences of a few points are noise: run each variant at least twice.
- Contamination: famous repositories, public golden comments, and about 2,500 public forks with other tools'
  reviews of exactly these PRs. Four PRs end in a synthetic commit written for the benchmark; two of them
  share it.
- The published tools reviewed a GitHub PR with its title and body; our CLI sees the diff and the checkout.
