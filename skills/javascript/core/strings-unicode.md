---
name: Strings and Unicode
description: UTF-16 length and slicing that split emoji, limits checked in the wrong unit, locale-dependent case mapping, missing normalization, Latin-1-only btoa/atob and split limits that drop data.
priority: 50
activation:
  content:
    - '\.(?:slice|substring|substr|charAt|charCodeAt|codePointAt|normalize|localeCompare|toLocaleUpperCase|toLocaleLowerCase|split)\s*\('
    - '\b(?:btoa|atob|encodeURIComponent|decodeURIComponent)\s*\('
    - '\bnew\s+Text(?:En|De)coder\b|\bIntl\.Segmenter\b'
    - '\.length\s*(?:>|<|>=|<=)\s*\d'
  examples:
    - 'const preview = text.slice(0, 280);'
    - 'const encoded = encodeURIComponent(query);'
    - 'const encoder = new TextEncoder();'
    - 'if (username.length > 20) return false;'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String#utf-16_characters_unicode_code_points_and_grapheme_clusters
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize
  - https://developer.mozilla.org/en-US/docs/Web/API/Window/btoa
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/split
---
- **Cutting surrogate pairs**: `length`, `slice`, `substring`, `split('')` count UTF-16 units → truncating (`text.slice(0, 280)`) emoji leaves lone surrogates (� output, `encodeURIComponent` throws `URIError`). Fix: `Array.from(str)`, `Intl.Segmenter`.
- **Limits in the wrong unit**: `str.length` checked against byte limits (DB column bytes, header or payload caps) → truncation errors. Fix: `new TextEncoder().encode(s).length`/`Buffer.byteLength(s)`.
- **Locale-dependent case**: `toLocaleLowerCase()`/`localeCompare()` without a locale follow the host locale (Turkish İ) → keys differ per server. Fix: `toLowerCase()` for identifiers, explicit locales for display.
- **No normalization**: precomposed vs decomposed accents (`'\u00e9'` vs `'e\u0301'`) compare unequal → duplicate usernames, missed lookups, bypassed blocklists. Fix: `normalize('NFC')` (NFKC for identifiers) before comparing or storing.
- **`btoa`/`atob` are Latin-1**: `btoa('€')` throws; `atob` returns a binary string, not UTF-8 text. Fix: `TextEncoder` + `Uint8Array#toBase64()` (Node ≥25, Chrome 140) or `Buffer.from(s).toString('base64')`.
- **`split` limit drops data**: `'a=b=c'.split('=', 2)` is `['a', 'b']` - the remainder is discarded → values containing the separator get truncated. Fix: split once at `indexOf`.
