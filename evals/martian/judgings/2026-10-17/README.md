# Martian judgings, 2026-10-17

The judge's verdicts behind the 0.12.0 rows in [BENCHMARKS.md](../../../../BENCHMARKS.md). Judged by
`claude-opus-4-5-20251101` through the **Anthropic Messages API** (`judge.py --backend api`, the default since
#100), without extended thinking, with the benchmark's own prompt and system message, against the golden
comments of [withmartian/code-review-benchmark](https://github.com/withmartian/code-review-benchmark) at commit
[`e616e849`](https://github.com/withmartian/code-review-benchmark/tree/e616e849755441da38f18bf3adba2c9583b03803).

The reviews ran on the **Anthropic API** (`--provider anthropic`, reviewer and critic `claude-sonnet-5-5`), build
`v0.12.0` (`f7a6586`) pinned with `evals/pin-build.sh v0.12.0`. Each run's `provenance-<run>.json` records the
build and arguments.

| File | What was judged | How it was made |
|---|---|---|
| `code-reviewer-0.12.0-api-run1-main.json`, `-run2-main.json` | 0.12.0 defaults, main report (what is posted) | `run.sh r12-1` / `r12-2 -- --full --provider anthropic`, `judge.py --tier main` |
| `code-reviewer-0.12.0-api-run1-all.json`, `-run2-all.json` | the same runs, full report (+ "worth a look" and notes) | `judge.py --tier all` |
| `code-reviewer-0.12.0-api-deepen-*.json` | `--deepen`, one run | `run.sh r12-deep -- --full --deepen --provider anthropic` |
| `code-reviewer-0.12.0-api-essential-*.json` | `--essential`, one run | `run.sh r12-ess -- --essential --provider anthropic` |
| `augment-api-judge.json`, `qodo-extended-api-judge.json` | calibration: Augment and Qodo Extended re-judged through the API with an empty verdict cache | `MARTIAN_JUDGE_CACHE=<empty dir> judge.py --baseline augment` / `qodo-extended-v2 --backend api` |
| `breakdown.json` | recall by category, severity and repository for every row of the comparison | `evals/martian/breakdown.py --json` |

**Calibration.** The verdict cache key holds the judge model, its settings and the texts, not the backend, so
the published tools' verdicts from 2026-10-01 (through `claude -p`) are reused for the API. Re-judging two of
them from scratch through the API: Augment F1 60.6 → 60.1 (104 of 105 matched golden comments the same),
Qodo Extended 60.5 → 61.7 (96 of 97). The two backends agree within the run-to-run noise.

Score one or several with

```bash
evals/martian/report.py evals/martian/judgings/2026-10-17/*.json
evals/martian/breakdown.py "0.12.0=evals/martian/judgings/2026-10-17/code-reviewer-0.12.0-api-run1-all.json,evals/martian/judgings/2026-10-17/code-reviewer-0.12.0-api-run2-all.json"
```
