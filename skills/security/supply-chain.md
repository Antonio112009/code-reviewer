---
name: Dependency supply chain
description: Risky dependency and build-input changes — suspicious new packages, install-time code, off-registry sources, dependency confusion, registry and trust settings, lockfile tampering, unenforced locks, floating versions and misplaced dependencies.
category: practice
priority: 60
tier: essential
tags:
  - CWE-1357
  - CWE-829
  - CWE-494
  - CWE-427
  - OWASP-A03
activation:
  languages:
    - json
    - yaml
    - toml
    - text
    - dockerfile
    - shell
    - makefile
    - groovy
    - javascript
    - typescript
    - python
    - ruby
    - kotlin
    - swift
    - elixir
    - go
    - rust
  files:
    - "**/{package.json,package-lock.json,npm-shrinkwrap.json,yarn.lock,pnpm-lock.yaml,pnpm-workspace.yaml,bun.lock,bun.lockb,deno.json,deno.lock}"
    - "**/{.npmrc,.yarnrc,.yarnrc.yml,.pnpmfile.cjs,pip.conf,pip.ini,.pypirc,uv.toml,NuGet.config,nuget.config,settings.xml}"
    - "**/{requirements*.txt,constraints*.txt,pyproject.toml,poetry.lock,uv.lock,Pipfile,Pipfile.lock,setup.py,setup.cfg,pdm.lock}"
    - "**/{go.mod,go.sum,go.work,Cargo.toml,Cargo.lock,build.rs,.cargo/config.toml,Gemfile,Gemfile.lock,composer.json,composer.lock}"
    - "**/{pom.xml,build.gradle,build.gradle.kts,settings.gradle,settings.gradle.kts,libs.versions.toml,gradle-wrapper.properties}"
    - "**/{*.csproj,*.fsproj,Directory.Packages.props,Directory.Build.props,packages.lock.json,pubspec.yaml,pubspec.lock,mix.exs,mix.lock,Package.swift,Package.resolved,Podfile,Podfile.lock}"
    - "**/{Dockerfile,Dockerfile.*,*.Dockerfile,*.dockerfile,Containerfile,Containerfile.*}"
    - "**/patches/*.patch"
  content:
    - '"(?:pre|post)?install"\s*:|"prepare"\s*:|\btrustedDependencies\b|\bonlyBuiltDependencies\b|\bneverBuiltDependencies\b|"(?:overrides|resolutions)"\s*:'
    - \bregistry\s*=\s*["']?https?:|\b_authToken\b|\bstrict-ssl\s*=|\bnpmRegistryServer\b|--(?:extra-)?index-url\b|--trusted-host\b|\ballowInsecureProtocol\b|\b(?:GOSUMDB|GOINSECURE|GONOSUMDB|GONOSUMCHECK|GOPROXY|PIP_(?:EXTRA_)?INDEX_URL|UV_(?:EXTRA_)?INDEX_URL|NPM_CONFIG_REGISTRY)\b|\bunsafe-best-match\b
    - \b(?:curl|wget)\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\b(?:npx|bunx|uvx|pipx\s+run)\s+(?:-y\s+)?[@\w]|\bgo\s+(?:run|install)\s+\S+@(?:latest|master|main)\b
    - \bnpm\s+(?:ci|install|i)\b|--(?:no-)?frozen-lockfile\b|--immutable\b|--require-hashes\b|\b(?:pip3?|uv\s+pip)\s+install\b|\buv\s+sync\b|\bpoetry\s+install\b|\bbundle\s+install\b|\bcomposer\s+(?:install|update)\b|\bcargo\s+install\b|\b(?:yarn|pnpm|bun)\s+(?:install|add|i)\b
---
- **Suspicious new package**: typosquats, lookalike or scope-confused names, AI-hallucinated names, brand-new or single-maintainer packages → attacker code in builds and runtime. Fix: verify publisher and age.
- **Install-time code**: new `preinstall`/`postinstall`/`prepare` scripts, packages added to `trustedDependencies`/`onlyBuiltDependencies`, networked `build.rs` or `setup.py` → code runs on every install. Fix: remove or justify.
- **Off-registry sources**: git, tarball, `file:` or GitHub-shorthand dependencies, npm aliases (`npm:x@1`), go.mod `replace` to forks, Cargo `git`/`[patch]` → unreviewed code without registry integrity. Fix: registry releases.
- **Resolution settings**: pip `--extra-index-url` serving internal names (public uploads win), registry changes in `.npmrc` or `pip.conf`, `strict-ssl=false`, `GOSUMDB=off`, committed `_authToken` → hijacked packages, leaked tokens. Fix: one index per package.
- **Lockfile tampering**: lockfile edits without matching manifest changes, `resolved` URLs on unexpected hosts, `integrity` changed for the same version, dropped `go.sum` lines, deleted lockfiles → swapped artifacts. Fix: regenerate and diff.
- **Unenforced lock**: CI or Dockerfiles switching `npm ci` to `npm install`, dropping `--frozen-lockfile`, `--immutable`, `--locked` or `--require-hashes` → builds install unreviewed versions. Fix: frozen installs.
- **Floating versions**: `*`, `latest`, open `>=` ranges or branch refs; unversioned `npx`/`uvx` or `go run …@latest` in scripts; downgrades → malicious or vulnerable releases installed. Fix: pins plus lockfile.
- **Misplaced dependency**: runtime imports declared only in `devDependencies` or test extras, removed dependencies still imported → production installs (`--omit=dev`) crash on import. Fix: declare where used.
- **Opaque inputs**: `FROM` switched to unofficial or lookalike images, remote downloads without checksum (`curl | sh`, `ADD <url>`, Gradle `distributionUrl`), vendored minified bundles, binaries or patches → hidden payloads. Fix: official images, checksums.
