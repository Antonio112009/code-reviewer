---
name: Objects, copies and keyed collections
description: Shallow copies, what spread and structuredClone drop, undefined overriding defaults, plain objects used as dictionaries, Map/Set key identity and Set-method arguments.
priority: 55
activation:
  content:
    - '(?:[=(,:?]|\breturn)\s*\{\s*\.\.\.[\w$]'
    - '\bObject\.(?:assign|keys|values|entries|fromEntries|create)\s*\('
    - '\bstructuredClone\s*\('
    - '\bnew\s+(?:Map|Set|WeakMap|WeakSet)\b'
    - '\.(?:union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\s*\('
    - '\[\s*(?:key|k|id|name|prop|field)\s*\]\s*(?:=[^=]|\+\+|\|\|=|\?\?=)'
  examples:
    - 'const merged = { ...defaults, ...opts };'
    - 'const keys = Object.keys(config);'
    - 'const copy = structuredClone(state);'
    - 'const cache = new Map();'
    - 'const shared = setA.union(setB);'
    - 'counts[key]++;'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax
  - https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map#objects_vs._maps
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set#set-like_objects
---
- **Shallow copies**: `{...obj}`, `Object.assign`, `[...arr]` copy one level; nested objects stay shared → editing the copy mutates defaults, cached config or caller state. Fix: `structuredClone` or copy nested levels.
- **What copies drop**: spreading a class instance keeps own enumerable fields only (methods, prototype getters and `#private` state are lost, `instanceof` fails); `structuredClone` turns class instances into plain objects and throws `DataCloneError` on functions. Fix: explicit copy methods.
- **`undefined` overrides defaults**: `{ ...defaults, ...opts }` with `opts.timeout === undefined` sets `timeout` to `undefined`. Fix: drop undefined keys before merging.
- **Objects as dictionaries**: data-driven keys (`counts[word]++`, `cache[id]`) hit inherited members (`constructor`, `toString`, `__proto__`) and are stringified (`1`/`'1'` collide, objects become `'[object Object]'`). Fix: `Map`, `Object.create(null)`, `Object.hasOwn`.
- **Map/Set identity**: object, array and Date keys compare by reference - `set.has({ id: 1 })` is false, `map.get([a, b])` never hits. Fix: primitive keys (id or composite string).
- **Set methods and live iteration**: `a.union(b)` (ES2025) needs a set-like argument - passing an array throws `TypeError`; entries added to a Set/Map while iterating it are visited too (possible endless loop). Fix: `new Set(arr)`; iterate a copy.
