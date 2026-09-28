---
name: serde derive attributes
description: serde attributes that silently accept bad data — defaults hiding missing fields, ignored unknown fields (and flatten), untagged first-match, skip vs skip_serializing, Deserialize bypassing validation and rename_all on enums.
priority: 56
tags: [CWE-20, CWE-1287]
activation:
  content:
    - '#\[serde\('
    - 'derive\([^)\n]{0,200}\bDeserialize\b'
  examples:
    - '#[serde(default)]'
    - '#[derive(Debug, Deserialize)]'
sources:
  - https://serde.rs/container-attrs.html
  - https://serde.rs/field-attrs.html
  - https://serde.rs/enum-representations.html
---
- **Defaults hide missing input**: container or field `#[serde(default)]` turns absent required fields into 0, `false` or empty → typos and truncated payloads pass as valid (limit 0, empty allow-list). Fix: default only truly optional fields; `Option<T>` when absence matters.
- **Unknown fields ignored**: without `#[serde(deny_unknown_fields)]`, config typos (`requre_tls: true`) are dropped silently and the insecure default applies; it is not supported together with `#[serde(flatten)]`. Fix: deny unknown fields on configs; avoid `flatten` there.
- **`untagged` picks the first match**: variants are tried in order and the first that deserializes wins → a permissive variant (all-optional struct, `Value`, `String`) listed early swallows every input. Fix: most specific first, or a tagged representation.
- **`skip` vs `skip_serializing`**: `#[serde(skip)]` also resets the field to `Default` when deserializing (cache, DB, queue payloads lose it). Fix: `skip_serializing` for output-only hiding.
- **Derive bypasses invariants**: `#[derive(Deserialize)]` on newtypes with invariants (`Email(String)`, `Percent(u8)`) skips their validating constructors → invalid states from input. Fix: `#[serde(try_from = "String")]`.
- [full] **Enum renaming**: `rename_all` on an enum renames variants, not fields inside struct variants → mismatched wire names. Fix: `rename_all_fields`.
