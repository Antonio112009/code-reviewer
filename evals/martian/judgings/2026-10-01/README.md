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
