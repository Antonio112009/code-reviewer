---
name: Build scripts (build.rs)
description: build.rs pitfalls — cfg!/#[cfg] describing the host instead of the target, rerun-if-changed rules causing stale builds, writing outside OUT_DIR, the double-colon cargo syntax needing Rust 1.77, and network access at build time.
priority: 52
tier: full
tags: [CWE-1104, CWE-829]
activation:
  files: ['build.rs']
  content:
    - '\bcargo::?(?:rerun-if-changed|rerun-if-env-changed|rustc-link-lib|rustc-link-search|rustc-cfg|rustc-env|warning)\b'
    - '\bCARGO_CFG_\w+|\bOUT_DIR\b'
sources:
  - https://doc.rust-lang.org/cargo/reference/build-scripts.html
  - https://doc.rust-lang.org/cargo/reference/environment-variables.html#environment-variables-cargo-sets-for-build-scripts
---
- **Host vs target**: `cfg!(target_os = ..)` or `#[cfg(windows)]` inside `build.rs` describe the machine running the script, not the compilation target → wrong libraries or flags when cross-compiling. Fix: read `CARGO_CFG_TARGET_OS`, `CARGO_CFG_TARGET_ARCH`, `TARGET`.
- **Rerun rules**: once any `rerun-if-changed` is printed, Cargo reruns only for the listed paths → forgotten inputs (proto, SQL, templates, env vars without `rerun-if-env-changed`) produce stale generated code. Fix: list every input.
- **Writing outside `OUT_DIR`**: generating into `src/` or the workspace breaks read-only and vendored builds, `cargo publish` verification and parallel builds. Fix: write to `OUT_DIR` and `include!` from there.
- **`cargo::` syntax needs Rust 1.77**: `cargo::rustc-cfg=..` fails for users whose toolchain is below 1.77 while `rust-version` claims older support. Fix: single-colon `cargo:` or raise `rust-version`.
- **Network access at build time**: downloading or probing services from `build.rs` breaks offline and sandboxed builds and runs unverified code on build machines. Fix: vendor inputs, gate downloads behind opt-in features.
