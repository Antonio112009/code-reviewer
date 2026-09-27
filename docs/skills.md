# Skills

A **skill** is a small Markdown checklist that tells the reviewing model where bugs hide for one topic of
one technology, e.g. `javascript/react/effects` or `databases/postgresql/core`. For each chunk of a review,
only the skills whose technology is present and whose topic the changed code touches are injected.

## The tree

```
skills/
  practice/     cross-cutting defects: general-bugs (always on), concurrency, error-handling, performance, …
  security/     cross-cutting security: core (always on), auth, crypto, secrets, supply-chain, llm-apps
  web/          browser code in any stack: accessibility, browser-security, performance
  javascript/   core/, typescript/, node/ (express/, nestjs/, …), react/, nextjs/, vue/, angular/, svelte/, …
  python/ php/ java/ kotlin/ csharp/ go/ rust/ c-cpp/ ruby/ swift/ dart/ scala/ shell/
  sql/          query correctness and performance, any engine
  databases/    postgresql/, mysql/, sqlite/, sqlserver/, mongodb/, redis/, elasticsearch/, migrations
  infra/        docker/, kubernetes/, terraform/, ci/
```

- **Ids.** A skill's id is its path without `.md` (`javascript/react/effects`).
- **Folders.** Frameworks live under their language: `python/django/`, `java/spring/`, `dart/flutter/`.
- **Group files.** Every folder that contains skills has a `_group.yaml`.

## `_group.yaml`: what the technology is and how to detect it

```yaml
name: Angular
description: Angular components, DI, RxJS and signals. Detected when the project depends on @angular/core and the chunk has Angular files.
category: framework          # practice | security | language | web | database | framework | infra
priority: 60                 # default priority of the skills below (0-100)
tier: essential              # default tier of the skills below (essential | full)
detect:
  stack: [framework.angular]                       # gate: tech detected from the manifests
  languages: [typescript]                          # gate: a language of the chunk
  files: ["**/*.component.ts", "**/angular.json"]  # signal on the chunk's paths
  content: ["from ['\"]@angular/"]                 # signal on the full content of the chunk's files
  versions: { framework.angular: ">=16" }          # gate on the detected version
```

Every declared gate must pass, and if signals are declared, at least one must hit. All ancestor groups
must match for a skill to be used: `javascript/nextjs/server-actions` needs both `javascript` and
`javascript/nextjs`. Tech ids are listed in `src/context/stack/techs.ts`.

## A skill file

```markdown
---
name: Effects and stale closures
description: useEffect bugs — missing dependencies, missing cleanup, races between overlapping async effects.
tier: essential
activation:
  content: ["\\buse(?:Layout)?Effect\\s*\\("]     # runs on the ADDED lines of a diff
  versions: { framework.react: ">=16.8" }
sources:
  - https://react.dev/reference/react/useEffect
---
- **Missing cleanup**: a subscription, timer or listener without a returned cleanup → leaks and duplicate handlers after every re-render. Fix: return the cleanup.
- **Racing requests**: an async effect that sets state after the dependency changed → stale data wins. Fix: ignore flag or AbortController.
- [full] **Unstable dependency**: an object literal in the deps array re-runs the effect on every render. Fix: memoize or move it inside.
```

- **Bullets.** A body has 3–12 bullets. Each names the trigger, the production consequence and the fix,
  in its own words, with sources. No style advice and nothing a linter always reports.
- **Signals.** A skill without its own `content`/`files` signals applies to every chunk of its
  technology. Keep that for the few "core" skills.
- **`tier`.** `essential` covers serious production problems: security, data loss, crashes, leaks/OOM,
  overload, costly performance. `full` covers lower-impact topics: accessibility, conventions, edge
  cases. It is inherited from the nearest `_group.yaml` and defaults to `essential`.
- **`[full]` bullets.** A bullet marked `[full]` is left out at the essential depth.
- **`alwaysOn`.** Reserved for `practice/general-bugs` and `security/core`.

## Versions

Versions come from manifests (`package.json`, `go.mod`, `pyproject.toml`, `composer.json`, `Gemfile`,
`pom.xml`, `*.csproj`, …), version files (`.nvmrc`, `.python-version`, …) and official image tags. A
version is the lowest one the manifest allows, per package root.

Range syntax:
- `>=13`, `<1.22`;
- `>=18 <19`;
- `^3`, `~3.2`;
- `3.x`, `3.12` (all 3.12.x);
- `||` for alternatives.

An unknown version passes every gate.

## Your own skills

Put skills in `~/.code-reviewer/skills/` (yours) or `<repo>/.code-reviewer/skills/` (the project's), in
the same tree layout. A skill with the same id replaces the builtin one. Your skills inherit the builtin
`_group.yaml` of their folder, so `.code-reviewer/skills/javascript/react/our-hooks.md` activates only for
React chunks.

Project skills come from the repository under review and are therefore limited:
- they cannot be always-on, and cannot replace the always-on skills;
- files are at most 32 KiB, and at most 200 are loaded;
- globs are validated (no extglobs, at most one `*` per path segment);
- every regex is run against adversarial input with a time limit before it is used;
- they are ignored when the reviewed change itself touches `.code-reviewer/`.

```bash
code-reviewer skills lint                      # validate .code-reviewer/skills (or pass a directory)
code-reviewer skills show javascript/react/effects
code-reviewer skills detect                    # which skills apply to this repository
```

Contributors to the builtin library can validate one subtree with
`SKILLS_SUBTREE=javascript/react npx vitest run test/skills-library.test.ts`. It checks:
- the tree and the group files;
- the frontmatter and ids;
- regex safety on adversarial inputs;
- that every glob matches an example path;
- version ranges;
- sizes.
