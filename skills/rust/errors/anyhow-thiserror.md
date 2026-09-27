---
name: anyhow and thiserror error types
description: Error-type pitfalls with anyhow/thiserror/Box<dyn Error> — chains hidden by Display, stringified errors that defeat downcasting, over-broad #[from] variants, duplicated or missing sources and eager context formatting.
priority: 55
tags: [CWE-755, CWE-778]
activation:
  content:
    - '\banyhow!\(|\bthiserror::Error\b'
    - '\b(?:error|warn)!\([^)\n]{0,80}(?:\{\}|\{e\}|\{err\}|%e\b|%err\b)'
    - '#\[error\('
    - '\.(?:context|with_context)\('
    - '\bbail!\(|\bensure!\('
    - '\bBox<dyn\s+(?:std::error::)?Error\b'
    - '\.downcast(?:_ref|_mut)?::<'
    - '\.map_err\(\s*\|\w+\|\s*\w+\.to_string\(\)\s*\)'
sources:
  - https://docs.rs/anyhow/latest/anyhow/struct.Error.html#display-representations
  - https://docs.rs/thiserror/latest/thiserror/
  - https://doc.rust-lang.org/std/error/trait.Error.html#method.source
---
- **`{}` hides the cause**: logging an `anyhow::Error` with `{}` or `to_string()` prints only the outermost context ("failed to load config") → root cause missing in logs and alerts. Fix: `{:#}` (chain) or `{:?}` (chain + backtrace).
- **Stringified errors**: `anyhow!(e.to_string())`, `map_err(|e| e.to_string())` or `Box::<dyn Error>::from(format!(..))` drop the type → `downcast_ref::<io::Error>()` and `sqlx::Error` matching fail, so not-found or retry paths never trigger. Fix: `.context(..)` (downcasting still reaches the original).
- [full] **Over-broad `#[from]`**: one `#[from] io::Error` (or `sqlx::Error`) variant makes every `?` land there → callers cannot tell "config missing" from "disk full". Fix: per-operation `map_err` into distinct variants.
- [full] **Source printed twice or lost**: a thiserror message interpolating `{0}`/`{source}` while that field is also `#[source]`/`#[from]` repeats text in `{:#}` and tracing output; a hand-written `Error` without `source()` breaks the chain. Fix: display or expose as source, not both.
- [full] **Eager context**: `.context(format!(..))` allocates on every success in hot paths. Fix: `.with_context(|| format!(..))`.
