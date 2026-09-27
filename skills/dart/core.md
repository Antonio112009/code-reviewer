---
name: Dart
description: Dart runtime defects, such as null-assertion and empty-collection errors, unawaited futures, misused streams and completers, JSON cast failures, web integer precision, fixed-length and immutable list errors, identity equality on collections, isolate message failures and missing timeouts.
category: language
priority: 50
tier: essential
tags:
  - CWE-248
  - CWE-252
  - CWE-681
  - CWE-400
activation:
  languages:
    - dart
  files:
    - "**/*.dart"
---
- **Null and state errors**: `!` on map lookups or JSON fields, `late` fields read before assignment, `.first`/`firstWhere` without `orElse`, `int.parse` on input → runtime exceptions. Fix: null checks, `firstOrNull`, `tryParse`.
- **Unawaited futures**: async calls without `await`, `forEach(async …)`, `try` around an un-awaited call → escaped errors, ordering races. Fix: `await`, `for` loops, `Future.wait`.
- **Streams and completers**: single-subscription streams listened twice, `listen` without `onError`, controllers never closed (endless `await for`), a `Completer` completed twice or never on error paths → `StateError`, unhandled errors, hangs. Fix: close in `finally`.
- **JSON casts**: `jsonDecode(s) as List<String>` or `as Map<String, int>` (runtime type is `dynamic`), `as int` on `1.0` → `TypeError`. Fix: `List<String>.from`, `(v as num).toInt()`.
- **Web integers**: under dart2js `int` is a JS double, so IDs above 2^53 lose precision and bitwise ops are 32-bit (not on dart2wasm) → wrong records. Fix: `String` IDs, `BigInt`.
- **Fixed and immutable lists**: `add` on `const []` defaults, `List.unmodifiable` or fixed-length `List.filled` results; `List.filled(n, [])` shares one inner list → `UnsupportedError`, rows changing together. Fix: `[...list]`, `List.generate`.
- **Collection equality**: `==` on `List`/`Map`/`Set` values, or on classes and records holding them, compares identity → missed change detection, duplicate keys. Fix: `listEquals`, `DeepCollectionEquality`.
- **Isolate messages**: `Isolate.run`/`compute` closures capturing `this`, sockets, `ReceivePort`s or native handles → runtime `ArgumentError`; on the web `compute` runs on the UI thread. Fix: top-level functions, plain data.
- **No timeouts**: `http.get`, `HttpClient` or `Socket.connect` without `.timeout` or `connectionTimeout` → requests hang forever. Fix: explicit timeouts.
