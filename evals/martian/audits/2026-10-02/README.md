# Blind audit of unmatched Martian findings, 2026-10-02

53 findings of run `ws2-1` (code-reviewer 0.8.0 + `--sweep`, build `d330ae1`) that the Martian judge matched to
no golden comment: 20 of the main report, 20 of "worth a look" from the chunk reviews and all 13 of "worth a
look" from the sweep. Three model auditors (Claude subagents) each read a third with the instructions in
`AUDIT_PROMPT.md`, through the pull request's commits in the benchmark's clones (`repo` names one of the
clones `evals/martian/setup.sh` makes), without seeing tier, confidence, severity or benchmark match.

- `items.json`: what the auditors saw.
- `hidden.json`: the fields they did not see (tier, origin, severity, confidence).
- `verdicts.json`: their labels and reasons.
