---
name: Regular expression denial of service
description: Backtracking-prone regexes run on untrusted input in single-threaded Node, patterns compiled from user input, and validators applied to unbounded strings.
priority: 70
tags: [CWE-1333, CWE-400]
activation:
  content:
    - '\bnew\s+RegExp\s*\(|\bRegExp\s*\(\s*[^/''"`]'
    - '[+*}]\)[*+{]'
    - '\((?:\\[wsd.]|\.|\[[^\]\n]{1,40}\])[*+]\)[*+]'
  examples:
    - 'const re = new RegExp(pattern);'
    - 'const re = /(a+)+$/;'
    - 'const validator = /(\w+)*$/;'
sources:
  - https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
  - https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop#blocking-the-event-loop-redos
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/escape
---
- **Catastrophic backtracking**: nested or overlapping quantifiers (`(a+)+`, `(\w+\s?)*$`, `(.*,)*`, `(a|aa)+`) applied to request data → exponential matching time; V8 has no regex timeout, so one request freezes the whole Node process. Fix: rewrite unambiguously, cap input length first, or use RE2 (`re2` package).
- **Patterns built from input**: `new RegExp(userInput)` lets attackers submit an evil pattern (ReDoS), change search semantics, or crash the handler with a `SyntaxError`. Fix: `RegExp.escape` (Node ≥24) or `escape-string-regexp`; never compile user patterns without a linear-time engine.
- **Validators on unbounded input**: email/URL/header regexes run before any length check (signup, login, webhook parsing) → cheap DoS. Fix: enforce length limits before matching; prefer vetted, linear validators.
