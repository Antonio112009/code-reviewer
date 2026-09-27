---
name: Eval-like code execution in Python
description: eval/exec/compile on data, library evaluators (pandas query/eval, sympy sympify, numexpr), dynamic imports and getattr dispatch on request values, ast.literal_eval limits and executing files from writable locations.
priority: 80
tags: [CWE-94, CWE-95, CWE-470, OWASP-A05]
activation:
  content:
    - "(?<![\\w.])(?:eval|exec|compile)\\s*\\("
    - "\\.(?:query|eval)\\s*\\(\\s*(?:f[\"']|[A-Za-z_]\\w*\\s*[,)])|\\b(?:pd|pandas)\\.eval\\s*\\("
    - "\\b(?:sympify|parse_expr|numexpr\\.evaluate)\\s*\\(|\\bliteral_eval\\s*\\("
    - "\\b(?:import_module|__import__)\\s*\\(|\\bgetattr\\s*\\(\\s*\\w+\\s*,\\s*(?!['\"])[^)\\n]{1,60}\\)\\s*\\(|\\bglobals\\s*\\(\\s*\\)\\s*\\["
    - "\\brunpy\\.run_\\w+\\s*\\(|\\bexec\\s*\\(\\s*open\\s*\\("
sources:
  - https://docs.python.org/3/library/functions.html#eval
  - https://docs.python.org/3/library/ast.html#ast.literal_eval
  - https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.query.html
  - https://docs.sympy.org/latest/modules/core.html#module-sympy.core.sympify
---
- **`eval`/`exec`/`compile` on data**: formulas, filters, "config" or template strings from requests, files or the DB passed to `eval`/`exec` → RCE; removing `__builtins__` is not a sandbox. Fix: `ast.literal_eval` for literals, a real parser with allowlisted operations otherwise.
- **Library evaluators**: `DataFrame.query()`/`pandas.eval()`, `sympy.sympify`/`parse_expr` and `numexpr.evaluate` (its sanitizer can be disabled) evaluate Python expressions → user-built filters become code execution. Fix: boolean masks and column allowlists; pass values as variables, never interpolate.
- **Dynamic dispatch on input**: `importlib.import_module(name)`, `__import__`, `getattr(obj, name)(...)` or `globals()[name]` with request-controlled names reach unintended modules and methods (`os.system`, private handlers). Fix: an explicit dict of allowed callables.
- **`ast.literal_eval` is not free**: no code execution, but small inputs can exhaust memory/CPU or crash the process through deep nesting. Fix: cap input size; prefer `json.loads` for data.
- **Code from writable paths**: `exec(open(p).read())`, `runpy.run_path`, or importing `.py` plugins from upload/temp/user-writable directories or a user-controlled `sys.path`/`PYTHONPATH` runs attacker files. Fix: data formats (TOML/JSON) for configuration; read-only code locations.
