---
name: Rules of Hooks
description: Hook call-order violations — conditional or late hooks, components invoked as plain functions, hooks outside render, hook-calling helpers without the use prefix and dynamically chosen hooks.
priority: 64
activation:
  content: ["\\buse[A-Z]\\w*\\s*[<(]"]
  examples:
    - "const [value, setValue] = useState(0);"
sources:
  - https://react.dev/reference/rules/rules-of-hooks
  - https://react.dev/learn/reusing-logic-with-custom-hooks
---
- **Conditional or late hook**: a hook inside `if`, `&&`, a loop, a callback, `try/catch` or after an early `return` → call order changes: state is swapped or React throws "Rendered more hooks…". Fix: call it unconditionally at the top.
- **Component called as a function**: `{Row(item)}` or `renderRow()` returning hook-using JSX runs those hooks inside the caller → breaks when conditional or looped; state is not per item. Fix: `<Row item={item} />`.
- **Hooks outside render**: hooks called in event handlers, effects, `useMemo` callbacks, class components or at module scope → "Invalid hook call". Fix: move the call to the component body.
- **Helper without `use` prefix**: a plain function that calls hooks escapes the linter and React Compiler checks and gets called conditionally. Fix: name it `useX` and call it at top level.
- **Dynamic hook choice**: `const useData = cond ? useA : useB` or hooks taken from props/objects → the call sequence can change between renders. Fix: call both unconditionally or split components.
