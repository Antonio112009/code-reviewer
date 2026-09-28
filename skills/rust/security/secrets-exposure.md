---
name: Secrets in Debug, tracing and serialization
description: Credentials leaking through derived Debug, #[instrument] argument recording, Serialize on user/config structs, secret values in panic or error messages, and long-lived key material in plain Strings.
priority: 70
tags: [CWE-532, CWE-209, CWE-200, CWE-316]
activation:
  content:
    - '#\[derive\([^)\n]{0,200}\b(?:Debug|Serialize)\b'
    - '#\[(?:tracing::)?instrument\b'
    - '\bSecret(?:String|Box|Slice)?\b|\bExposeSecret\b|\b[Zz]eroize\b'
    - '(?:[Pp]assword|[Ss]ecret|api_?key|API_?KEY|private_key|[Cc]redential)'
  examples:
    - '#[derive(Debug, Clone)]'
    - '#[instrument(skip(password))]'
    - 'let config: SecretString = SecretString::new(value);'
    - 'let api_key = std::env::var("API_KEY")?;'
sources:
  - https://docs.rs/tracing/latest/tracing/attr.instrument.html
  - https://docs.rs/secrecy/latest/secrecy/
  - https://docs.rs/zeroize/latest/zeroize/
---
- **Derived `Debug` on secret holders**: config, credential and token structs with `#[derive(Debug)]` leak via `{:?}` logs, panic messages, tracing fields and error chains. Fix: redacting manual `Debug`, or `secrecy::SecretString` (0.10: `SecretBox<str>`, read via `expose_secret()`).
- **`#[instrument]` records every argument**: by default all arguments become span fields (via `Debug`), and `ret`/`err(Debug)` record results → passwords, tokens and request bodies in logs. Fix: `skip(password)` or `skip_all` plus explicit `fields(..)`.
- **Serialized secrets**: `#[derive(Serialize)]` on user, account or config structs returns `password_hash`, API keys or TOTP seeds in JSON responses and caches. Fix: response DTOs or `#[serde(skip_serializing)]`.
- **Secrets in messages**: `expect(&format!("bad token {t}"))`, `anyhow!("login failed {user}:{pass}")` or logging URLs with `?api_key=` → secrets in logs and crash reports. Fix: log identifiers, not values.
- **Long-lived key material**: keys kept in plain `String`/`Vec<u8>` and cloned freely leave copies in memory, core dumps and swap. Fix: `zeroize`/`secrecy` wrappers, minimal copies (best effort).
