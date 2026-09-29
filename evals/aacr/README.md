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
| `subsets/*.txt` | named subsets (one PR URL per line) for `run.sh --subset` |
| `report.py` | recall by context level (Diff / File / Repo) and category, averaged over repeated runs |

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
evals/aacr/run.sh base-1 --subset ctx30 --concurrency 4   # a named subset (evals/aacr/subsets/ctx30.txt)
evals/aacr/report.py ctx30 base-1 base-2             # recall by context level and category, averaged
```

- `$AACR_DIR` (default `~/.cache/code-reviewer-aacr`) holds the harness, its results and the cloned
  repositories (partial clones, fetched once and shared by all runs).
- The benchmark measures whatever `dist/cli.js` contains. To pin a version while you keep editing, build a
  copy (`git archive <sha> | tar -x -C /tmp/cr && cd /tmp/cr && npm ci && npm run build`) and set
  `CODE_REVIEWER_CLI=/tmp/cr/dist/cli.js`.
- Results: `$AACR_DIR/aacr-bench/evaluation/results/<dataset>/<reviewer>/<run-id>/`. Each PR has a result
  file with the full `report.json`, and `runs/<instance>/` keeps the run directory (prompts, replies,
  `run.log`). Metrics are in the mirrored `metrics/` directory, and the console prints a summary.

## Subsets

- `pilot` (`--pilot`): 10 random PRs (seed 42). Cheap, but a change moving a few matches cannot be told
  from run-to-run noise on it.
- `ctx30` (`--subset ctx30`): 30 PRs from 22 repositories and 9 languages, picked at random (seed 20260928,
  at most two per repository) among the available PRs with ≤ 800 changed lines and at least three File- or
  Repo-level references. 286 references: 134 Diff, 107 File and 45 Repo level. Meant for changes to context
  and cross-file checking; run each variant at least twice.

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
| 2026-09-28 | full-depth recall | `--full --reasoning high --critique-model sonnet`, Sonnet judge | pilot, 9 of 10 | 45.5% (5/11) | 9.1% (5/55) | 15.2% | 1.2 | $1.23, 5.7 min |
| 2026-09-28 | full-depth recall | same, `--max-chunk-tokens 15000` | pilot, 9 of 10 | 57.1% (4/7) | 7.3% (4/55) | 12.9% | 0.8 | $1.35 |
| 2026-09-28 | full-depth recall + expand | same, `--expand refs` | pilot, 9 of 10 | 20.0% (2/10) | 3.6% (2/55) | 6.1% | 1.1 | $1.21, 4.4 min |

### ctx30 (30 PRs, 286 references), two runs per variant

Run with `--full` and main's defaults (Sonnet at medium reasoning, Opus critique); Sonnet judge; mean of two
runs (each run in brackets). "Worth a look" findings count, since they are in the report.

| Variant | Commit | Findings | Precision | Recall | Diff / File / Repo recall | F1 | Cost / run |
|---|---|---|---|---|---|---|---|
| Baseline (critique drops unlikely defects, threshold 0.7) | `888a513` | 18.5 | 59.4% | 3.8% (10, 12) | 2.6 / 5.1 / 4.4% | 7.3% (6.6, 7.9) | $20 |
| Focused passes, same critique | `888a513` | 22 | 52.5% | 4.0% (11, 12) | 3.0 / 5.1 / 4.4% | 7.5% (7.1, 7.8) | $35 |
| Critique keeps what it cannot refute, threshold 0.5 | `16c8343` | 40 | 45.5% | 6.3% (17, 19) | 4.1 / 8.4 / 7.8% | 11.1% (10.3, 11.8) | $20 |
| Same, plus focused passes | `16c8343` | 59 | 36.9% | 7.5% (21, 22) | 5.6 / 9.3 / 8.9% | 12.5% (12.4, 12.5) | $34 |

- Before the critique change, the reviewer had found 60 candidates in the first baseline run (90 with focused
  passes). The critique and threshold dropped 16 of the 26 that matched references (21 of 32 with passes),
  as "theoretical", "unreachable with current callers" or "same gap elsewhere".
- The new critique lets more robustness remarks through. On the eval corpus it flagged 4 of 8 clean changes.
  With the "worth a look" list (below confidence 0.6 or `info`, kept out of PR comments and gates), that is
  back to 1 of 8, at 96% precision.
- Focused passes add about 1.4 points of F1 for about 70% more cost, and the gain is within the spread of
  two runs, so they stay opt-in.

#### What the new critique still drops

Across the four refute-to-drop runs above, 26 of the 115 dropped findings matched references:
- **Below the 0.5 threshold, not rejected:** 16 of 48 matched (33%), about as often as the kept findings. The
  critic often rated a finding it confirmed at 0.35–0.45 to say "unlikely", although it is asked to rate
  correctness.
- **Rejected by the critic:** 13 of 67 matched (19%). These were mostly correct but harmless claims: a dead
  null check, a missing `try/catch` with no observable effect, a design choice.

Keeping the first group from confidence 0.3 (the full preset since then; below 0.6 it is only "worth a look")
raised F1 at about the same precision (41% → 40% on average):

| ctx30 | Threshold 0.5 | Threshold 0.3 |
|---|---|---|
| Single pass (two runs) | 11.1% (10.3, 11.8) | 12.4% (13.1, 11.6) |
| Focused passes (two runs) | 12.5% (12.4, 12.5) | 14.5% (14.0, 14.9) |

The eval corpus is unaffected: it scores the main list, which still starts at 0.6.

#### Tried and not adopted: review rounds (as in OpenCodeReview)

OpenCodeReview reviews each group at least twice by default: a later round starts over with the confirmed
findings listed (at most 30, 300 characters each) and stops when a round adds nothing new. We tried the same
per chunk on top of the refute-to-drop critique:
- a second round got the first round's findings;
- rounds stopped on a round whose findings all repeated earlier locations (±3 lines);
- a failed later round kept the earlier findings.

| ctx30, two runs each | Findings | Precision | Recall | F1 | Cost / run |
|---|---|---|---|---|---|
| One round | 40 | 45.5% | 6.3% (17, 19) | 11.1% (10.3, 11.8) | $20 |
| Two rounds | 50 | 34.0% | 5.9% (17, 17) | 10.1% (10.1, 10.1) | $30 |

- The second round ran on about 25 of 30 chunks and added about 11 raw findings per run. None of them
  matched a reference.
- On the eval corpus it kept recall at 100% but lowered precision from 96% to 87%. It flagged 2 of 8 clean
  changes and tripled the duplicates, for 45% more cost.

It was not merged. The exhaustive full-depth prompt, findings submitted as they are verified and the
refute-to-drop critique already recover what the rounds recover in OpenCodeReview: coverage lost when a
model cuts corners on a large group.

#### Skills on vs off (after the tool fixes and the Claude Code isolation)

Skills add ~3.8k tokens of checklists to every full-depth chunk, and their effect had never been measured.
Both variants ran the same build (main at 4100cc8: `grep`/`find_symbol` fixes, per-file skill matching, Claude
Code sessions without user settings), `--full`, two runs each, the variants side by side.

| ctx30, two runs each | Findings | Precision | Recall | F1 | Cost / run |
|---|---|---|---|---|---|
| Skills (default) | 50 | 40.0% | 7.0% (18, 22) | 11.9% (10.9, 12.9) | $14.3 |
| `--skills none` | 44.5 | 46.0% | 7.2% (22, 19) | 12.4% (13.3, 11.6) | $13.0 |
| Earlier baseline (threshold 0.3, before these changes) | 46 | 44.7% | 7.2% (22, 19) | 12.3% (13.1, 11.6) | $19.8 |

- **No measurable effect on recall or F1.** The runs of each variant overlap. With skills, the reviewer
  reports a few more findings at lower precision, for ~9% more cost.
- **Skills make runs more consistent:** 15 references matched in both runs with skills, 10 without. Over two
  runs, the variants matched 25 and 31 references, 20 of them in common.
- **Some matches came from a skill:** the immich service worker's `cache.addAll` rejecting the whole install
  (`web/service-worker/caching`) and a null check after use (dbeaver) were matched with skills only. Only one
  reference was matched in both runs without skills and never with them (FreeCAD).
- **The isolation paid off on its own:** $19.8 → $14.3 per run at the same F1. Claude Code sessions no longer
  load the user's settings and get three built-in tools.

AACR-Bench is a weak test of skills. 42% of its references are maintainability and readability comments that
no checklist targets, and two runs of 30 PRs cannot resolve a difference this small.

The eval corpus (`code-reviewer eval --full`, 33 cases: 16 hard, 2 from real repositories, 8 clean; one run per
variant, main at 23c6948) is where skills are aimed:

| Eval corpus | Recall | Precision | F1 | False positives on clean changes | Duplicates | Cost |
|---|---|---|---|---|---|---|
| Skills (default) | 100% (27/27) | 96% | 98% | 0 of 8 | 4 | $6.95 |
| `--skills none` | 100% (27/27) | 93% | 96% | 1 of 8 | 8 | $6.11 |
| 0.4.0 (impact map, failure paths; 2026-09-29) | 100% (27/27) | 96% | 98% | 0 of 8 | 4 | $7.19 |

- **Recall is saturated** either way: every planted defect was found.
- **Without skills the review is noisier.** It flagged one clean change (an unvalidated `order` parameter in
  `go/invoice-list-sorting`), doubled the duplicates, and rated a CSV injection `minor` instead of `major`.
- **Skills cost ~14% more** on the corpus (~9% on AACR).

Skills stay on. The difference is one false positive and a few duplicates in one run each, so it is not a
strong effect either way. They pay for themselves in precision and severity, not in recall.

For reference, the published leaderboard (unnamed judge, 1,505 references) has OpenCodeReview with Opus 4.6 at
33.9% precision, 20.0% recall and 25.1% F1 (about 4.5 comments per PR), and Claude Code with Opus 4.6 at 7.2%,
28.9% and 11.6% (about 30 comments per PR).

In the pilot, precision was on par with the leaderboard's best, and line-level precision was 50%. The 7
unmatched findings read as real bugs that the references do not contain. Recall is the gap:
- The reviewer reported about one finding per PR.
- Self-critique dropped only 2 of 12 findings.
- Even Code Defect references were found 3 times out of 36.

Full-depth recall mode (the reviewer reports every plausible defect, submits findings as it verifies them,
and leaves precision to the critic) raised the reviewer's candidates from 12 to 20; the critique removed 9,
and 5 of the 11 kept findings matched references. With 3–5 matches either way, the pilot is too small to
call the gain final.

The pilot is too small to measure changes of this size. Smaller chunks changed the split of only three
PRs, and `--expand refs` added related code to four. Yet the other PRs, reviewed with the same prompt as
before, moved by up to three matches between runs. Measure such changes by running each variant several
times, or on a larger subset of the PRs they actually affect.

A full run would cost about $190 and take about 4 hours at concurrency 3.
