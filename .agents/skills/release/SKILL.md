---
name: release
description: Release a new version of Code Reviewer — bump the version, update CHANGELOG.md, verify, commit, tag and push. GitHub Actions then publishes the GitHub release and stages @antonio112009/code-reviewer on npm for the maintainer's 2FA approval. Use when asked to release, publish, ship or cut a new version.
---

# Releasing Code Reviewer

A release is a `vX.Y.Z` tag on `main` that matches `package.json`. The `Release` workflow
(`.github/workflows/release.yml`) does the publishing:
- runs the tests, packs the package and attests its build provenance;
- creates the GitHub release with `code-reviewer.tgz` and `code-reviewer-X.Y.Z.tgz`;
- stages the version on npm through Trusted Publishing.

The npm version goes live only after the maintainer approves it with 2FA. You never publish to npm
yourself.

## Steps

1. **Start from a clean, green `main`.**
   ```bash
   git switch main && git pull --ff-only
   git status --short                                        # must be empty
   gh run list --branch main --workflow ci.yml --limit 1     # must be success
   ```
   Feature branches that are not merged into `main` are not part of the release.

2. **Pick the version** (semver; while on 0.x a minor bump may break things).
   - Patch: fixes, docs, packaging.
   - Minor: new features.
   - If the user did not say which, ask.

3. **Bump** without tagging, so `package.json` and `npm-shrinkwrap.json` stay in sync:
   ```bash
   npm version X.Y.Z --no-git-tag-version
   ```

4. **Update `CHANGELOG.md`.** Add `## X.Y.Z — YYYY-MM-DD` at the top with the user-facing changes. Build
   it from `git log vPREVIOUS..HEAD --oneline`, grouped by features, fixes and packaging. The release
   notes are this file.

5. **Verify locally.** Everything must pass:
   ```bash
   npm ci && npm run typecheck && npm run lint && npm test && npm run build && npm pack --dry-run
   ```

6. **Commit and push `main`,** then wait for CI on that commit to be green:
   ```bash
   git commit -am "Release X.Y.Z" && git push origin main
   gh run watch "$(gh run list --branch main --workflow ci.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
   ```

7. **Tag and push the tag.** The workflow fails if the tag differs from `package.json`.
   ```bash
   git tag -a vX.Y.Z -m "Code Reviewer X.Y.Z" && git push origin vX.Y.Z
   gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
   ```

8. **Hand over the npm approval.** Tell the maintainer the version is staged and how to approve it with
   2FA: `npm stage list`, then `npm stage approve <id>`, or on npmjs.com. Do not approve it, and do not
   run `npm publish` or create npm tokens.

9. **After approval, check:**
   ```bash
   npm view @antonio112009/code-reviewer version
   gh release view vX.Y.Z
   ```

## If something fails

- **CI or the release job fails before the GitHub release exists.** Fix it on `main`, then move the tag
  onto the fixed commit and push it again:
  ```bash
  git push --delete origin vX.Y.Z && git tag -d vX.Y.Z
  ```
- **The GitHub release exists but staging on npm failed.**
  - When npmjs.com settings are the cause (the Trusted Publisher), fix them and re-run the failed job
    with `gh run rerun <run-id> --failed`.
  - When the fix needs a commit and the version is not on npm (check `npm view
    @antonio112009/code-reviewer versions`):
    1. delete the release and its tag with `gh release delete vX.Y.Z --yes --cleanup-tag` and
       `git tag -d vX.Y.Z`;
    2. fix the problem on `main`;
    3. tag again.
- **Provenance and `repository.url`.** npm's provenance check needs `repository.url` in `package.json`
  to match the GitHub repository exactly, including case: `git+https://github.com/Antonio112009/code-reviewer.git`.
- **Never** rewrite a tag whose npm version was already approved. Release a new patch version instead.
