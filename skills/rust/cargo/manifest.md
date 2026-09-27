---
name: Cargo manifest settings
description: Cargo.toml and .cargo/config.toml settings with runtime or supply-chain impact — panic=abort, root-only profiles, workspace feature inheritance and resolver defaults, non-additive features, MSRV-aware resolution, unpinned or abandoned crates and target-cpu=native.
priority: 52
tags: [CWE-1104, CWE-1357]
activation:
  content:
    - '^\s*\[(?:profile|features|workspace|patch|replace|target)\b'
    - '\b(?:default-features|resolver|rust-version|panic|overflow-checks|rustflags|edition)\s*='
    - '\bgit\s*=\s*"|\bworkspace\s*=\s*true\b'
    - '^\s*(?:async-std|serde_yaml|serde_yml|bincode)\s*='
sources:
  - https://doc.rust-lang.org/cargo/reference/profiles.html
  - https://doc.rust-lang.org/cargo/reference/resolver.html
  - https://doc.rust-lang.org/edition-guide/rust-2024/cargo-inherited-default-features.html
  - https://rustsec.org/advisories/RUSTSEC-2025-0141.html
---
- **`panic = "abort"`**: turns any panic, even in one tokio task or request, into a process abort; `catch_unwind` and task isolation stop working, while tests still unwind and pass. Fix: keep unwinding for servers, or accept crash-only semantics deliberately.
- [full] **Profiles outside the root are ignored**: `[profile.*]` in a member or dependency manifest (e.g. `overflow-checks = true`) has no effect; only the workspace root counts.
- **Workspace inheritance**: `{ workspace = true, default-features = false }` is ignored before edition 2024 (error in 2024) when the workspace entry keeps defaults; virtual workspaces without `resolver = "2"` use resolver 1. Fix: set both in `[workspace]`.
- [full] **Non-additive features**: mutually exclusive features (`backend-a`/`backend-b`) break when unification enables both. Fix: additive features, `compile_error!` on conflicts.
- **MSRV-aware resolution**: resolver 3 (edition 2024 default) prefers dependency versions matching `rust-version`; a stale `rust-version` pins older releases without fixes. Fix: keep it accurate.
- **Unpinned or abandoned dependencies**: `git = ".."` without `rev` moves on lockfile regeneration; discontinued or unsound crates (`async-std`, `serde_yaml`, `serde_yml` ≤0.0.12, `bincode` per RUSTSEC-2025-0141) get no fixes. Fix: pin `rev`; tokio/smol, serde_norway, postcard.
- **`target-cpu=native`** in committed `rustflags` → binaries use the build host's CPU features and crash (illegal instruction) elsewhere. Fix: a baseline like `x86-64-v2`.
