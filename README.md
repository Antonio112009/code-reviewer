<p align="center">
  <img src="docs/assets/logo.svg" width="128" height="128" alt="Code Reviewer logo">
</p>

<h1 align="center">Code Reviewer</h1>

<p align="center">
  <b>“Next-level LLM code review.”</b><br>
  Fewer false positives. The bugs a single LLM pass misses. Every changed line checked.
</p>

<p align="center">
  <a href="https://github.com/antonio112009/code-reviewer/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/antonio112009/code-reviewer/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@antonio112009/code-reviewer"><img alt="npm" src="https://img.shields.io/npm/v/@antonio112009/code-reviewer?color=7c3aed"></a>
  <img alt="node >= 24" src="https://img.shields.io/badge/node-%E2%89%A5%2024-22d3ee">
  <img alt="status: preview" src="https://img.shields.io/badge/status-preview-f472b6">
  <a href="LICENSE"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-22c55e"></a>
</p>

---

LLM reviewers are fast, but they are noisy. They flag things that aren't bugs, miss the subtle defects on
the first pass, and skim big changes. **Code Reviewer** wraps the model you already use — Claude Code,
Codex, Copilot, Gemini or AWS Bedrock — in a review pipeline built against exactly that:
- **Skills.** Technology- and version-specific checklists tell the model where bugs hide in *this* code.
- **Static hints.** Fast analyzers point at exact lines; the model confirms or rejects each one.
- **Self-critique.** A second pass throws out what it cannot prove.
- **Full coverage.** Every chunk of the change is reviewed, with the related files next to it.

## Quick start

Requires **Node.js ≥ 24**, **git**, and one provider: the Claude Code, Codex, Copilot or Gemini CLI
logged in, or AWS credentials for Bedrock.

```bash
npm install -g @antonio112009/code-reviewer

cd /path/to/your/project
code-reviewer init        # detects your stack and providers, writes .code-reviewer/config.yaml
code-reviewer review      # reviews your branch against its base branch
```

<details>
<summary>Other ways to install</summary>

From the latest GitHub release:

```bash
npm install -g https://github.com/antonio112009/code-reviewer/releases/latest/download/code-reviewer.tgz
```

From a clone:

```bash
git clone https://github.com/antonio112009/code-reviewer.git
cd code-reviewer
npm install && npm run build
npm link           # puts `code-reviewer` on your PATH
```

</details>

Everyday commands:

```bash
code-reviewer review                          # your branch vs its base (auto-detected), essential depth
code-reviewer review --full                   # every real defect, not only production-critical ones
code-reviewer review --base main --fail-on major   # CI gate: exit code 1 on major or critical findings
code-reviewer review --dry-run                # the plan only: chunks, skills, hints — no LLM calls
code-reviewer files src/payments              # review whole files or folders
code-reviewer runs open latest                # the HTML report of the last run
```

## Why Code Reviewer

- **Fewer false positives.** Every finding needs a concrete failure scenario and a confidence score. A
  self-critique pass re-checks each one against the code, static hints count only when the model
  confirms them, and anything below your confidence threshold is dropped.
- **Finds what one pass misses.** 850+ small skills (React effects, Next.js caching, Django ORM, Go
  concurrency, PostgreSQL locks, Kubernetes security, …) are picked per chunk from the detected stack
  and the **versions** in your manifests. Only relevant skills are loaded, never "all of JavaScript".
- **Covers the whole change.** Related files (imports, tests, siblings) are reviewed together and shared
  files are added as read-only context, so nothing is silently dropped.
- **Two depths.**
  - `essential`, the default: only what can seriously hurt production — security, data loss, crashes,
    memory leaks / OOM, overload, costly performance — using fewer tokens.
  - `full`: every real defect, including edge cases and accessibility.
- **Your models, per stage.** A fast model for the review and a stronger one for verification, each
  with its own reasoning effort. If a model becomes unavailable, it offers an alternative (Claude ↔
  Codex, …).
- **Safe on untrusted code.** Agents read an isolated, read-only snapshot, and nothing from the reviewed
  repository is ever executed. Ctrl+C stops every process cleanly.

## How it works

```mermaid
flowchart LR
  A[Refs & diff] --> B[Stack + versions]
  B --> C[Static pre-pass]
  C --> D[Smart chunks]
  D --> E[Skills per chunk]
  E --> F[LLM review<br/>read-only tools]
  F --> G[Validate & dedupe]
  G --> H[Self-critique]
  H --> I[Report + authors]
```

1. **Refs.** Picks the base branch (CI pull request, open PR/MR, branch rules such as `feature/** →
   develop → main`) and fetches it fresh.
2. **Stack and hints.** Detects technologies and versions from manifests. Runs secret scanning, about
   130 bug-pattern rules and safe external linters, whose hits become hints.
3. **Chunks.** Groups related files into chunks that fit the model's context window.
4. **Review.** For every chunk:
   - selects the matching skills;
   - runs the model with read-only tools: `read_file`, `grep`, `find_symbol`, `git_blame`, `get_skill`;
   - collects findings through a strict JSON contract.
5. **Verify.** Validates the findings (real file, real lines, near the change), dedupes them, and sends
   them to self-critique.
6. **Report.** A live terminal dashboard, then Markdown / JSON / HTML reports with authors and
   GitHub/GitLab links. Every run is saved.

## Providers

| Provider | Uses | Notes |
|---|---|---|
| `claude` | Claude Code over [ACP](https://agentclientprotocol.com) | your Claude Code login; `--model opus\|sonnet\|haiku` |
| `codex` | OpenAI Codex over ACP | experimental; can run commands, so it is never picked as an automatic fallback |
| `copilot` | GitHub Copilot CLI over ACP | experimental |
| `gemini` | Gemini CLI over ACP | experimental |
| `bedrock` | AWS Bedrock (Converse API) | AWS credential chain (profile, SSO, role) or `AWS_BEARER_TOKEN_BEDROCK` |

```bash
code-reviewer providers list                   # what is installed and logged in
code-reviewer providers test claude --model sonnet
```

## Review depth

| | `essential` (default) | `full` (`--full`) |
|---|---|---|
| Looks for | security, data loss, crashes/hangs, leaks & OOM, overload (unbounded concurrency, missing timeouts, retry storms, N+1), races, costly performance | every real defect, also edge cases, accessibility, best practices with a concrete consequence |
| Severities | critical, major | all |
| Skills | essential ones, 3.5k tokens per chunk | all, 6k tokens per chunk |
| Fix required | yes, for every finding | when possible |

## Configuration

`code-reviewer init` asks a few questions and writes a commented `.code-reviewer/config.yaml`. Settings
are applied in this order, later ones winning:
1. defaults;
2. `~/.code-reviewer/config.yaml`;
3. the project config;
4. `--profile`;
5. flags.

```yaml
project:
  name: billing-service
  focus: [security, data-integrity, concurrency]
roles:
  review:   { provider: claude, model: sonnet, reasoning: medium }
  critique: { provider: claude, model: opus, reasoning: high }
review:
  depth: essential          # or full
  minConfidence: 0.7
  exclude: ["**/*.generated.ts"]
git:
  base: { rules: [{ match: "feature/**", base: [develop, main] }] }
```

Useful flags:
- `--provider`, `--model`, `--reasoning`: the review model;
- `--critique-*` and `--no-self-critique`: the verification pass;
- `--skills a,b`: pick skills by hand;
- `--analyzers eslint,tsc`: opt-in project linters;
- `--authors`: author attribution;
- `--json`, `--plain`: output format;
- `--offline`: no fetch.

`code-reviewer config show` prints the effective configuration.

A project config comes from the checkout under review, so it may not choose programs, model fallbacks or
analyzers that execute code. Those live in the global config only.

## Skills

Skills are small Markdown checklists in a tree by language and technology: `javascript/react/effects`,
`python/django/orm-performance`, `databases/postgresql/core`, … Each folder's `_group.yaml` says how to
recognize the technology. A skill loads only when its technology is in the chunk and the changed code
touches its topic, optionally gated on versions (`framework.react: ">=19"`).

```bash
code-reviewer skills list javascript/react     # the tree, detection rules and sizes
code-reviewer skills detect                    # your stack, versions and the skills that apply
```

Add your own skills in `~/.code-reviewer/skills/` or `<repo>/.code-reviewer/skills/`. See
[docs/skills.md](docs/skills.md) for the format.

## Reports and history

Each run is saved in `.code-reviewer/runs/<id>/` (add it to `.gitignore`; `init` offers to). Use
`code-reviewer runs list | show | export | open | rm` to browse runs. Reports include every finding with
its confidence, the critic's verdict, the author and links, plus what was rejected and why.

## Development

```bash
npm install && npm run build && npm run typecheck && npm run lint && npm test
```

- **CI.** GitHub Actions run on every push and pull request:
  - typecheck, lint, build and a package check;
  - the tests on Linux and macOS with Node 24 (LTS) and 26;
  - a Windows smoke test;
  - dependency review, and CodeQL security scanning.

  Actions are pinned to commit SHAs, and Dependabot keeps them and the npm dependencies current.
- **Release.** Bump `version` in `package.json`, add the notes to `CHANGELOG.md`, then push a matching
  tag (`git tag v0.1.1 && git push origin v0.1.1`). The release workflow:
  - tests and packs the package, and attests its build provenance;
  - publishes a GitHub release with `code-reviewer.tgz`;
  - publishes `@antonio112009/code-reviewer` to npm through Trusted Publishing, with provenance.

  Verify a download with `gh attestation verify code-reviewer.tgz --repo antonio112009/code-reviewer`.

Architecture, contracts and the safety model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Changes:
[CHANGELOG.md](CHANGELOG.md).

## Roadmap

- Skill-bundled **structural checks** (ast-grep rules next to each skill). They will run before the LLM
  and be available to it as a tool.
- Reviewing staged/uncommitted changes; resuming partial runs; caching by chunk.
- Posting review comments to GitHub pull requests and GitLab merge requests.

## License

[MIT](LICENSE) © 2026 antonio112009
