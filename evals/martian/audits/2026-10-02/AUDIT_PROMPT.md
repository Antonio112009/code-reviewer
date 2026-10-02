You are auditing code-review findings produced by an LLM code reviewer on real open-source pull requests.
Nobody has verified these findings. Decide, by reading the actual code, whether each finding is a real defect or
noise. This is read-only research: do not modify any repository, and write nothing but the result file.

Input: items.json (one of three parts) — a JSON array. Each item has: n (id), repo (local git clone), base (the fork point of the pull
request) and head (commit shas), file, lines [start, end] (in the head version), title, description, failurePath
(the reviewer's claimed path to failure, may be empty), suggestion. Items are grouped by pull request.

Read code WITHOUT changing the clones (they are shared with running jobs: NEVER checkout, switch, reset, clean,
stash, fetch or pull, and never write inside a clone):
- file at head: `git -C <repo> show <head>:<file>` (pipe through `nl -ba | sed -n 'A,Bp'`);
- the pull request's own change: `git -C <repo> diff <base> <head> -- <file>`;
- other files: `git -C <repo> grep -n <pattern> <head> -- <path>`.
Never trust the working tree of a clone; always go through the shas. If a commit is missing locally, classify
from the description only and add "unverified": true.

Verdict, exactly one per finding:
- "real": a concrete defect introduced or exposed by this change that would plausibly cause wrong behaviour, a
  crash, a leak, a security issue or a real performance problem; you can see the failure path in the code.
- "real-minor": correct but low impact (edge case, unlikely input, cosmetic misbehaviour) — still a defect.
- "debatable": depends on intent or unstated assumptions ("could be null if a caller…", design choices,
  defensive checks the code arguably does not need).
- "wrong": the claim is false when you read the code (handled elsewhere, the API does not behave like that,
  lines misread).
- "not-a-defect": style, naming, docs, tests, or a remark with no failure.

Also give: "preexisting" (true if the problem exists in the base version and the change did not introduce or
expose it); "severity" — the severity YOU would assign: "critical" | "major" | "minor" | "info" (true
observation, no realistic failure) | "none" (should not be reported); "same_as" — the n of an EARLIER item in
this file that states the same underlying concern, else null.

Be skeptical and concrete: verify the API semantics you rely on, check callers and callees when the claim
depends on them, judge each finding by its headline claim.

Write a JSON array to verdicts.json with objects {"n", "verdict", "preexisting", "severity", "same_as", "reason"}
("reason": one or two sentences citing the code), one object per input item. Then reply with the counts per
verdict and the two or three most instructive wrong or debatable findings.
