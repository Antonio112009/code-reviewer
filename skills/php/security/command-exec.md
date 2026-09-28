---
name: Shell commands and mail()
description: Command and argument injection through exec/shell_exec/system/passthru/popen/proc_open and backticks, escapeshellcmd misuse, option injection, mail() fifth-parameter and header injection, unchecked exit codes.
priority: 80
tags: [CWE-78, CWE-88, CWE-93]
activation:
  content:
    - '\b(?:exec|shell_exec|system|passthru|popen|proc_open|pcntl_exec)\s*\('
    - '\bescapeshell(?:arg|cmd)\s*\(|`[^`\n]{0,200}\$'
    - '\bmail\s*\('
  examples:
    - 'exec("convert " . $filename . " -resize 50% output.png");'
    - '$escaped = escapeshellarg($userInput);'
    - '$files = `ls $dir`;'
    - 'mail($to, $subject, $body, $headers);'
sources:
  - https://www.php.net/manual/en/function.escapeshellcmd.php
  - https://www.php.net/manual/en/function.proc-open.php
  - https://www.php.net/manual/en/function.mail.php
  - https://www.php.net/manual/en/migration85.deprecated.php
---
- **Shell strings**: `exec`, `shell_exec`, `system`, `passthru`, `popen`, backticks (deprecated in 8.5) and string-form `proc_open` run through `/bin/sh` → any unescaped value is command injection. Fix: `proc_open([$bin, ...$args], …)` (array form, 7.4+) or Symfony Process with an argument array.
- **escapeshellcmd**: escapes metacharacters but not spaces or dashes, so input still adds arguments (`--output=/var/www/x.php`). Fix: `escapeshellarg()` per argument; never escape a whole command line.
- **Option injection**: values starting with `-` become options even when quoted or passed as an array (`tar --checkpoint-action`, `curl -o`, `git --upload-pack`, `find -exec`) → file writes, RCE. Fix: `--` before positional arguments, reject a leading `-`.
- **mail() parameters**: user data in the fifth argument (`"-f$from"`) injects sendmail options (`-X` writes a log file → webshell); CR/LF in `$additional_headers` or the subject adds Bcc/To headers. Fix: validate addresses, strip newlines, use a mailer library.
- **Exit codes ignored**: `exec($cmd, $out)` without the third argument, or `shell_exec()` (null on failure, no status) → failed backups or conversions look successful. Fix: check the exit code and stderr.
