# Code Reviewer in CI

Code Reviewer can review every pull request (GitHub) or merge request (GitLab) and put the result where
reviewers look:
- **Inline comments** on the changed lines, one per finding, with severity, failure scenario, suggestion,
  confidence and the critic's verdict.
- **One summary comment** with the counts, the findings that could not go inline, and a visible warning
  when part of the change was not reviewed. Later runs **update it in place**.
- **Reports**: SARIF for GitHub code scanning (`--format sarif`), a GitLab Code Quality report
  (`--format codequality`), plus Markdown / JSON / HTML.

Contents: [GitHub Actions](#github-actions) · [GitLab CI](#gitlab-ci) · [Providers in CI](#providers-in-ci) ·
[Posting from anywhere](#posting-from-anywhere) · [How posting works](#how-posting-works) ·
[Tokens and safety](#tokens-and-safety)

## GitHub Actions

### With the action

```yaml
# .github/workflows/code-review.yml
name: Code review

on:
  pull_request:

permissions:
  contents: read          # check out the code
  pull-requests: write    # inline comments and the summary comment
  security-events: write  # upload SARIF to code scanning
  id-token: write         # only for Bedrock through an OIDC role (see below)

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.pull_request.head.sha }}   # the pull request head, not the merge commit
          fetch-depth: 0                                   # history for the merge-base
          persist-credentials: false

      # A provider: Bedrock through an OIDC role (or Claude Code, see "Providers in CI").
      - uses: aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd # v6.3.0
        with:
          role-to-assume: arn:aws:iam::123456789012:role/code-reviewer
          aws-region: us-east-1

      - uses: antonio112009/code-reviewer@main   # pin a release tag or commit sha
        with:
          provider: bedrock
          model: global.anthropic.claude-sonnet-5
          depth: essential
          fail-on: critical    # optional: fail the job on critical findings or unreviewed code
```

Inputs:

| Input | Default | Meaning |
|---|---|---|
| `provider`, `model` | configured default | Review provider and model (`claude`, `bedrock`, …). |
| `depth` | configured depth (`full`) | `full` (every real defect) or `essential` (serious production issues only: about a third cheaper, far fewer findings). |
| `fail-on` | empty | Fail the job on findings of this severity or worse, or when part of the change was not reviewed. |
| `post` | `true` | Post inline comments and the summary comment. |
| `sarif` | `true` | Upload `report.sarif` to code scanning (category `code-reviewer`). |
| `version` / `tarball-url` | `latest` | Which code-reviewer to install. |
| `args` | empty | Extra `code-reviewer review` arguments, split on whitespace. |
| `output-dir` | `code-reviewer-reports` | Where the reports go; they are also uploaded as an artifact. |
| `github-token` | `github.token` | Token for posting; only the posting step receives it. |

With `--intent` in `args` (experimental), the review also reads the pull request's title and description from the
CI's event (GitHub `pull_request`, GitLab `CI_MERGE_REQUEST_TITLE` / `CI_MERGE_REQUEST_DESCRIPTION`) and the commit
messages, and reports code that does not do what they say.

The action installs the release tarball, runs `code-reviewer review --plain --format md,json,sarif`, then
posts with `code-reviewer runs publish latest`, uploads the SARIF and the reports, and finally fails the job
if the review or the posting failed. The review step has no forge token: the agents that read the pull
request never see it.

### Without the action

```yaml
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
      - run: npm install -g https://github.com/antonio112009/code-reviewer/releases/latest/download/code-reviewer.tgz
      - name: Review
        run: code-reviewer review --plain --yes --format md,json,sarif --out reports --provider bedrock
      - name: Post to the pull request
        if: ${{ !cancelled() && hashFiles('reports/report.json') != '' }}
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: code-reviewer runs publish latest
      - uses: github/codeql-action/upload-sarif@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2 # v4.38.2
        if: ${{ !cancelled() && hashFiles('reports/report.sarif') != '' }}
        with:
          sarif_file: reports/report.sarif
          category: code-reviewer
```

`code-reviewer review --post` does the same in one step, with the token in the review's environment.

### Notes

- **Check out the pull request head** (`ref: github.event.pull_request.head.sha`). With the default merge
  commit, the reviewed commit is not the pull request head, so inline comments are not posted (the summary
  says why). The action passes `--head <pull request head>` when that commit is in the checkout.
- **Forks.** Workflows for pull requests from forks get a read-only `GITHUB_TOKEN` and no secrets: the review
  cannot run with your provider there and cannot comment. Do not switch to `pull_request_target` to work
  around it while checking out the fork's code with secrets available.
- **Code scanning** of private repositories needs GitHub Advanced Security (Code Security). Set `sarif: false`
  without it.
- **GitHub Enterprise Server**: the action uses the `GITHUB_API_URL` of the runner; nothing to configure.
- **Result cache between runs** (optional): pushes to a pull request then only pay for the chunks that
  changed. Point `CODE_REVIEWER_CACHE_DIR` at a directory restored with `actions/cache`, and give every job
  the same signing key through a secret, `CODE_REVIEWER_CACHE_KEY` (32+ characters): without it each job
  signs with a new key and finds nothing. Fork pull requests get no secrets, so they neither read nor
  seed the cache.

  ```yaml
  - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
    with:
      path: .cr-cache
      key: code-reviewer-${{ github.event.pull_request.number }}-${{ github.sha }}
      restore-keys: code-reviewer-${{ github.event.pull_request.number }}-
  # then, in the review step:
  env:
    CODE_REVIEWER_CACHE_DIR: ${{ github.workspace }}/.cr-cache
    CODE_REVIEWER_CACHE_KEY: ${{ secrets.CODE_REVIEWER_CACHE_KEY }}
  ```

## GitLab CI

Include the template and set two masked CI/CD variables:

```yaml
# .gitlab-ci.yml
include:
  - remote: https://raw.githubusercontent.com/antonio112009/code-reviewer/main/ci/gitlab/code-reviewer.gitlab-ci.yml

code-reviewer:
  variables:
    CODE_REVIEWER_PROVIDER: claude
    CODE_REVIEWER_MODEL: sonnet
    CODE_REVIEWER_EXTRA_PACKAGES: "@anthropic-ai/claude-code"
    CODE_REVIEWER_FAIL_ON: critical     # optional
```

- `GITLAB_TOKEN`: a **project or group access token** with the `api` scope and at least the Reporter role
  (a personal access token works too). `CI_JOB_TOKEN` **cannot create merge request discussions**, so it is
  never used. Without `GITLAB_TOKEN` the job still produces the reports but posts nothing. A *protected*
  variable is only available to pipelines of protected branches, i.e. not to most merge request pipelines.
- The provider's credentials, e.g. `ANTHROPIC_API_KEY` (see below).

The job runs on merge request pipelines only (`rules: $CI_PIPELINE_SOURCE == "merge_request_event"`), with
`GIT_DEPTH: 0`. It writes `code-reviewer-reports/` (kept as an artifact) and a Code Quality report
(`artifacts:reports:codequality`) that GitLab shows in the merge request widget and diff. Merged results
pipelines are handled: the job reviews `CI_MERGE_REQUEST_SOURCE_BRANCH_SHA`, the merge request head.
Self-managed GitLab needs no configuration: the job uses the `CI_API_V4_URL` of the instance.

Variables: `CODE_REVIEWER_VERSION` (`latest` or a tag), `CODE_REVIEWER_PROVIDER`, `CODE_REVIEWER_MODEL`,
`CODE_REVIEWER_DEPTH`, `CODE_REVIEWER_FAIL_ON`, `CODE_REVIEWER_ARGS`, `CODE_REVIEWER_EXTRA_PACKAGES`.

## Gitea / Forgejo / Codeberg

Gitea Actions and Forgejo Actions run GitHub-style workflows, so the review step is the same as
[without the action](#without-the-action); only the token and the posting differ:

```yaml
# .gitea/workflows/code-reviewer.yml  (Forgejo: .forgejo/workflows/)
on: pull_request
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm install -g @antonio112009/code-reviewer
      - run: code-reviewer review --head ${{ github.event.pull_request.head.sha }} --plain --yes --format md,json --out reports --provider anthropic
        env: { ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }} }
      - run: code-reviewer runs publish latest
        env: { GITEA_TOKEN: ${{ secrets.GITEA_TOKEN }} }
```

- The runner sets `GITEA_ACTIONS=true` next to the GitHub variables; code-reviewer reads the pull request from
  them and posts to the instance's own API (`GITHUB_API_URL`, which Gitea points at itself). Outside Actions,
  set `publish.giteaApiUrl` in the global config (`https://git.example.com/api/v1`) or pass `--api-url`;
  without either, Codeberg's API is used.
- `GITEA_TOKEN` (or `FORGEJO_TOKEN`): an access token with write access to the repository's issues and pull
  requests. The checkout is `refs/pull/N/head`, not a merge commit, so the review's head is the pull request
  head; pass it explicitly as above when the workflow checks out something else.
- Inline comments go into one review; the summary is an issue comment updated in place. Two things the
  Gitea API does not offer: one-click `suggestion` blocks (the fix is shown as text) and resolving review
  threads (fixed findings are listed in the summary instead). `upload-sarif` and the composite action do not
  run on Gitea; use the steps above.

## Bitbucket Pipelines

```yaml
# bitbucket-pipelines.yml
image: node:24
pipelines:
  pull-requests:
    '**':
      - step:
          name: Code review
          clone: { depth: full }
          script:
            - npm install -g @antonio112009/code-reviewer
            - code-reviewer review --plain --yes --format md,json --out reports --provider anthropic
            - code-reviewer runs publish latest
```

- Pipelines provide no token for the Bitbucket API: add `BITBUCKET_TOKEN` and `BITBUCKET_EMAIL` as *secured*
  repository variables — an [API token](https://support.atlassian.com/bitbucket-cloud/docs/api-tokens/) with
  pull request write permission and the account's e-mail (Basic authentication) — or a repository / workspace
  access token as `BITBUCKET_TOKEN` alone (bearer). App passwords stopped working in June 2026.
- The base branch comes from `BITBUCKET_PR_DESTINATION_BRANCH`, the repository from `BITBUCKET_REPO_FULL_NAME`,
  the pull request from `BITBUCKET_PR_ID`; `--forge bitbucket --repo workspace/slug --pr N` outside Pipelines.
  The API is always `https://api.bitbucket.org/2.0` (`--api-url` for anything else).
- Inline comments are posted one by one on the new-side line; the summary is a pull request comment updated
  in place. Bitbucket's API returns no commit for a comment, so fixed findings are listed in the summary rather
  than resolved, and one-click suggestions are shown as text. The workspace's rate limit (1,000 requests per
  hour) is plenty: a publication is a handful of requests.

## Bitbucket Data Center (Jenkins, Bamboo)

```groovy
// Jenkinsfile (multibranch pipeline with the Bitbucket Branch Source plugin)
stage('Code review') {
  when { changeRequest() }
  environment {
    BITBUCKET_DC_TOKEN = credentials('bitbucket-http-token')
    ANTHROPIC_API_KEY  = credentials('anthropic-api-key')
  }
  steps {
    sh 'git fetch --no-tags origin "+refs/heads/${CHANGE_TARGET}:refs/remotes/origin/${CHANGE_TARGET}"'
    sh 'code-reviewer review --base "origin/${CHANGE_TARGET}" --plain --yes --format md,json --out reports --provider anthropic'
    sh 'code-reviewer runs publish latest --forge bitbucket-dc --pr "${CHANGE_ID}"'
  }
}
```

```bash
# Bamboo script task (plan branches for pull requests)
code-reviewer review --base "origin/${bamboo_repository_pr_targetBranch}" --plain --yes --format md,json --out reports --provider anthropic
code-reviewer runs publish latest --forge bitbucket-dc --pr "${bamboo_repository_pr_key}"
```

- Data Center has no public API: set `publish.bitbucketDcApiUrl` in the global config
  (`https://bitbucket.example.com/rest/api/1.0`, with the context path if the server has one) or pass `--api-url`.
- `BITBUCKET_DC_TOKEN` is an [HTTP access token](https://confluence.atlassian.com/bitbucketserver/http-access-tokens-939515499.html)
  (personal, project or repository) with *Repository write* permission, sent as a bearer token. Comments are
  told apart by their author: Data Center names the token's user in the `X-AUSERNAME` response header; if your
  proxy strips it, set `BITBUCKET_DC_USERNAME` to that user (for a project or repository token, its bot user).
- Jenkins and Bamboo expose no common pull request variables, so `--pr` is always needed (`CHANGE_ID` in
  Jenkins, `bamboo_repository_pr_key` in Bamboo) and the base branch is passed with `--base`. The repository
  comes from the remote (`https://host/scm/KEY/slug.git` or `ssh://git@host:7999/key/slug.git`) or from
  `--repo KEY/slug` (`~user/slug` for a personal repository).
- Inline comments are anchored on the new-side line (`ADDED` or `CONTEXT`); the summary is a pull request comment
  updated in place. Fixed findings are listed in the summary rather than resolved, and one-click suggestions
  are shown as text.

## Azure Pipelines

```yaml
# azure-pipelines.yml
trigger: none
pr: [main]
pool: { vmImage: ubuntu-latest }
steps:
  - checkout: self
    fetchDepth: 0
  - task: NodeTool@0
    inputs: { versionSpec: '24.x' }
  - script: npm install -g @antonio112009/code-reviewer
  - script: code-reviewer review --head $(System.PullRequest.SourceCommitId) --plain --yes --format md,json --out reports --provider anthropic
    env: { ANTHROPIC_API_KEY: $(ANTHROPIC_API_KEY) }
  - script: code-reviewer runs publish latest
    env: { SYSTEM_ACCESSTOKEN: $(System.AccessToken) }
```

- A pull request build checks out the *merge* commit, so the review names the source commit as `--head`
  (`System.PullRequest.SourceCommitId`): comments then anchor on the lines of the pull request itself.
- `System.AccessToken` must be mapped into the posting step explicitly (as above), and the project's build
  service identity needs **Contribute to pull requests** on the repository. Outside Pipelines, set
  `AZURE_DEVOPS_TOKEN` to a personal access token with *Code (read & write)* and *Pull Request Threads*.
- The API is the organisation's collection URL. In Pipelines it comes from `SYSTEM_TEAMFOUNDATIONCOLLECTIONURI`;
  elsewhere from the `dev.azure.com` remote (`https://dev.azure.com/{org}`), `publish.azureApiUrl` in the global
  config, or `--api-url` — the only way for Azure DevOps Server (`https://server/tfs/Collection`). The repository
  is `project/repository` (`--repo "Shop/shop"`).
- Inline comments are threads on the new-side lines (status *Active*); the summary is a thread without a file
  (status *Closed*), updated in place. Threads record no commit, so fixed findings are listed in the summary
  rather than resolved, and one-click suggestions are shown as text.

## Providers in CI

**AWS Bedrock through OIDC** (no stored AWS keys). Create an IAM role that trusts your CI's OIDC provider
(GitHub: `token.actions.githubusercontent.com`, restricted to your repository; GitLab: your instance's ID
tokens) and allows `bedrock:InvokeModel` / `bedrock:InvokeModelWithResponseStream` (plus
`bedrock:ListFoundationModels` / `bedrock:ListInferenceProfiles` for the model check). In GitHub Actions,
`aws-actions/configure-aws-credentials` with `role-to-assume` and `permissions: id-token: write` (example
above); in GitLab, an `id_tokens:` entry plus `AWS_ROLE_ARN` and `AWS_WEB_IDENTITY_TOKEN_FILE`. Then
`provider: bedrock` and a Bedrock model id or inference profile. `AWS_BEARER_TOKEN_BEDROCK` (a Bedrock API
key) works too.

**Claude Code with an API key.** The `claude` provider drives the Claude Code CLI through its ACP adapter:
- install the CLI: `npm install -g @anthropic-ai/claude-code` (it must be on `PATH`);
- the adapter `@agentclientprotocol/claude-agent-acp` is started with `npx` (or install it globally too);
- store an Anthropic API key as a secret and expose it as `ANTHROPIC_API_KEY`.

```yaml
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
      - run: npm install -g @anthropic-ai/claude-code
      - uses: antonio112009/code-reviewer@main   # pin a release tag or commit sha
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          provider: claude
          model: sonnet
```

The agent runs read-only on an isolated snapshot, whatever the repository contains (see the safety model in
[ARCHITECTURE.md](ARCHITECTURE.md#safety-model)).

## Posting from anywhere

```bash
code-reviewer review --post                       # review, then post to the branch's open PR/MR
code-reviewer runs publish latest --dry-run       # print the comments that would be posted (no API calls)
code-reviewer runs publish latest                 # post a saved run
code-reviewer runs publish latest --pr 42 --repo acme/shop
code-reviewer runs publish latest --forge gitlab --repo group/project --pr 7 \
  --api-url https://gitlab.example.com/api/v4
```

The target is resolved in this order (`--verbose` prints each decision):
1. flags: `--pr <number>`, `--repo <owner/name | group/project | project id>`, `--forge github|gitlab|gitea|bitbucket|bitbucket-dc|azure`,
   `--api-url <url>`;
2. the CI: GitHub Actions (`GITHUB_REPOSITORY`, the pull request of the event, `GITHUB_API_URL`), GitLab CI
   (`CI_MERGE_REQUEST_PROJECT_ID`, `CI_MERGE_REQUEST_IID`, `CI_API_V4_URL`);
3. locally: the git remote and the branch's open pull/merge request from `gh` / `glab`.

Only branch reviews (`code-reviewer review`) can be posted; `files` runs cannot. `--force` posts inline
comments even when the pull request head moved since the review. Publishing failures exit with code 2, after
the run and its reports are saved.

Settings (`publish` in `.code-reviewer/config.yaml` or `~/.code-reviewer/config.yaml`):

```yaml
publish:
  maxInlineComments: 30   # the rest are listed in the summary comment
  minSeverity: info       # comment inline only on this severity or worse
  # Global config only (they receive your token):
  # githubApiUrl: https://github.example.com/api/v3
  # gitlabApiUrl: https://gitlab.example.com/api/v4
```

## How posting works

- **Inline comments** go only on lines the pull request diff shows (the reviewed `merge-base..head` diff with
  3 lines of context, new side). A finding outside it, over `maxInlineComments` or below
  `publish.minSeverity` is listed in the summary instead. GitHub gets one review (`COMMENT`) carrying all
  comments; if GitHub refuses it, comments are posted one by one and refused ones move to the summary.
  GitLab gets one discussion per finding, positioned with the merge request's `diff_refs`.
- **No duplicates.** Each finding has a fingerprint (file, category, static rule and the whitespace-normalised
  code it points at; not line numbers), stored as a hidden `<!-- code-reviewer:fp=… -->` marker. A re-run
  skips findings already commented on by the same account, so pushing unrelated commits does not repeat
  them. The same fingerprint keys SARIF `partialFingerprints` and Code Quality `fingerprint`.
- **Fixed findings.** When a push changes the code of an earlier inline comment and the new review does not
  report its finding again, the thread gets a short reply and is resolved (`publish.resolveFixed: false`
  turns this off). A thread someone reopens is left open. If the token may comment but not resolve, the
  summary says so and everything else is posted.
- **The summary comment** carries `<!-- code-reviewer:summary -->` and is edited in place on every run.
- **Stale head.** If the pull request head is not the reviewed commit (someone pushed meanwhile), inline
  comments are skipped (lines may have moved) and the summary says so; `--force` posts them anyway.
- **Untrusted text.** Everything from the model or the repository is escaped: no HTML, images or links,
  `@mentions` and `#123` / `!123` references are defused (a finding cannot ping anyone), and no line can
  start a GitLab quick action such as `/approve`.

## Tokens and safety

- Tokens come from `GITHUB_TOKEN` or `GH_TOKEN` (GitHub) and `GITLAB_TOKEN` (GitLab), and are never logged.
- A token is only sent to api.github.com or gitlab.com, to the API URL the CI declares (`GITHUB_API_URL`
  inside GitHub Actions, `CI_API_V4_URL` inside GitLab CI), or to `publish.githubApiUrl` /
  `publish.gitlabApiUrl` from the **global** config or `--api-url`. A project config (it comes from the
  checkout under review) may not set these URLs.
- The repository's remote URL only names the repository, and only when its host matches the chosen API: a
  GitHub Enterprise remote without a configured API URL is an error, never a post to github.com.
- API URLs must be https (plain http only for localhost), requests never follow redirects or pagination links
  to another host, and every request has a timeout; 429 and 5xx answers are retried up to 3 attempts,
  honouring `Retry-After`.
- Only the account's own comments count for de-duplication and summary updates (GitHub Actions and GitHub
  App tokens cannot look themselves up, so bot accounts' comments count there).
