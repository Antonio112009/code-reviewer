---
name: Errors, exceptions and warnings
description: PHP error-handling traps — catch (Exception) missing Error, unqualified Exception in namespaces, the @ operator and error_reporting() in handlers (8.0), false-returning functions that only warn, return in finally, and arguments leaking into stack traces.
priority: 58
tags: [CWE-755, CWE-252, CWE-209]
activation:
  content:
    - '\bcatch\s*\(\s*\\?(?:Exception|Throwable|Error)\b'
    - '\bset_(?:error|exception)_handler\s*\(|\berror_reporting\s*\('
    - '[=(,!\s]@\\?[a-z_]\w*\s*\(|\bfinally\s*\{'
    - '\b(?:file_get_contents|file_put_contents|fopen|mkdir|rename|unlink|copy)\s*\('
sources:
  - https://www.php.net/manual/en/language.errors.php7.php
  - https://www.php.net/manual/en/migration80.incompatible.php
  - https://www.php.net/manual/en/language.exceptions.php
  - https://www.php.net/manual/en/class.sensitiveparameter.php
---
- **Exception is not Throwable**: `catch (Exception $e)` misses `TypeError`, `ValueError`, `ArgumentCountError`, `DivisionByZeroError`, `UnhandledMatchError` (many PHP 8 warnings became these) → rollback and cleanup are skipped. Fix: `catch (\Throwable)` at boundaries, `finally`.
- **Namespace trap**: in a namespaced file, `catch (Exception $e)` without `use Exception;` refers to `App\…\Exception`, a class that does not exist → nothing is ever caught. Fix: `\Exception`.
- **@ and handlers**: since 8.0 `@` no longer silences fatal errors and `error_reporting()` inside a handler is no longer 0 under `@` → handlers testing `=== 0` start throwing. Fix: `!(error_reporting() & $errno)`.
- **Warning plus false**: `file_get_contents`, `file_put_contents`, `fopen`, `mkdir`, `rename`, `unlink` return `false` and only warn → execution continues with `false` (empty files, lost writes). Fix: check `=== false` or convert warnings to `ErrorException`.
- **return in finally**: a `return` (or `break`) inside `finally` discards the in-flight exception and the `try` result → failures are silently swallowed.
- **Arguments in traces**: stack traces include argument values (passwords, tokens, card numbers) when `zend.exception_ignore_args` is off → secrets in logs and error pages. Fix: `#[\SensitiveParameter]` (8.2), keep the INI on in production.
