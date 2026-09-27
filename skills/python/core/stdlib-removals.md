---
name: Removed stdlib modules and APIs
description: Modules and APIs removed in Python 3.12 (distutils, imp, asyncore), 3.13 (PEP 594 dead batteries), 3.14 (ast.Num, pkgutil loaders, URLopener) and 3.15 (sre_*, load_module) that break imports or calls after an interpreter upgrade.
priority: 60
activation:
  content:
    - "^[ \\t]*(?:from|import)\\s+(?:distutils|imp|asynchat|asyncore|smtpd|cgi|cgitb|crypt|telnetlib|pipes|imghdr|sndhdr|audioop|aifc|chunk|mailcap|msilib|nis|nntplib|ossaudiodev|spwd|sunau|uu|xdrlib|lib2to3|sre_compile|sre_parse|sre_constants|pkg_resources)\\b"
    - "\\b(?:assertEquals|assertNotEquals|assertRegexpMatches|assertNotRegexpMatches|assertRaisesRegexp|assertDictContainsSubset|failUnless\\w*|failIf\\w*)\\s*\\("
    - "\\bSafeConfigParser\\b|\\.readfp\\s*\\(|\\bssl\\.(?:wrap_socket|match_hostname)\\b|\\blocale\\.(?:format|resetlocale)\\s*\\(|\\btyping\\.(?:io|re)\\b"
    - "\\bast\\.(?:Num|Str|Bytes|NameConstant|Ellipsis)\\b|\\bdef\\s+visit_(?:Num|Str|Bytes|NameConstant)\\b|\\bpkgutil\\.(?:find_loader|get_loader)\\b|\\b(?:set|get)_child_watcher\\b|\\b(?:Fancy)?URLopener\\b|\\bsqlite3\\.version\\b"
    - "\\bload_module\\s*\\(|\\bis_reserved\\s*\\(|\\bjava_ver\\s*\\(|\\bCGIHTTPRequestHandler\\b"
sources:
  - https://docs.python.org/3/whatsnew/3.12.html#removed
  - https://docs.python.org/3/whatsnew/3.13.html#removed-modules-and-apis
  - https://docs.python.org/3/whatsnew/3.14.html#removed
  - https://docs.python.org/3.15/whatsnew/3.15.html#removed
---
- **Rule**: these raise ImportError/AttributeError as soon as the code runs on the listed Python, even when CI on an older interpreter is green → flag new uses and upgrades that keep them.
- **3.12**: `distutils` (`strtobool`, `LooseVersion` → `packaging`), `imp` (→ `importlib`), `asyncore`/`asynchat`/`smtpd`, `SafeConfigParser`/`readfp`, `ssl.wrap_socket`, unittest aliases (`assertEquals`, `failUnless`…); new venvs lack setuptools/`pkg_resources`.
- **3.13 (PEP 594)**: `cgi`, `cgitb`, `crypt`, `telnetlib`, `pipes`, `imghdr`, `audioop`, `nntplib`, `uu`, `xdrlib`, `spwd`, `lib2to3` and other dead batteries; `locale.resetlocale`, `typing.io`/`typing.re`.
- **3.14**: `ast.Num`/`Str`/`NameConstant` (custom `visit_Num` is never called), asyncio child watchers, `pkgutil.find_loader`, `URLopener`, `sqlite3.version`; sqlite3 named placeholders with a sequence raise ProgrammingError.
- **3.15**: `sre_compile`/`sre_parse`, `load_module()`, `PurePath.is_reserved()`, keyword-argument `NamedTuple(...)`, zero-field `TypedDict("TD")`, `CGIHTTPRequestHandler`.
- **Fix**: `packaging`, `importlib.util.find_spec`, `email.message` (cgi), `subprocess` + `shlex.quote` (pipes), `ast.Constant`, `os.path.isreserved`, or the `standard-*` PyPI redistributions.
