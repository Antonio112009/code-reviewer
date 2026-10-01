# Martian judgings, 2026-10-01

The judge's verdicts behind every Martian number in [BENCHMARKS.md](../../../../BENCHMARKS.md), so each row can be
checked. All were judged by `claude-opus-4-5-20251101` through `claude -p`, without extended thinking, with the
benchmark's own prompt and system message, against the golden comments of
[withmartian/code-review-benchmark](https://github.com/withmartian/code-review-benchmark) at commit
[`e616e849`](https://github.com/withmartian/code-review-benchmark/tree/e616e849755441da38f18bf3adba2c9583b03803).

| File | What was judged | How it was made |
|---|---|---|
| `code-reviewer-0.7.0-run1-main.json`, `-run2-main.json` | code-reviewer 0.7.0, main report | build `eb5c564`, `evals/martian/run.sh m-1` / `m-2` (`--full`), `judge.py --tier main` |
| `code-reviewer-0.7.0-run1-all.json`, `-run2-all.json` | the same runs, main report + "worth a look" | `judge.py --tier all` |
| `plain-model-run1.json`, `-run2.json` | the same model given the diff in one call | `evals/plain-llm.py martian p-1` / `p-2` |
| `qodo-extended.json` | Qodo Extended, #1 on the leaderboard | `judge.py --baseline qodo-extended-v2` |
| `augment.json` | Augment, #3 | `judge.py --baseline augment` |
| `claude-code-cli.json` | Claude Code CLI, #12 | `judge.py --baseline claude-code` |
| `code-reviewer-sweep-run1-main.json`, `-run2-main.json`, `-run1-all.json`, `-run2-all.json` | `main` with `--sweep`, main report / + "worth a look" | build `d330ae1`, `run.sh ws2-1` / `ws2-2` (`--full --no-notes --sweep`) |
| `code-reviewer-sweep-v1-*.json` | the first version of the sweep (replaced) | build `c2bad4a`, `run.sh ws-1` / `ws-2` |
| `code-reviewer-main-defaults-run1-*.json`, `-run2-*.json` | `main` with its defaults (notes on); `all` includes the notes | build `84d96f3`, `run.sh mn-1` / `mn-2` (`--full`) |
| `code-reviewer-sweep-high-*.json` | experiment: the sweep at high reasoning (not merged) | build `84d96f3` + `evals/experiments/sweep-high.patch`, `run.sh wh-1` / `wh-2` |
| `opus-5-5/` | the same rows judged by `claude-opus-5-5` (no extended thinking), as a second judge | `judge.py ... --judge-model claude-opus-5-5 --no-thinking` |

The published tools' candidates are the review comments each tool posted, as Martian extracted and checked
them in (`offline/results/anthropic_claude-opus-4-5-20251101/candidates.json`); their published scores are in
[`offline/analysis/benchmark_dashboard.json`](https://github.com/withmartian/code-review-benchmark/blob/e616e849755441da38f18bf3adba2c9583b03803/offline/analysis/benchmark_dashboard.json)
and on [codereview.withmartian.com](https://codereview.withmartian.com).

Each file has the judge's settings under `meta` and, per pull request, the golden comments matched (with the
matching candidate, the judge's confidence and its reasoning), the ones missed, and the candidates that matched
nothing. Score one or several with

```bash
evals/martian/report.py evals/martian/judgings/2026-10-01/*.json
```
