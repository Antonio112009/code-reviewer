---
name: React Compiler
description: Code that breaks or silently deoptimizes under the React Compiler (1.0+) — rule violations that get memoized, identity-dependent logic, interior-mutable libraries and misused 'use no memo'.
priority: 57
activation:
  content:
    - "['\"]use (?:no )?memo['\"]"
    - "\\b(?:babel-plugin-react-compiler|react-compiler-runtime)\\b"
    - "\\breactCompiler\\s*:"
    - "\\b(?:useReactTable|watch)\\s*\\("
  examples:
    - "'use no memo';"
    - "plugins: ['babel-plugin-react-compiler']"
    - "reactCompiler: true,"
    - "const table = useReactTable({ data, columns });"
sources:
  - https://react.dev/learn/react-compiler/debugging
  - https://react.dev/reference/react-compiler/directives/use-no-memo
  - https://react.dev/reference/eslint-plugin-react-hooks/lints/incompatible-library
  - https://react.dev/blog/2025/10/07/react-compiler-1
---
- **Rule violations get memoized**: mutating props, state or values after rendering them, or reading/writing `ref.current` during render → compiled components can keep stale output. Fix: pure renders; enable the `eslint-plugin-react-hooks` compiler rules.
- **Identity-dependent logic**: effects or caches that relied on deps changing identity every render fire less often once compiled → missed syncs. Fix: depend on real values.
- **Interior-mutable libraries**: react-hook-form `watch()`, TanStack Table `useReactTable()` or MobX `observer` return objects that change without a new identity → compiled components render stale data. Fix: `useWatch`, or `'use no memo'` there.
- **Silent directive typos**: `'use no memo'` not first in the function/file, in backticks or misspelled is ignored; left in place it hides the real bug. Fix: exact directive at the top, plus a removal ticket.
- **Removing manual memo blindly**: deleting `useMemo`/`useCallback` that feed effect deps is safe only where the compiler really compiles that code (bail-outs, excluded files) → otherwise effects re-run every render.
- **Unpinned compiler**: `babel-plugin-react-compiler` on a caret range can change what gets memoized on any install → behaviour shifts without code changes. Fix: exact version (`--save-exact`) when test coverage is thin; React 17/18 also need `target` + `react-compiler-runtime`.
