---
name: CI/CD pipelines
description: Pipeline security and reliability defects in GitHub Actions, GitLab CI, Jenkins, Azure Pipelines and CircleCI, such as untrusted PR code with secrets, expression injection, unpinned actions, broad or persisted tokens, cache poisoning, always-true conditions, masked failures and deploy races.
category: infra
priority: 68
tier: essential
tags:
  - CWE-78
  - CWE-94
  - CWE-829
  - CWE-250
  - CWE-532
  - OWASP-A03
  - OWASP-A05
  - OWASP-A08
activation:
  stack:
    - ci.github-actions
    - ci.gitlab-ci
    - ci.jenkins
    - ci.azure-pipelines
    - ci.circleci
  languages:
    - yaml
    - groovy
    - text
  files:
    - .github/workflows/*.{yml,yaml}
    - "**/action.{yml,yaml}"
    - "**/.gitlab-ci.yml"
    - "**/*.gitlab-ci.yml"
    - .gitlab/ci/**/*.{yml,yaml}
    - "**/Jenkinsfile"
    - "**/Jenkinsfile.*"
    - "**/*.jenkinsfile"
    - "**/azure-pipelines*.{yml,yaml}"
    - .circleci/config.yml
  content:
    - \$\{\{[ \t]*(?:github|inputs|secrets|matrix|steps|needs|vars|env|parameters|variables)\.
    - "^[ \\t]*(?:-[ \\t]+)?(?:runs-on|uses|run|steps|needs|before_script|script|stages|resource_group):"
    - \b(?:pull_request_target|workflow_run)\b
    - \$\{?CI_(?:COMMIT|MERGE_REQUEST|JOB|PROJECT|PIPELINE|REGISTRY)_[A-Z_]+
    - ^[ \t]*(?:pipeline|stages|steps|post)[ \t]*\{|^[ \t]*stage[ \t]*\([ \t]*['"]|\bwithCredentials[ \t]*\(
---
- **Untrusted PR code**: `pull_request_target`, `workflow_run` or `issue_comment` jobs running PR-head code or trusting its artifacts with secrets or a write token → secret theft, repo takeover.
- **Expression injection**: `${{ }}` with PR titles, bodies, branch names, comments or commit messages in `run:` or `github-script`, Azure `$(Build.SourceBranchName)` macros → command injection. Fix: pass via `env:`.
- **Env-file injection**: untrusted multi-line values written to `$GITHUB_ENV`/`$GITHUB_OUTPUT` → injected `BASH_ENV` or `LD_PRELOAD` runs code in later steps.
- **Unpinned dependencies**: third-party `uses:` on tags or branches, GitLab `include` without `ref` or via `remote:` → a moved tag runs with your secrets. Fix: pin commit SHAs.
- **Broad tokens**: workflow-wide `contents: write`/`id-token: write`, no `permissions:` on legacy write-all repos, `secrets: inherit` → any step can push or mint cloud credentials. Fix: per-job grants.
- **Persisted token**: `actions/checkout` without `persist-credentials: false` leaves the token to later steps, before v6 in `.git/config` → leaked by uploaded workspaces or `docker build` contexts.
- **Cache poisoning**: caches saved by untrusted or `pull_request_target` jobs and restored in release jobs → tampered dependencies ship.
- **Exposed runners**: self-hosted runners serving fork PRs; GitLab deploy variables not protected → any branch pipeline can read them.
- **Always-true conditions**: `if: ${{ a }} && ${{ b }}` is a non-empty string, not one expression → always true; `continue-on-error: true` on tests or scans → failures ship.
- **Missing pipefail**: GitHub `run:` without an explicit `shell: bash` lacks `pipefail` → `npm test | tee log` hides failing tests.
- **Deploy races**: deploys without `concurrency:` or GitLab `resource_group` overlap; `cancel-in-progress: true` on them → half-applied state.
- **Jenkins interpolation**: double-quoted Groovy `sh "… ${env.TOKEN} …"` or `${params.X}` → secrets in logs, shell injection. Fix: `sh '… $TOKEN …'`.
