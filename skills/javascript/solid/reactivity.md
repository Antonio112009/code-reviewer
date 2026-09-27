---
name: Fine-grained reactivity in components
description: SolidJS 1.x reactivity defects — destructured props, reads in the run-once component body, early returns, values passed instead of accessors, repeated children access and reads that escape tracking.
priority: 64
activation:
  content:
    - "\\bcreate(?:Signal|Memo|Computed)\\s*[(<]"
    - "\\b(?:splitProps|mergeProps|children)\\s*\\("
    - "\\bprops\\.[a-zA-Z_$]"
    - "\\bconst\\s*\\{[^}\\n]{1,120}\\}\\s*=\\s*props\\b"
sources:
  - https://docs.solidjs.com/concepts/components/props
  - https://docs.solidjs.com/concepts/components/basics
  - https://docs.solidjs.com/concepts/intro-to-reactivity
---
- **Destructured props**: `function Card({ title })` or `const { title } = props` → value captured once; parent updates ignored. Fix: read `props.title` where used; `splitProps` for rest props.
- **Body reads and early returns**: `const label = count() * 2` or `if (!props.user) return <Empty/>` in the component body → components run once, so the value/branch never updates. Fix: derived functions/`createMemo`; `<Show>`/`<Switch>` in JSX.
- **Defaults via ||**: `const size = props.size || 'md'` in the body → evaluated once. Fix: `mergeProps({ size: 'md' }, props)`.
- **Values instead of accessors**: `createResource(id(), …)`, `useThing(count())` or storing `signal()` results for later → dependency captured once. Fix: pass the accessor (`id`, `() => props.id`).
- **Repeated children access**: reading `props.children` several times → child components/DOM created repeatedly. Fix: `const c = children(() => props.children)`.
- **Reads that escape tracking**: signals read after `await`, in `setTimeout` or in event-handler-created closures meant to be reactive → no dependency, stale UI. Fix: read inside JSX, memos or effects synchronously.
