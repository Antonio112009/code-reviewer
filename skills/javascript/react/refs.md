---
name: Refs and DOM access
description: useRef / ref callback defects — refs used as render state, re-attaching inline ref callbacks, React 19 ref-cleanup semantics, refs to function components, stale imperative handles and useId values in CSS selectors.
priority: 58
activation:
  content:
    - "\\buse(?:Ref|ImperativeHandle)\\s*[<(]"
    - "\\b(?:createRef|forwardRef)\\s*[<(]"
    - "\\bref=\\{"
    - "\\buseId\\s*\\("
sources:
  - https://react.dev/reference/react/useRef
  - https://react.dev/reference/react-dom/components/common
  - https://react.dev/blog/2024/04/25/react-19-upgrade-guide
  - https://github.com/facebook/react/blob/main/CHANGELOG.md
---
- **Ref as render state**: `ref.current` read to decide output or written during render → no re-render on change, inconsistent UI under concurrency and the compiler. Fix: state for rendered values; refs only in effects/handlers or lazy init.
- **Inline ref callbacks**: a new callback function each render is detached and re-attached every render → observers, listeners or focus logic re-run. Fix: a stable (`useCallback`) callback with symmetric cleanup.
- **Cleanup return (19)**: a ref callback returning a function — e.g. `ref={el => observe(el)}` where `observe` returns an unsubscribe — is treated as cleanup and is no longer called with `null` → `null`-branch teardown never runs.
- **Ref on function components**: before 19 a `ref` on a function component without `forwardRef` is dropped → `ref.current` stays `null`; in 19 `ref` is a plain prop and `element.ref` is deprecated (`element.props.ref`).
- **Stale imperative handle**: `useImperativeHandle` without a deps array, or with missing deps → the handle is rebuilt every render or exposes stale closures to the parent.
- **useId in selectors**: before 19.1 `useId()` returns values like `:r1:` → `querySelector('#' + id)` throws a SyntaxError. Fix: `getElementById` or `CSS.escape`.
