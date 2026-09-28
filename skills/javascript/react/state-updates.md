---
name: State updates
description: useState / useReducer defects — lost updates from stale snapshots, reads right after set, in-place mutation, props copied into state, eager initializers, function values and impure reducers.
priority: 63
activation:
  content:
    - "\\buse(?:State|Reducer)\\s*[<(]"
    - "\\bset(?!Timeout\\b|Interval\\b|Immediate\\b|Attribute\\b|Item\\b|Property\\b|Header\\b)[A-Z]\\w*\\s*\\("
  examples:
    - "const [count, setCount] = useState(0);"
    - "setCount(count + 1);"
sources:
  - https://react.dev/reference/react/useState
  - https://react.dev/learn/updating-objects-in-state
  - https://react.dev/learn/you-might-not-need-an-effect
---
- **Lost updates**: `setCount(count + 1)` called repeatedly, or from intervals, timeouts and async callbacks holding an old render's value → increments and edits are lost. Fix: updater form `setCount(c => c + 1)`.
- **Read after set**: the state variable is used right after `setX(v)` expecting the new value; it stays the old snapshot until the next render. Fix: use the computed local value.
- **In-place mutation**: `push`/`splice`/`sort`/`reverse` or field writes on state followed by `setState(sameRef)` → `Object.is` bail-out, no re-render; memoized children see mutated data. Fix: copy (`toSorted`, spread).
- **Props copied into state**: `useState(props.user)` ignores later prop changes → stale forms after the parent switches entities. Fix: derive during render or reset with `key`.
- **Eager initializer**: `useState(parse(big))` or `useRef(new Heavy())` evaluates the argument on every render. Fix: `useState(() => parse(big))`.
- **Function as state**: `setHandler(fn)` calls `fn` as an updater and `useState(fn)` as an initializer. Fix: `setHandler(() => fn)`.
- **Impure reducer or updater**: reducers/updaters that call APIs, mutate or generate IDs run twice in StrictMode and may be replayed → duplicate requests or IDs. Fix: keep them pure.
