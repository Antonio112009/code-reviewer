# Martian judgings, 2026-10-18

Why `--essential` found 8% of Martian's bugs, and the change that doubles it. Judged as in
[2026-10-17](../2026-10-17/README.md): `claude-opus-4-5-20251101` through the Anthropic Messages API, without
extended thinking, benchmark commit `e616e849`. Reviews on the Anthropic API (`--essential --provider anthropic`,
reviewer and critic `claude-sonnet-5-5`), each build pinned with `evals/pin-build.sh`; `provenance-<run>.json`
records it.

| File | Build | What changed against v0.12.0 |
|---|---|---|
| `code-reviewer-ess-v1-essential-all.json` | `1d52c65` | the essential scope names logic errors that break a feature on its normal path (reviewer and critic); the reviewer is no longer told an empty list is a good outcome |
| `code-reviewer-ess-v2-essential-all.json` | `2e79d77` | the essential reviewer gets the full depth's recall rules (go through every hunk, report plausible defects at 0.3–0.6, the verifier filters) |
| `code-reviewer-ess-v2-regated-minor-all.json` | — | ess-v2's own reviews and verdicts, with the 7 critic-confirmed `minor` findings the major floor dropped put back (a simulation of the floor at `minor`) |
| `code-reviewer-ess-v3-essential-all.json` | `a5584fa` | ess-v2 + essential `minSeverity: minor` (the critic's impact rule is the gate); the reviewer no longer hears that minor is not reported |

| Core profile (158 golden comments) | Findings (50 PRs) | Precision | Recall | F1 | Critical + High | Review cost |
|---|---|---|---|---|---|---|
| v0.12.0 (`r12-ess`) | 15 | 86.7% | 8.2% | 15.0% | 8 / 66 | $8.31 |
| ess-v1 | 21 | 85.7% | 11.4% | 20.1% | 11 / 66 | $8.67 |
| ess-v2 | 20 | 91.7% | 13.9% | 24.2% | 15 / 66 | $8.55 |
| ess-v2 re-gated at `minor` | 27 | 94.1% | 20.3% | 33.3% | 20 / 66 | — |
| **ess-v3** | 27 | 93.8% | 19.0% | 31.6% | 18 / 66 | $9.22 |

Paired bootstrap over PRs, ess-v3 − v0.12.0: F1 +16.6 (95% +5.9..+27.6), recall +10.8 (+3.6..+18.5),
precision +7.1 (−6.5..+20.6).

## Where v0.12.0 lost the serious bugs

43 Critical/High golden comments in the core categories were found by a default run (`r12-1` or `r12-2`) and
missed by `r12-ess`. Each was judged against `r12-ess`'s rejected findings with the same judge:

- **Never reported by the essential reviewer: 33.** The default run had 16 of them in its main report from a chunk
  review, 2 only from the sweep (off at essential), and 15 only as "worth a look" (confidence below 0.6), out of
  reach of a 0.7 gate.
- **Reported and dropped: 10.** 3 by the major floor (rated minor, confidence 0.85), 3 below confidence 0.7,
  3 rejected by the critic, 1 static hint not confirmed.
- 28 of the 43 are logic bugs (wrong result, a check that admits the wrong callers, a value from the wrong
  place), which the essential scope did not name.

The essential reviewer reported 37 findings in the 50 PRs, the default reviewer 211–221, with the same tool use
per chunk. Neither the prompt nor the skills explain most of the gap: a run of 10 PRs with the full depth's skill
budget, context share and step limit (10.2 checklists per chunk against 10.4 at full) reported 14 chunk findings
against 15 (ess-v2) and 39–42 (full). Both depths report about as many major and critical findings; full depth's
extra volume is minor ones, and that is where the serious golden bugs are: of the full runs' findings that
matched them, the reviewer rated 27 minor and the full-depth critic lowered 22 from major to minor. At essential
the model leaves out what it rates minor, and the major floor dropped what the essential critic had already
kept as serious.

## Critic votes (`critic-votes/`)

`votes-r12-1.json` and `votes-r12-2.json` are two more independent runs of the critic (claude-sonnet-5-5, high
reasoning, no second opinion, no verdict cache) over every finding of `r12-1` / `r12-2` that its critic kept
below confidence 0.75, put in "worth a look" or rejected. Each finding was first restored to the reviewer's
confidence, severity and title. They were made with `evals/martian/recritique.mts r12-N votes-r12-N.json --votes 2`
for $9.23. Each row holds `pr`, the finding `id`, `vote` (1 or 2), `verdict`, `confidence`, `severity` and the
critic's `reason`. The original run's verdict is the third vote. For what they showed, see the posting-gate note
in BENCHMARKS.md's measurement log: the votes are no better than the single confidence.

## Security sweep (`security-sweep/`), a negative result

The full report found 41% of Martian's security bugs (11 golden comments) and 36% of its data-integrity bugs (7),
against 73% and 79% for the same model given the whole diff in one call. Independent extra passes are what moved
recall before (`--sweep`, `--deepen`), so this tried one more whole-change call asked only for security holes and
broken data, its findings through the same critic: `--security-sweep`, build `005b1fa` = `8c81c55` +
[`evals/experiments/security-sweep.patch`](../../../experiments/security-sweep.patch), one run (`ss-1`,
`--full --security-sweep --provider anthropic`). A security-sweep finding is dropped only at the spot of an
equally or more severe finding, since the chunk review often sees the hole and rates it minor.

**Where the default runs lose these bugs** (`secdata-r12-deep-plain.json`, made with `secdata-classify.py`: every
missed golden comment judged against the run's rejected findings). Of the 18, r12-1 and r12-2 never reported 8 and
10, put 4 and 3 only in "worth a look", lost 1 to the critic and 0–2 below the threshold. The plain model never
reported 4–5. One pull request (discourse-4, the embedding feature) holds 5 of the 11 security comments.

| Core profile (158), full report | Findings / PR | Precision | Recall | F1 | Security | Data | Cost / PR |
|---|---|---|---|---|---|---|---|
| r12-1, r12-2 (v0.12.0, the baseline) | 2.9 | 61.4% | 57.0% | 59.1% | 41% | 36% | $0.36 (r12-2, cold cache) |
| `ss-1` without the 9 findings only the security sweep reported | 3.0 | 58.4% | 57.0% | 57.7% | 36% | 14% | — |
| `ss-1` | 3.2 | 56.4% | 58.2% | 57.3% | 36% | 29% | $0.49 |

- The security sweep reported 133 findings in 50 pull requests: 91 at a spot the chunk reviews or the sweep had
  already reported as severely, 42 new. The critic rejected 21 of those, 8 fell below the threshold, and 9 reached
  the full report (5 minor and 4 info, one of them in the main report). They matched 3 golden comments (one data,
  one API, one concurrency) of which 2 no other finding matched, and 7 matched none: recall +1.3, precision −2.0,
  F1 −0.4 within the run. The main report gained one unmatched finding (precision 78.8 → 77.6%).
- **No security bug was gained.** The pass did report three of the missed security comments (`secdata-ss-1.json`):
  the referer in inline JavaScript and X-Frame-Options ALLOWALL on discourse-4, which the critic rejected (ERB
  HTML-escapes the referer, so a quote cannot close the JavaScript string; ALLOWALL is the embedding's intent),
  and sentry-67876's static OAuth state, which the critic kept at confidence 0.25, below the 0.3 floor. The first
  rejection is arguably right.
- The call costs $0.11 a pull request, a third more than a run with a cold prompt cache (r12-2: $0.36; r12-1's
  $0.18 was served from a warm one).

Recommendation: dropped, not merged. Asking for these categories by name does not close the plain model's lead:
the focused call reported 3 of the security comments the run otherwise missed, and the critic dropped all three,
twice with a refutation from the code. The data row moves by one golden comment either way (14% → 29% within the
run, 36% in the baseline): run-to-run noise at 7 comments. `strip-sec.py` makes the
"without" row from `ss-1`'s reports; its verdicts are all from `ss-1`'s cache.
