---
name: JSON serialization
description: Values JSON.stringify silently drops or converts, throws on BigInt and cycles, unguarded JSON.parse of non-JSON bodies, stringify returning undefined, and toJSON/replacer surprises.
priority: 55
activation:
  content:
    - '\bJSON\.(?:parse|stringify)\s*\('
    - '\btoJSON\s*\('
    - '\.json\s*\(\s*\)'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
---
- **Silent losses**: `undefined`, functions and Symbols vanish from objects (become `null` in arrays), `Map`/`Set` → `{}`, `NaN`/`Infinity` → `null`, `Date` → ISO string that `JSON.parse` never revives → types change after cache, queue or storage round-trips. Fix: explicit serializers and revivers.
- **Throws inside serializers**: BigInt and circular references throw `TypeError` - often inside logging or error handlers, which then crash instead of reporting. Fix: a replacer or safe stringify for logs.
- **Unguarded `JSON.parse`**: throws `SyntaxError` on `''`, `undefined`, truncated or non-JSON input (cookies, `localStorage`, queue messages, files, error pages) → the handler crashes instead of falling back. Fix: try/catch with a default, then validate the shape.
- **`JSON.stringify(undefined)` is `undefined`**: not a string → `localStorage.setItem` stores `"undefined"`, `fs.writeFile` throws, responses end empty. Fix: default the value before serializing.
- **`toJSON` and replacers**: objects with `toJSON` (Date, Decimal, Luxon, ORM documents) serialize differently from what the code inspects; a replacer or reviver that returns `undefined` deletes the key. Fix: return the value unchanged by default.
- **Deep copy via JSON**: `JSON.parse(JSON.stringify(obj))` inherits every loss above (Dates become strings, `undefined` fields disappear). Fix: `structuredClone`.
