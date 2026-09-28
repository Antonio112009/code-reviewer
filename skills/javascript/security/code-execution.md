---
name: Dynamic code execution and unsafe deserialization
description: eval, new Function, string timers and node:vm on untrusted input, vm2 sandbox escapes, dynamic require/import of user-controlled paths, and deserializers that execute code (node-serialize, js-yaml 3.x load).
priority: 80
tags: [CWE-94, CWE-95, CWE-502, A05:2025, A08:2025]
activation:
  content:
    - '\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*[''"`]'
    - '\bset(?:Timeout|Interval)\s*\(\s*[''"`]'
    - '\bvm\.\w+\s*\(|[''"](?:node:)?vm[''"]|\bvm2\b|\bisolated-vm\b'
    - '\b(?:node-serialize|serialize-javascript|funcster)\b|\bunserialize\s*\(|\bv8\.deserialize\s*\('
    - '\bjs-yaml\b|\byaml\.load(?:All)?\s*\('
    - '\brequire\s*\(\s*[^''"`\s)]|\bimport\s*\(\s*[^''"`\s)]'
  examples:
    - 'eval(userInput);'
    - 'setTimeout("doStuff()", 100);'
    - 'vm.runInNewContext(code, sandbox);'
    - 'const obj = unserialize(data);'
    - 'const doc = yaml.load(input);'
    - 'const plugin = require(pluginName);'
sources:
  - https://nodejs.org/api/vm.html#vm-executing-javascript
  - https://github.com/patriksimek/vm2/security/advisories
  - https://github.com/nodeca/js-yaml/blob/master/CHANGELOG.md
  - https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html
---
- **Evaluating strings**: `eval`, `new Function(src)`, `setTimeout('…')` or formula/rule engines built on them with any user- or DB-supplied text → remote code execution. Fix: a real parser/interpreter for the expression language, or a lookup table.
- **In-process sandboxes leak**: `node:vm` is documented as not a security mechanism (`this.constructor.constructor('return process')()` reaches the host); `vm2` published ~70 advisories in 2026, many host-RCE escapes (fixes up to 3.12.2). Fix: a separate process or container without secrets; keep vm2 patched if unavoidable.
- **User-controlled module paths**: `require(plugin)`, `import(name)`, `new Worker(file)` built from input or config → arbitrary file execution. Fix: map allowed names to fixed modules.
- **Code-executing deserializers**: `node-serialize` `unserialize` (IIFE payloads), `funcster`, custom revivers that `eval`, js-yaml < 4 `load()` with `!!js/function`, `v8.deserialize` of client data → RCE. Fix: JSON with schema validation; js-yaml ≥ 4 (safe by default).
