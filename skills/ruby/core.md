---
name: Ruby
description: Ruby runtime pitfalls, such as dynamic dispatch, deserialization and pipe-opening calls on untrusted data, line-anchored validation regexes, nil-returning bang methods, string/symbol key mix-ups, memoization and shared-default bugs, over-broad rescue and block returns.
category: language
priority: 52
tier: essential
tags:
  - CWE-470
  - CWE-502
  - CWE-78
  - CWE-625
  - CWE-362
  - OWASP-A05
  - OWASP-A08
activation:
  languages:
    - ruby
    - text
  files:
    - "**/*.{rb,rake,ru,gemspec,thor}"
    - "**/Rakefile"
---
- **Dynamic dispatch**: `send`, `public_send`, `constantize` or `const_get` on request data → arbitrary method or class invocation. Fix: map input through an allowlist.
- **Deserialization**: `Marshal.load`, `YAML.unsafe_load`, `Oj.load` (object mode by default) or `JSON.load` on untrusted bytes → object injection, RCE. Fix: `JSON.parse`, `YAML.safe_load`.
- **Opening input**: `open`, `IO.read` or `URI.open` on user strings (a leading `|` spawns a process; `URI.open` hands non-URLs to `Kernel#open`) → RCE, local file reads, SSRF. Fix: `File.open`, `Net::HTTP`.
- **Line anchors**: validation regex with `^`/`$` matches any line, so `"ok\n<payload>"` passes → bypassed allowlists. Fix: `\A` and `\z`.
- **Bang methods**: `strip!`, `gsub!`, `uniq!`, `compact!` return `nil` when nothing changed → `x = s.strip!` or chains give `nil`, `NoMethodError`. Fix: non-bang forms.
- **Key types**: `JSON.parse(body)[:id]` or YAML string keys read with symbols (or the reverse) → always `nil`. Fix: `symbolize_names: true`, one key type.
- **Memoization**: `@x ||= f(arg)` ignoring the argument, class-level `@x ||=` or `@@var` caches under Puma/Sidekiq threads → wrong or cross-user values, races. Fix: key by args, `Mutex`.
- **Shared defaults**: `Hash.new([])` and `Array.new(n, [])` share one object; mutated constants (`opts = DEFAULTS`) → values bleed across keys and requests. Fix: block forms, `dup`, `freeze`.
- **Rescue scope**: `rescue Exception` swallows `Interrupt`/`SystemExit`; `Timeout.timeout` raises at arbitrary points → ignored Ctrl+C, leaked connections, held locks. Fix: `rescue StandardError`, client timeouts.
- **Block returns**: `return` inside `each`/`map` blocks exits the whole method; `break` in `map` returns the break value → skipped items, wrong types. Fix: `next`.
