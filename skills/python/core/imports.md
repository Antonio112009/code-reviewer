---
name: Imports and module state
description: Circular imports, from-imports copying bindings (stale values, patches that do nothing), import-time side effects before fork, modules shadowing stdlib names, sys.path hacks and lazy imports (PEP 810, 3.15).
priority: 52
activation:
  content:
    - "^[ \\t]*lazy\\s+(?:import|from)\\s|\\b__lazy_modules__\\b"
    - "\\bimportlib\\.reload\\s*\\(|\\bsys\\.(?:path|modules)\\b"
    - "^[ \\t]+(?:from\\s+[\\w.]+\\s+)?import\\s+\\w"
    - "^[A-Za-z_]\\w*\\s*=\\s*[\\w.]*(?:connect|create_engine|Client|client|Redis|MongoClient|Session|ClientSession|AsyncClient|Pool|resource|from_url)\\s*\\("
  files:
    - "**/{random,email,logging,json,typing,types,string,socket,select,signal,queue,test,code,copy,secrets,calendar,inspect,token,abc,asyncio,http,html,xml,csv,io,re,time,datetime,uuid,decimal,enum,numbers,operator,platform,ssl,struct,warnings,requests}.py"
sources:
  - https://docs.python.org/3/faq/programming.html#how-can-i-have-modules-that-mutually-import-each-other
  - https://docs.python.org/3/library/unittest.mock.html#where-to-patch
  - https://docs.python.org/3/whatsnew/3.13.html#improved-error-messages
  - https://docs.python.org/3.15/whatsnew/3.15.html#pep-810-explicit-lazy-imports
---
- **Circular imports**: `from a import b` while `a` is still initializing (mutual imports, `__init__.py` re-exports) raises "partially initialized module" or sees half-defined names, often only for some entry points. Fix: import modules, not names; break the cycle.
- **`from x import name` copies the binding**: later rebinding in `x` (reloaded settings, feature flags set at startup, `mock.patch("x.name")`) is invisible to modules that imported the name → stale values, patches that do nothing. Fix: `import x` and read `x.name`.
- **Import-time side effects**: module-level DB/HTTP clients, threads, file reads or env parsing run on every import (tests, CLIs, `--help`) and before fork, so gunicorn/multiprocessing workers share one connection. Fix: lazy factories or app-startup hooks.
- **Shadowed module names**: a local `random.py`, `email.py`, `logging.py`, `test.py` or `requests.py` on `sys.path` hides the real module → AttributeError/ImportError far away. Fix: rename it.
- **`sys.path` and `reload()` hacks**: `sys.path.insert` makes resolution depend on the working directory; `importlib.reload()` doesn't update existing references or instances. Fix: proper packages and entry points.
- **Lazy imports (3.15)**: `lazy import x` or `__lazy_modules__` (PEP 810) defer ImportError and module side effects (registries, plugin decorators, monkeypatches) to first attribute use → empty registries, late failures. Fix: import side-effect modules eagerly.
