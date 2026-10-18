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

`sevkeep-r12-1.json` and `sevkeep-r12-2.json` are one more critic run each over the same findings, with
`evals/experiments/critic-sevkeep.patch` applied and `CR_EXP=sevkeep`. The patch tells the critic to keep the
reported severity unless code shows a smaller failure, and to keep a confidence of at least 0.7 for a traced finding
rated major or critical. They were made with `recritique.mts r12-N sevkeep-r12-N.json --votes 1` for $5.62, in the
same format; `exp` records the switch. The posted report did not improve; see the critic note in BENCHMARKS.md's
measurement log.
