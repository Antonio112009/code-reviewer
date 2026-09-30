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
| `recritique.mts` | re-runs only the self-critique on the findings of a finished run: compares critic prompts on the same findings for about $1.5 |

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
- `hold82` (`--subset hold82`): the 82 other PRs of ctx30's 22 repositories whose head commits still exist
  (670 references, 44% maintainability, 74% written by the benchmark's LLM annotators). Nothing was tuned on
  it: use it as the held-out half, ctx30 as the development half, and decide on both (see below). Needs no
  new clones; the harness fetches the commits on first use.

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

## Comparing variants

```bash
evals/aacr/stats.py ctx30 i7-1,i7-2 maint-1,maint-2 --by-source   # B against A, paired, with intervals
evals/aacr/run.sh i7-1 --subset ctx30 --stage eval --eval-rounds 3   # judge the same findings three times
evals/aacr/apply_verdicts.py ctx30 raw-1 verdicts.json raw-1c      # a critic's verdicts as a new run to judge
```

- **Noise.** The same configuration moves by about ±1.2 F1 points between runs on ctx30 (one matched
  reference is 0.6 points); the judge adds only 0.3–0.5 points (five judgings of the same findings: 21, 21,
  21, 21, 20 and 26, 25, 27, 25, 26 matches). Two runs per variant on 30 PRs resolve differences of 4–5 F1
  points; all the critic changes of 0.7.0 together are +1.2 F1 with a 95% interval of −1.7..+4.1.
- **Decide with `stats.py`:** it averages a variant's runs per PR, pairs the PRs, clusters on repositories
  (Miller 2024) and reports the recall difference with a t interval and the F1 difference with a bootstrap
  over repositories. Screen on ctx30 (two runs), confirm on `hold82` (one run each, ≈ $30), and treat a change
  as real when both point the same way with P(B > A) ≥ 0.95.
- **Critic-only experiments** cost a fifth of a run: `recritique.mts` re-verifies a finished run's findings
  with the current critic, `apply_verdicts.py` turns its verdicts into a run that `--stage eval` judges.
- `report.py` also splits recall by the reference's source (`source:human`, `source:AI`) and averages the
  judgings when a run was judged with `--eval-rounds`.

## Blind audit

The references miss most real defects and contain remarks that are wrong about the code (see below), so the
benchmark's precision says little about a report. A blind audit reads the code instead:

```bash
evals/aacr/audit.py sample ctx30 raw-1 audit/raw-1 --parts 3     # inputs without severity, confidence or tier
evals/aacr/audit.py summarize audit/raw-1                         # after result<k>.json are written
```

Each part comes with `AUDIT_PROMPT<k>.md`: an auditor (an agent, or a person) labels every finding `real`,
`real-minor`, `debatable`, `wrong` or `not-a-defect` by reading the clone with `git show` at the head sha,
and gives the severity it would assign. `summarize` joins the labels with the hidden fields: real share by
reviewer severity and confidence, by tier, by benchmark match, and the reviewer's severity against the
auditor's. Audit about 100 findings per release; two agents given the same 66 items agreed on "the claim
holds / does not hold" in 97% of cases (κ 0.94).

## What the patch changes

- `reviewers/code_reviewer.py` is registered as `--reviewer code-reviewer`, and `evaluate.py` reads its
  findings and token usage.
- `judge.py`: the `claude-cli` judge backend (concurrent `claude -p` calls, retries, cost and error counts in
  the summary; one semaphore per event loop, so `--eval-rounds` works). `evaluate.py` scores PRs
  concurrently; matching inside one PR stays sequential, as upstream.
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

#### 0.4.0 and the function audit (2026-09-29)

| ctx30, two runs each | Findings | Precision | Recall | F1 | Cost / run |
|---|---|---|---|---|---|
| 0.4.0 (impact map, `find_references`, call chunks, failure paths) | 50 | 41.0% | 7.2% (20, 21) | 12.2% (12.0, 12.4) | $15.2 |
| 0.4.0 + `--audit` | 43 | 47.4% | 7.2% (17, 24) | 12.5% (10.4, 14.5) | $14.8 |

- **More context did not raise recall.** 0.4.0 matches the skills baseline above (11.9%) within noise; runs
  are more consistent.
- **Where the 135 code-defect references go** (0.4.0, both runs, a finding within ±5 lines counts as nearby):
  20 found, 5 dropped by us (critique or unconfirmed hints), 32 with a finding nearby that the judge counted as
  another issue, 78 with nothing nearby. The critique is not the bottleneck.
  - Nearby but different: some are judge misses (the same NameError, the same copied error message at another
    line); mostly the reviewer reports one defect where the reference names several (opencv JNI: 4, found 1).
  - Nothing nearby (read by hand): about 30 speculative robustness remarks ("could be nil if a caller…"),
    about 8 style or design, several references that are wrong for this PR (ComfyUI: bugs the PR fixes;
    timescale: `ts_update_placeholder` is the project's required convention), and about 35 concrete misses,
    e.g. a flag not reset on an error path (SDL) or `"false"` enabling an opt-in header (LocalAI).
- **`--audit`** (list every changed function, audit each one): the model recorded 125 of 145 listed
  functions, yet reported fewer findings; recall stayed at 7.2% and the two runs spread by four points. It
  stays experimental and off.

#### Sonnet 5.5 as the review model (2026-09-29)

Same pinned 0.4.0 build, only the review model changed (Opus 5.5 critique; Claude Code 2.1.284 maps `sonnet`
to Sonnet 5.5; both cost $2 / $10 per MTok):

| | AACR ctx30 F1 (two runs) | Precision | Recall | Cost / run | Review time | Output tokens |
|---|---|---|---|---|---|---|
| Sonnet 5 | 12.2% (12.0, 12.4) | 41.0% | 7.2% | $15.2 | 68 min | ~314k |
| Sonnet 5.5 | 12.2% (12.0, 12.4) | 40.8% | 7.2% | $10.0 | 26 min | ~127k |

| Eval corpus | Recall | Precision | Clean false positives | "Duplicates" | Cost |
|---|---|---|---|---|---|
| Sonnet 5 (one run) | 27/27 | 96% | 0 of 8 | 4 | $7.19 |
| Sonnet 5.5 (two runs) | 27/27, 26/27 | 84%, 90% | 1 of 8 both times (`go/invoice-list-sorting`) | 8, 7 | $5.70, $4.98 |

- Same quality on AACR for a third less cost, in less than half the time.
- The eval corpus's lower precision comes mostly from "duplicates" that are other defects next to the planted
  one, several of them real: a random idempotency key per retry (double charge), a TTL passed in
  milliseconds to a seconds-based cache, N+1 queries in the CSV export. The corpus counts any extra finding
  near a labelled defect as a duplicate. The consistent clean false positive ("invalid order value silently
  treated as descending") is a robustness remark on a change labelled clean.

#### Second look, one defect per finding, a Sonnet critic (2026-09-30)

Pinned builds of main after 0.5.2 (4e302bf) and of the branch with `--deepen` and the one-defect rule; Sonnet
5.5 reviews in every variant:

| ctx30, two runs each | Findings | Precision | Recall | F1 | Code-defect recall | Cost / run |
|---|---|---|---|---|---|---|
| main (Opus 5.5 critique) | 48 | 39.7% | 6.6% (17, 21) | 11.4% (10.1, 12.6) | 9.6% | $9.6 |
| `--critique-model sonnet` | 54.5 | 36.7% | 7.0% (20, 20) | 11.7% (11.7, 11.8) | 11.5% | $6.8 |
| one defect per finding | 52.5 | 39.1% | 7.2% (20, 21) | 12.1% (11.8, 12.4) | 11.5% | $9.6 |
| `--deepen` (+ one defect per finding) | 70.5 | 34.3% | 8.4% (23, 25) | 13.5% (13.2, 13.7) | 13.7% | $14.7 |
| `--deepen --critique-model sonnet` | 77 | 37.2% | 10.0% (29, 28) | 15.7% (15.7, 15.7) | 14.1% | $11.5 |

| Eval corpus, one run each | Recall | Precision | Clean false positives | Cost |
|---|---|---|---|---|
| main (Opus critique) | 27/27 | 96% | 1 of 8 | $5.20 |
| `--critique-model sonnet` | 27/27 | 100% | 0 of 8 | $3.77 |
| `--deepen --critique-model sonnet` | 27/27 | 87% | 1 of 8 | $6.19 |

- **Findings combined several defects.** Sonnet 5.5 joined defects in 13-14% of findings, on wide spans
  (median 5-7 lines, 43% over 10): "Pending Java exception ignored; size truncated; buffer copied regardless
  of result" (opencv, lines 16-34) covered two references and matched neither. Dedupe was not the cause (one
  merge in four earlier runs). Asking for one defect per finding cut the share to 9% and moved F1 within noise.
- **`--deepen` is the first change that raised recall:** both runs (23, 25 references) above both baseline
  runs (17, 21), code defects 9.6% → 13.7%. It reviews every chunk with findings twice (24 second looks in a
  run), so it costs about 50% more and adds findings the critic keeps at lower precision; on the eval corpus
  the extras were a missing lockfile and `go.sum` entries (the synthetic cases have none) and one clean
  change flagged. It stays experimental and off.
- **`--deepen` with a Sonnet critic is the best variant measured:** F1 15.7% in both runs, recall 10.0%, at
  the precision of a single look (37.2%) and 70% above the Sonnet-critic default ($11.5). The Opus critic
  dropped more of the second look's findings. The Sonnet critic became the default (below).
- **A Sonnet critic cost 30% less at the same F1** on AACR, and on the eval corpus it kept every planted defect
  and flagged no clean change (one run). The critic rejecting a real multi-defect JNI finding ("GetMethodID
  cannot realistically fail") is the same strictness with either model.
- **Skill attribution** (who led to a finding) is still sparse: 22% of kept findings name a checklist; the
  JNI checklist led to 4 in opencv, the always-on general checklist was named by none.

#### What the unmatched findings are (2026-09-30)

Benchmark precision counts a finding as noise when no reference matches it, but the references are
incomplete. Three audits read the code behind the 35 findings of `csn-1` (the Sonnet-critic default) that
matched no reference: 7 real, 13 real but minor, 8 debatable, 4 not defects (test hygiene, leftover logging,
lines the change did not touch), 3 wrong (a HANA row limit the reviewer did not know, a panic already
recovered one layer down, a schema column it could not see). With the 20 matched ones, 40 of the 55 kept
findings are real: about 73% rather than the 36% the benchmark reports; 84% among the main findings and 57%
among "worth a look". The benchmark missed, for example, a fail-open login CSRF (cline), an SQL argument the
C code never reads (timescaledb) and `mcp remove` no longer removing the server (gemini-cli).

The critic was then re-run on the same 55 findings (`evals/aacr/recritique.mts`, two runs per variant):

| Critic | Real kept (of 40) | Noise kept (of 15) | Real share | Titles corrected |
|---|---|---|---|---|
| 0.6.0 | 39, 40 | 13, 14 | 74-75% | — |
| + headline / callee / pre-existing rules | 36, 38 | 10, 11 | 78% | — |
| + corrected titles, external claims ≤ 0.4 | 35, 37 | 10, 10 | 78-79% | 10, 12 |

The main report (confidence ≥ 0.6) after a second opinion, two runs per variant:

| Critic | Real in the main report | Noise in the main report | Real share |
|---|---|---|---|
| reworked critic + second opinion | 27, 26 | 6, 5 | 82-84% |
| + callee definitions under each excerpt | 29, 29 | 3, 5 | 85-91% |

With the definitions of the called functions listed under each excerpt, all three wrong findings left the main report in both runs:
the critic read `handler.ServeHTTP` and refuted the lost panic recovery (the finding keeps its true part, a
missing header, as "worth a look"), and both HANA claims became `uncertain` at 0.35-0.4 ("my recollection
does not count as verification"). Real findings rejected: 7 and 3, against 5 and 3 before.

Before that, the three wrong findings survived most runs: two rest on HANA facts the repository does not
show (the last variant of the first table lowers them to "worth a look" in one run of two), one on a panic
recovered inside `handler.ServeHTTP` that the critic never opened. The real findings lost are a formally undefined `reinterpret_cast` the project
uses in twenty places and two the critic judged pre-existing.

#### The reworked critic end to end, and a second opinion (2026-09-30)

Pinned build of the branch with the critic of the section above, the reviewer rule against test hygiene and
harmless leftover logging, and `--second-opinion` (borderline findings, confidence 0.5-0.75 at full depth, go
to a second verifier that reads further and decides):

| ctx30, two runs each | Findings | Precision | Recall | F1 | Code-defect recall | Cost / run |
|---|---|---|---|---|---|---|
| 0.6.0 (Sonnet critic) | 54.5 | 36.7% | 7.0% (20, 20) | 11.7% (11.7, 11.8) | 11.5% | $6.8 |
| reworked critic + reviewer rule | 48.5 | 40.2% | 6.8% (20, 19) | 11.7% (11.9, 11.4) | 10.0% | $6.9 |
| + `--second-opinion` | 47.5 | 46.3% | 7.7% (21, 23) | 13.2% (12.6, 13.8) | 12.2% | $7.6 |

- **The reworked critic reports fewer findings at the same recall:** six fewer per run, precision 36.7% →
  40.2%, 5-7 titles corrected per run, findings in test files 4 → 2, same cost.
- **A second opinion is better in both runs on every measure** (precision 43.8% and 48.9% against 40.8% and
  39.6%; 21 and 23 matched references against 20 and 19) for 10% more cost. It looked at 16-18 findings per
  run: 11-13 stayed in or moved into the main report, 2-5 went to "worth a look", 1-2 were rejected.
- On the audited findings (re-critique with `--first`, two runs) the second verifier rejected nothing and
  raised the main report from 25+7 and 24+4 (real + noise) to 27+6 and 26+5: what it adds is reading further,
  not refuting. The panic recovered behind `handler.ServeHTTP` (gofr) survives it too.
- Eval corpus with a second opinion (34 cases, one run): 28/28 found, precision 97% (one unlabelled finding
  about a cache error failing a permission check), 0 of 8 clean changes flagged, 9 second opinions, $4.64
  against $4.15. It is on by default at full depth since then; essential depth was not measured.
- A third pair (`c2-2`, `c2so-2`) is void: half its reviews failed on a network outage ("SSL certificate
  hostname mismatch", agent start timeouts). Check the run statuses before trusting a run with few findings.

#### Callee definitions and the critic's third outcome, end to end (2026-09-30)

Full ctx30 runs of the default mode (full depth, second opinion), two each:

| Build | Findings | Precision | Recall | F1 | Main / worth a look | Cost / run |
|---|---|---|---|---|---|---|
| before callee definitions (`c2so`) | 47.5 | 46.3% | 7.7% (21, 23) | 13.2% (12.6, 13.8) | 33 / 14.5 | $7.6 |
| + callee definitions (`m7`) | 49 | 37.0% | 6.3% (16, 20) | 10.8% (9.5, 12.0) | 34 / 15 | $8.4 |
| + third outcome (`i7`) | 54.5 | 40.6% | 7.7% (21, 23) | 12.9% (12.5, 13.3) | 26.5 / 28 | $7.5 |

- **Callee definitions alone lowered the benchmark.** The audited set had shown the main report getting
  cleaner, but with the definitions in hand the critic rejected more findings that are true about the code
  and have no realistic failure: a null check placed after the use, a missing spawn error handler, a parse
  failure that is logged rather than thrown. Human reviewers had noted the same things. Five of the nine
  references lost against `c2so` were lost this way. The rules of the critic rework ("hardening advice
  without a failure path is not a defect") contradicted the full-depth promise not to drop a correct claim.
- **The third outcome restores recall.** At full depth such a finding is confirmed as `info` with a
  confidence of at most 0.5 and listed as "worth a look"; only a claim that is wrong about the code is
  rejected. On the audited set no real finding was rejected in either run (7 and 3 before) and the main
  report was 90-93% real; on ctx30 the matched references are back at 21 and 23.
- **What changed is where findings land.** The main report is smaller (26.5 findings a run against 33) and
  "worth a look" larger (28 against 14.5). Of the findings that match a reference, 28 of 46 are in the main
  report (36 of 44 before); 53% of main findings match a reference (55% before) and 32% of "worth a look"
  (28% before). Benchmark precision counts both sections, which is why it is lower than `c2so`.

#### The three modes (2026-09-30)

Pinned build of main with the second opinion on by default at full depth (6bd6eca), two runs each:

| ctx30 | Findings | Precision | Recall | F1 | Code-defect recall | Cost / run |
|---|---|---|---|---|---|---|
| `--essential` | 9.5 | 62.8% (55.6, 70.0) | 2.1% (5, 7) | 4.1% | 4.4% | $5.1 |
| `--essential --second-opinion` | 9.5 | 63.3% (60.0, 66.7) | 2.1% (6, 6) | 4.1% | 4.4% | $5.9 |
| `--full` (second opinion on) | 47.5 | 46.3% | 7.7% (21, 23) | 13.2% | 12.2% | $7.6 |
| `--full --deepen` | 70.5 | 38.3% (38.0, 38.6) | 9.4% (27, 27) | 15.1% (15.1, 15.2) | 13.7% | $13.1 |

- **Essential depth was never measured before.** It reports nine or ten findings on 30 PRs, all `major`; all
  nine of one run are also in a full run of the same PRs. It costs a third less than `--full` and finds a
  quarter of the references: the review's cost is reading the code, not reporting.
- **A second opinion does nothing at essential depth** (two findings a run in its range, same numbers, 15%
  more cost): it stays off there.
- **`--full --deepen` is the most stable result measured** (F1 15.1% and 15.2%, 27 references both times) and
  the highest recall, at 72% more cost than `--full` and eight points less precision. Against the same mode
  before the critic rework (F1 15.7%, recall 10.0%, $11.5) it is unchanged within noise and 14% dearer: the
  second opinion looks at 25-27 findings a run here. One review of 30 failed in each run (agent start
  timeout; in the second the laptop had slept), so both are slightly low.
- Cost per matched reference: `--essential` $0.85, `--full` $0.35, `--full --deepen` $0.49.

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

#### The reporting scope, the held-out subset and blind audits (2026-09-30 / 10-01)

What limits the AACR number is what we choose to report, not how well we find defects. Pinned build of
0.7.0 (eb5c564) unless noted; the audits are blind (six agents, no severity, confidence, tier or match shown).

**The references.** Of ctx30's 286 references, 226 were written by the benchmark's six LLM annotators and 60
by people (`is_ai_comment`); 111 are maintainability remarks. 53 references were matched at least once in 26
full-depth runs. Two agents classified the other 233 (agreement on "the claim holds" 97%, κ 0.94):
maintainability 93, unproven robustness remarks 54 (36 of them refuted by the code), wrong or about unchanged
code 47, behaviour questions 14, performance 10, design 10, **concrete defects 5**. A defect-focused reviewer
could report 5 of them, and 39 more only as low-confidence notes. Benchmark matches are a weak proxy for real
defects: 69% of matched findings are real against 57% of unmatched ones.

**The reviewer's own scores are well calibrated** (159 findings of two no-critic runs, 61% real overall):

| Reviewer score | Findings | Real |
|---|---|---|
| `major` | 53 | 92% |
| `minor` | 104 | 45% |
| confidence ≥ 0.75 | 25 | 100% |
| 0.60–0.75 | 34 | 85% |
| 0.45–0.60 | 39 | 77% |
| < 0.45 | 61 | 21% |

Within one report a real finding ranks above a not-real one in 88–91% of pairs (severity, then confidence).

**The critic on the same findings** (two critic runs each): main report 26 → 33 findings and 88% → 97% real
(medium reasoning), 33 → 38–41 and 94% → 95–97% (high); 6–9 findings removed per run, at most one of them
real. On the benchmark it is neutral (same findings: 26 → 24 matches; three of the removed had matched a
reference, one of them wrong by the audit). In "worth a look", `minor` is real in 37–50% of cases and `info`
in 15–25%: sort `minor` first. The critic lowers `major` to `minor` 8–12 times a run and is wrong in 2–5.

**Variants without the critic** (single runs):

| ctx30 | Findings | Precision | Recall | F1 | Cost |
|---|---|---|---|---|---|
| Sonnet, medium reasoning | 71 | 36.6% | 9.1% | 14.6% | $5.25 |
| Sonnet, `--reasoning high` | 88 | 33.0% | 10.1% | 15.5% | $6.77 |
| `--max-chunk-tokens 3000` (per-file chunks) | 104 | 28.8% | 10.5% | 15.4% | $11.71 |
| `--model haiku` | 55 | 30.9% | 5.9% | 10.0% | $7.43 |
| medium + high merged (production dedupe) | 117 | 31.6% | 12.9% | 18.4% | $12.0 |
| wider scope (robustness remarks + maintainability notes), medium | 119 | 37.0% | 15.4% | 21.7% | $4.77 |
| wider scope, high | 193 | 28.0% | 18.9% | 22.5% | $6.69 |

- Haiku makes eleven tool calls and takes 164 s per PR: worse and dearer. Per-file chunks buy what high
  reasoning buys at twice the price. The three variants together matched only four references no earlier run
  had; the wider scope matched 21 new ones in two runs (ever matched: 53 → 83).
- On the audit, high reasoning finds 52 real concerns against 43 (+21% for +29% reviewer cost); the union of
  both runs 56. A concern found by both runs is real in 76% of cases, by one run in 31%.
- Wider scope, audited (119 findings): confident defect findings 71% real; the low-confidence robustness net
  20% real and 55% debatable (its matches are mostly debatable references); maintainability notes 60% useful,
  29% nits, 9% wrong, and in half of the cases a maintainer would ask for the change (several were made
  upstream). Through the critic, 17 of 35 notes remain, 15 of them useful.

**Maintainability notes with the full pipeline** (notes bypass the critic, capped by nothing yet):

| | PRs | Findings | Precision | Recall | F1 | Cost / run |
|---|---|---|---|---|---|---|
| 0.7.0, ctx30 (two runs) | 30 | 54.5 | 40.4% | 7.7% | 12.9% | $7.5 |
| + notes, ctx30 (two runs) | 30 | 82.5 | 37.0% | 10.7% | 16.6% | $8.1 |
| 0.7.0, hold82 | 82 | 145 | 29.7% | 6.4% | 10.6% | $30.75 |
| + notes, hold82 | 82 | 205 | 27.3% | 8.4% | 12.8% | $31.27 |

Paired: hold82 recall +1.9 points (95% CI +0.5..+3.4), F1 +2.2 (−0.1..+4.2), P(B > A) 0.97; ctx30 recall
+3.0 (−0.1..+6.0), F1 +3.6, P 0.97. Defect recall is unchanged (11.7% → 12.4% on hold82); maintainability
recall 1.7% → 5.1%. ctx30 flatters every configuration: the same build scores 12.9 there and 10.6 held out.
The human-vs-AI recall gap seen on ctx30 (1.7% vs 9.3%) does not hold on hold82 (7.8% vs 6.0%).

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
