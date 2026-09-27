---
name: Swallowed and lossy errors
description: Results discarded with let _/.ok(), defaults on parse failure, errors turned into None, failed items dropped from batches, context-free error mapping and cleanup errors lost in Drop.
priority: 58
tags: [CWE-252, CWE-390, CWE-391, CWE-754]
activation:
  content:
    - '\blet\s+_\s*='
    - '\.ok\(\)\s*[;?]|\.ok\(\)\.flatten\(\)'
    - '\.unwrap_or(?:_default)?\('
    - '\bfilter_map\(\s*(?:Result::ok|\|\w+\|\s*\w+\.ok\(\))'
    - '\.map_err\(\s*\|_\|'
    - '\bimpl\s+Drop\s+for\b'
sources:
  - https://doc.rust-lang.org/std/result/index.html#results-must-be-used
  - https://doc.rust-lang.org/std/result/enum.Result.html#method.ok
  - https://doc.rust-lang.org/std/fs/struct.File.html
---
- **Discarded side effects**: `let _ = fs::remove_file(..)`, `let _ = file.sync_all()`, `.ok();` or `let _ = conn.execute(..)` on writes, commits and deletes → silent data loss or leaks. Fix: `?`, or log when ignoring is intended.
- **Defaults on parse failure**: `parse().unwrap_or(0)`/`unwrap_or_default()` for request or config values → invalid input becomes 0 or empty (limit 0, empty allow-list read as "allow all"). Fix: return a validation error.
- **Errors become "absent"**: `.ok()?` in functions returning `Option` makes permission or corruption errors look like "not found" → silent fallback to defaults. Fix: return `Result<Option<T>, E>`.
- **Dropped items in batches**: `filter_map(Result::ok)`/`flatten()` over parsed rows, messages or files skips failures while reporting success. Fix: `collect::<Result<Vec<_>, _>>()?`, or count and log failures.
- **Context-free mapping**: `map_err(|_| Error::Internal)` or a blanket `From<io::Error>` discards which file or call failed and the source chain → undiagnosable incidents, wrong retries. Fix: keep the source (`#[source]`, `.context(..)`).
- **Cleanup only in `Drop`**: close, flush, rollback or unlock performed in `Drop` cannot report failure. Fix: explicit `close()`/`commit()` returning `Result`; `Drop` as fallback.
