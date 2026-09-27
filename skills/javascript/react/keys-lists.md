---
name: Keys and list identity
description: List and component-identity bugs — index or generated keys, duplicate keys, keys on the wrong element and missing reset keys when the same component switches to another entity.
priority: 62
activation:
  content: ["\\.map\\s*\\(", "\\bkey=\\{"]
sources:
  - https://react.dev/learn/rendering-lists
  - https://react.dev/learn/preserving-and-resetting-state
  - https://react.dev/reference/react/Fragment
---
- **Index keys on dynamic lists**: `key={i}` on lists that reorder, insert, filter or delete → row state, uncontrolled input values and focus stick to the wrong item; a delete can edit the wrong row. Fix: stable IDs from the data.
- **Generated keys**: `key={Math.random()}`, `crypto.randomUUID()`, `Date.now()` or `useId()` in render → every item remounts on every render (lost input and focus, DOM churn). Fix: assign IDs when the data is created.
- **Duplicate keys**: keys from non-unique fields (names, dates) or IDs repeated across merged arrays → items dropped, duplicated or updated wrongly. Fix: unique or composite keys.
- **Key on the wrong element**: the key sits on an inner element or inside the child component instead of the element returned from `map`, or a `<>` shorthand that cannot take one. Fix: key the outer element, `<Fragment key={…}>`.
- **Missing reset key**: the same component type at the same position for another entity (`<Editor doc={doc}/>` after `doc.id` changes, `cond ? <Form a/> : <Form b/>`) keeps old state → edits land on the wrong record. Fix: `key={doc.id}`.
