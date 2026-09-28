---
name: Accidentally quadratic code
description: Spreading accumulators in reduce, array lookups inside loops, shift()-based queues, concat/Buffer.concat in loops, and Intl/RegExp/JSON clones rebuilt per iteration or per comparison.
priority: 50
activation:
  content:
    - '\.reduce\s*\([^\n]{0,120}\.\.\.'
    - '\.(?:map|filter|forEach|reduce|some|every|flatMap|find)\s*\([^\n]{0,80}\.(?:includes|indexOf|find|findIndex|some|filter)\s*\('
    - '\.(?:shift|unshift)\s*\(|\.splice\s*\(\s*0\s*,'
    - '=\s*[\w$.]+\.concat\s*\(|\bBuffer\.concat\s*\('
    - '\.(?:toLocaleString|toLocaleDateString|localeCompare)\s*\(|\bnew\s+Intl\.\w+\s*\('
    - '\bJSON\.parse\s*\(\s*JSON\.stringify\s*\('
  examples:
    - 'items.reduce((acc, x) => ({ ...acc, [x.id]: x }), {});'
    - 'const shared = a.filter(x => b.includes(x));'
    - 'queue.shift();'
    - 'arr = arr.concat(x);'
    - 'items.sort((a, b) => a.name.localeCompare(b.name));'
    - 'const clone = JSON.parse(JSON.stringify(obj));'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toLocaleString
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/shift
---
- **Spread accumulators**: `reduce((acc, x) => ({ ...acc, [x.id]: x }), {})` or `[...acc, x]` copies the accumulator on every step → O(n²) time and garbage (10k items ≈ 50M property copies). Fix: mutate a local accumulator, `Object.fromEntries`, or a `Map`.
- **Lookups inside loops**: `a.filter(x => b.includes(x))`, `find`/`indexOf` inside `map`/`forEach` over another list → O(n·m); fine for tens, a stall for tens of thousands. Fix: build a `Set`/`Map` once.
- **Array queues**: `shift()`, `unshift()` and `splice(0, 1)` move every element → BFS/job queues become O(n²). Fix: an index pointer, a ring buffer or a deque.
- **Growing by copy**: `arr = arr.concat(x)` or `Buffer.concat([buf, chunk])` inside a loop re-copies everything each time. Fix: `push` chunks, concat once at the end.
- **Rebuilt expensive objects**: `toLocaleString`/`toLocaleDateString` or `new Intl.NumberFormat`/`DateTimeFormat` per item, `localeCompare` in large sorts, `new RegExp` or `JSON.parse(JSON.stringify(…))` deep clones per iteration. Fix: create one `Intl.*`/`Intl.Collator`/regex outside the loop; `structuredClone` only when needed.
