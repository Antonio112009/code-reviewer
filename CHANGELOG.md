# Changelog

## 0.1.1 — 2026-09-28

- **npm.** Published as `@antonio112009/code-reviewer`; install with
  `npm install -g @antonio112009/code-reviewer`.
- **Releases.** A version tag runs GitHub Actions, which:
  - publishes the GitHub release with an attested `code-reviewer.tgz`;
  - stages the npm version through Trusted Publishing. It goes live after the maintainer's 2FA
    approval.
- **Agent skill `release`.** Claude Code, Codex and GitHub Copilot can follow the release procedure
  from `.claude/skills/` and `.agents/skills/`.

## 0.1.0 — first preview

Released under the [MIT License](LICENSE). Requires Node.js 24 or newer.
Install with `npm install -g @antonio112009/code-reviewer`.

- **Review targets.** Branch diffs are reviewed like a pull request: `merge-base(base, head)..head`, with
  the base picked from CI, an open PR/MR, branch rules or the remote default. Whole files and folders can
  be reviewed too.
- **Providers.**
  - Claude Code, Codex, Copilot and Gemini through the Agent Client Protocol;
  - AWS Bedrock through the Converse API;
  - a model per stage, with reasoning effort;
  - fallback to an alternative when a model is unavailable.
- **Pipeline.** Smart chunking of related files, read-only tools for the model, a strict JSON findings
  contract, validation, dedupe, self-critique, a confidence threshold, and author attribution with
  GitHub/GitLab links.
- **Two review depths.** `essential` (default) covers serious production issues only and uses fewer
  tokens; `full` covers every real defect.
- **Skills.** 851 skills in a tree by language and technology, with detection per folder, version gates
  and essential/full tiers. Custom global and project skills are supported.
- **Static pre-pass.**
  - secret scanning and 128 bug-pattern rules;
  - safe external linters (gitleaks, shellcheck, hadolint, ruff, cppcheck);
  - opt-in project linters.

  Their hits are confirmed or rejected by the model.
- **Terminal and reports.** A live dashboard and a summary at the end. Runs are saved and can be exported
  as Markdown, JSON or HTML. `code-reviewer init` sets up a project.
- **Safety.** Agents work on an isolated, sanitized snapshot. Nothing from the reviewed repository is
  executed: programs never come from the checkout, and project config, globs and regexes are bounded.
  Ctrl+C terminates every process tree.
