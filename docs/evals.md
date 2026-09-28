# Evals: measuring review quality

`code-reviewer eval` reviews a corpus of small changes whose defects are known and scores the result:
how many known bugs were found (recall), how much of what was reported is right (precision), how often
a clean change gets flagged, what self-critique gained or lost, and what it cost in tokens and time. Run
it before and after changing a prompt, a skill, a model or the depth, and compare the numbers.

```bash
code-reviewer eval                                   # the built-in corpus, with your configured models
code-reviewer eval --filter python --repeat 3        # only Python cases, three runs each
code-reviewer eval --provider claude --model opus --compare latest
code-reviewer eval my-cases/ --min-recall 0.7 --json > eval.json   # CI gate, machine-readable result
```

## Cases

One case per YAML file. The case id is the file's path relative to the corpus directory, without the
extension (`python/orders-csv-export`). The built-in corpus lives in `evals/` of the package.

```yaml
title: Sort column from the query string interpolated into ORDER BY
tags: [javascript, express, sql, security]
# The files at the base commit, and the files the change writes (null deletes a file).
base:
  src/db.js: |
    const { Pool } = require('pg');
    …
  src/routes/products.js: |
    …
head:
  src/routes/products.js: |
    …
expect:                    # the defects the change introduces; [] = a clean change
  - file: src/routes/products.js
    lines: [20, 27]        # lines of the NEW file: one line (20) or a range
    also: [9]              # optional: other places where reporting this defect also counts:
                           #   lines of this file, or { file: src/app.js, lines: [3, 5] } in another
    severity: major        # optional: the lowest severity a reviewer should give it
    note: req.query.sort is interpolated into ORDER BY unvalidated
```

| Field | |
|---|---|
| `title` | What the case is about. Never shown to the model. |
| `tags` | For `--filter`: language, framework, category (`security`, `concurrency`, …), `clean`, `hard` (see below). |
| `base` / `head` | A self-contained change: the base commit's files, then the files the change writes. |
| `repo` / `baseRef` / `headRef` | …or a real repository and two full commit shas (see below). |
| `expect` | Required. Known defects in the head version; `[]` marks a clean change. |

The runner turns an inline case into a throw-away repository: `base` committed on `main`, the change
committed on `feature/change`, both with a fixed identity and date. Branch names and commit messages are
neutral, and titles, tags and notes never reach the model. File paths must be canonical relative paths
outside `.git/` and `.code-reviewer/`: a case cannot configure its own review.

**Writing a good case.** Keep it small (under ~150 lines) and realistic: code a team would really write,
with one or two defects a senior reviewer would agree are production bugs — security, data loss, races,
leaks, error handling, off-by-one on a main path, N+1 or unbounded work. No comments that hint at the
bug. Point `lines` at the exact defect lines of the head file, and add `also` where a reviewer could
reasonably report the same defect elsewhere: its cause (a missing `set -o pipefail` for a broken
pipeline), or another file (the caller that crashes, the signature whose change a call site missed). Clean cases (a refactor, a rename, test-only changes, a correct fix) measure false positives:
they must be really clean. `test/evals-corpus.test.ts` checks the built-in corpus: required fields,
expected lines inside the head file and inside the changed hunks, no `BUG`/`FIXME` markers, size (at most
160 lines per case file; cases tagged `large` may have up to 1200 and must change at least 300 lines).

### The hard subset

Strong models find every defect of the small cases, so on those cases a model, a reasoning level, a
critique model or a depth cannot be told apart. The cases tagged `hard` are the ones where good and weaker
setups differ; compare configurations on them with `--filter hard`. Every hard case has exactly one
category tag, plus its languages:

| Category | What makes it hard |
|---|---|
| `cross-file` | The change is only wrong given a file it does not touch (in `base`, unchanged in `head`): a helper's unit or contract, a type that is not safe for concurrent use, an authorization check done by a router or middleware. The reviewer has to open that file with its read tools; `expect` points at the misuse in the changed file. |
| `large` | One subtle behavioural bug in a realistic rename or refactor of several hundred changed lines across many files (moved code, updated imports, tests, docs). The noise must be real, not filler. |
| `logic` | Needs reasoning rather than pattern matching: keyset pagination, idempotency across retries, integer overflow, check-then-act races that look atomic. |
| `tempting` | Clean (`expect: []`) code that looks like a classic bug but is correct in context: SQL built from a whitelisted identifier, a read-check-write under `SELECT … FOR UPDATE`, a check-then-create backed by a unique constraint, `\|\|` on `NOT NULL` columns. Any finding is a false positive. |
| `real` | A real bug from a public repository (see below). |

### Real repositories

```yaml
title: Cache invalidation race in the session store
tags: [go, concurrency]
repo: https://github.com/acme/api.git     # or a local path, relative to this file
baseRef: 3f1c…                             # full commit shas: branches move, and the lines with them
headRef: 9a0b…
expect:
  - file: internal/session/store.go
    lines: [120, 131]
```

The repository is cloned once into `~/.code-reviewer/eval-cache/<hash>` (a blob-filtered clone for
URLs; only `https://` URLs and local paths are accepted) and missing commits are fetched on later runs.
The clone has no checked-out working tree: the review reads both commits from git, so the repository's
own `.code-reviewer/` directory (config, project skills) is never on disk to be picked up, and none of
its code, hooks or filters run. Its `CLAUDE.md` / `AGENTS.md` project rules are still read from the base
commit, as in any review.

**Provenance of a real bug.** A case that replays a real bug records where its label comes from, so it can
be checked again: `baseRef` is the parent of the commit that introduced the bug (the first parent when it
came in with a merge), `headRef` that commit, and `expect` the lines of the head version that the later fix
changed. Comments at the top of the case give the URLs of the introducing and of the fixing commit and a
one-line explanation, which the defect's `note` repeats. Tag it `real` (and `hard`). Only use a bug whose
introducing and fixing commits you have both found and read; a wrong label is worse than no case.

```yaml
# Introduced: https://github.com/acme/api/commit/9a0b…
# Fixed:      https://github.com/acme/api/commit/c4d2…
# The fix takes the lock before reading the entry; the introducing commit read it outside the lock.
title: Cache invalidation race in the session store
tags: [go, concurrency, real, hard]
```

The built-in corpus has a few such cases (`--filter real`); they are its only cases that need network
access, to clone the repository on first use. Without it their runs fail with a setup error, so offline,
leave them out with `--filter '!real'` (or `--filter 'hard,!real'`). `test/evals-corpus.test.ts` checks the provenance comments (the `# Introduced:`
commit must be `headRef`) and, with `EVAL_REAL_REPOS=1`, clones the repositories and checks that the
expected lines lie in the change.

## What each run uses

Every case is reviewed with `runReview`, exactly like `code-reviewer review --base main --offline`:
same chunking, skills, static hints, critique and thresholds. The configuration is your effective one
(`~/.code-reviewer/config.yaml`, the project config of the directory you run `eval` in, `--profile`,
flags) with these exceptions:
- `project.*` (name, focus, instructions, ignore) is dropped: it describes your repository, not the cases;
- opt-in project analyzers (`analyzers.project`, `--analyzers`) are off: they execute repository code;
- author attribution is off;
- review runs are saved inside the eval directory, never in the case repository.

The models are checked once before the first case; a fallback chosen then applies to every case.

## Matching findings to expectations

A finding matches an expected defect when it names the same file (paths normalised) and its line range
is within `--tolerance` lines (default 3) of the defect's `lines` or one of its `also` ranges.

- Every expected defect is matched by at most one finding, and every finding matches at most one
  defect: the closest pairs first (smallest gap, then largest overlap, then highest confidence).
- A further finding on an already matched defect is a **duplicate**: neither right nor wrong.
- On a case with expectations, a finding that matches nothing is **unexpected**: possibly a real bug the
  case does not label. Read them; if one is real, add it to `expect`.
- On a clean case (`expect: []`), every finding is a **false positive**.
- A match below the expected `severity` counts as found, and as **underrated**.

**Self-critique effect.** The run record keeps the findings that self-critique or the confidence /
severity thresholds removed (`droppedReason`: `critique`, `below-threshold`, `below-severity`). They are
matched against the defects that were missed: a defect only a removed finding had caught is **lost**
(recall the filters cost), and a removed finding near no expected defect is **saved** (noise they kept
out of the report). Findings dropped by validation (unknown file, out of range, far from the change)
are not counted either way.

## Reading the numbers

| Metric | Meaning |
|---|---|
| recall | found / expected. The share of known bugs the review reported. |
| precision | found / (found + unexpected + false positives): a lower bound, since unexpected findings may be real. |
| F1 | Harmonic mean of recall and precision. |
| raw recall / raw precision | The same without self-critique and thresholds (removed findings put back). |
| clean runs flagged | Runs of clean cases with at least one false positive. |
| failed chunks | Parts of a change the model never reviewed (timeouts, errors); they lower recall. |
| tokens, time | Input/output tokens from each run's usage, wall time per case and for the whole eval. |
| cost | Known cost of the runs (reported by the provider or priced with `pricing`) and the model calls without a known cost. |

Totals are micro-averages: counts are summed over all runs and the ratios computed from the sums. A run
that reviewed nothing (a setup or pipeline error, or every chunk failed) counts its expected defects as
missed, and the command exits with code 2. With `--repeat n` every case is reviewed n times (LLM output varies): counts
are summed over the runs, and the summary shows the recall of each pass over the corpus with its
minimum and maximum. With the mock provider (`--provider mock`) nothing is found in the built-in corpus;
it exercises the pipeline only.

The summary on stderr lists the missed defects (with their notes), the unexpected findings and the false
positives. `--json` prints the whole result on stdout.

## Results and comparisons

Each eval is saved as `.code-reviewer/evals/<eval-id>/result.json` of the current repository (or
`<--out>/<eval-id>/`), with the review runs of its cases in `runs/` next to it: open a run's
`report.html` to see what the model reported. Add `.code-reviewer/evals/` to `.gitignore`.

`--compare <result>` takes a `result.json`, its directory, an eval id (or a unique prefix) or `latest`,
and prints the deltas over the cases both results contain: recall, precision and F1 in percentage points,
false positives, unexpected findings, tokens, cost and time per pass, and the cases whose recall, precision,
noise or found defects changed. The comparison is stored in the new result.

| Flag | |
|---|---|
| `--filter <terms>` | Tags, id globs (`python/**`) or id prefixes (`go`), comma-separated; any match. A `!` term excludes (`hard,!real`). |
| `--repeat <n>` | Review every case n times. |
| `--concurrency <n>` | Cases reviewed in parallel (default 1). LLM calls within a case follow `review.concurrency`. |
| `--tolerance <lines>` | Matching tolerance (default 3). |
| `--out <dir>` | Parent directory of eval results (default `.code-reviewer/evals`). |
| `--compare <result>` | Deltas against a previous result. |
| `--min-recall <0..1>`, `--min-precision <0..1>` | Exit with code 1 when below: a CI gate. |
| `--keep` | Keep the temporary case repositories (their path is in the result). |
| `--json` | The result as JSON on stdout. |

The review flags work as for `review`: `--provider`, `--model`, `--reasoning`, `--critique-*`,
`--no-self-critique`, `--depth` / `--full`, `--min-severity`, `--min-confidence`, `--skills`,
`--no-tools`, `--max-chunk-tokens`, `--timeout`, `--chunking`, `--no-analyzers`, `--on-unavailable`.
Ctrl+C stops the running reviews and saves a partial result (exit 130); a second Ctrl+C quits at once.
