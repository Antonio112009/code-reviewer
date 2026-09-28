---
name: Shell, argument and DB-API injection
description: Python injection sinks — shell=True/os.system with interpolated values, option injection in argument lists, shlex.quote limits (Windows, nested shells), SQL formatted before cursor.execute, wrong DB-API parameter shapes, identifiers and LIKE wildcards.
priority: 80
tags: [CWE-78, CWE-88, CWE-89, OWASP-A05]
activation:
  content:
    - "\\bshell\\s*=\\s*True\\b|\\bos\\.(?:system|popen)\\s*\\(|\\bcreate_subprocess_shell\\s*\\(|\\bshlex\\.(?:quote|join)\\s*\\("
    - "\\bsubprocess\\.\\w+\\s*\\(\\s*\\[[^\\]\\n]{0,160}\\b(?:git|curl|wget|tar|ssh|scp|rsync|ffmpeg|convert|zip|find)\\b"
    - "\\.execute(?:many|script)?\\s*\\(\\s*(?:f[\"']|[\"'][^\"'\\n]{0,200}[\"']\\s*(?:%|\\.format\\b|\\+))"
    - "\\.execute(?:many)?\\s*\\([^\\n]{0,200}\\+\\s*\\w|\\bexecutescript\\s*\\(|\\bsql\\.(?:SQL|Identifier)\\s*\\("
  examples:
    - 'subprocess.run(f"convert {name}", shell=True)'
    - 'subprocess.run(["git", "clone", url])'
    - 'cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")'
    - 'cursor.execute("SELECT * FROM users WHERE name = " + name)'
sources:
  - https://docs.python.org/3/library/subprocess.html#security-considerations
  - https://docs.python.org/3/library/shlex.html#shlex.quote
  - https://www.psycopg.org/psycopg3/docs/basic/params.html
  - https://peps.python.org/pep-0249/#paramstyle
---
- **`shell=True` with data**: `subprocess.run(f"convert {name}", shell=True)`, `os.system`, `os.popen` or `create_subprocess_shell` with interpolated values → command injection via `;`, `$()`, backticks. Fix: argument lists, `shell=False`.
- **Option injection**: user values starting with `-` in argument lists (`git`, `curl`, `tar`, `ssh`, `rsync`, `find`) become options (`--upload-pack=…`, `-o file`, `-exec`) → RCE without any shell. Fix: `--` before user values; validate the format.
- **`shlex.quote` limits**: correct only for POSIX shells — not `cmd.exe`/PowerShell or strings re-quoted inside `ssh host '…'`; Windows `.bat`/`.cmd` targets are parsed by cmd.exe even with lists. Fix: avoid shells.
- **SQL built before `execute`**: `cursor.execute(f"… {v}")`, `"… %s" % v`, `.format()` or `+` create the SQL text before the driver sees it → SQL injection; `executescript()` takes no parameters. Fix: `execute(sql, (v,))` with the driver's placeholder.
- **Parameter shape**: a bare string or `(value)` instead of `(value,)` breaks binding; `'%s'` or `%d` placeholders are wrong; a literal `%` needs `%%` when params are passed. Fix: `(value,)`, bare `%s`/`?`.
- **Identifiers and LIKE**: table/column names and ORDER BY can't be bound, and `%`/`_` in bound LIKE values are wildcards. Fix: allowlists or `psycopg.sql.Identifier`; escape wildcards.
