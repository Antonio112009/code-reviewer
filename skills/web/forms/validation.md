---
name: Constraint validation and input types
description: Native validation defects — setCustomValidity never cleared, pattern attributes silently ignored under the v flag, hidden required fields blocking submission, errors styled before interaction, type=number and type=date value traps.
priority: 56
activation:
  content:
    - '\bpattern\s*=|\bsetCustomValidity\(|\b(?:reportValidity|checkValidity)\('
    - '\bno[vV]alidate\b|:(?:user-)?invalid\b|\brequired\b'
    - 'type\s*=\s*[''"](?:number|email|date|datetime-local|time|url|tel)[''"]'
    - '\bvalueAs(?:Number|Date)\b'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/setCustomValidity
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/pattern
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/number
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse
---
- **Sticky custom error**: `setCustomValidity(msg)` set on failure but never reset with `setCustomValidity('')` → the field stays invalid and the form can never submit. Fix: clear it on every `input`.
- **`pattern` silently ignored**: the attribute is compiled with the `v` flag and implicitly anchored; unescaped `-`, `(`, `)`, `[`, `{`, `}`, `/`, `|` inside classes make it invalid → no validation at all. Fix: escape them; test with `new RegExp(p, 'v')`.
- **Hidden required fields**: `required`/`pattern` on inputs hidden via `display: none`/`hidden` (inactive wizard steps, collapsed sections) → the browser can't focus the invalid control and silently blocks submission. Fix: `disabled` or drop `required` while hidden.
- **Errors before interaction**: styling `:invalid` → empty required fields render as errors on page load. Fix: `:user-invalid` or touched-state classes.
- **Number inputs**: `type="number"` for ZIP codes, card or phone numbers (leading zeros lost once parsed, `e` accepted, wheel changes the value, `maxlength` ignored); default `step=1` rejects decimals; empty or partial input gives `''`/`NaN`. Fix: `type="text" inputmode="numeric"`; `step="any"`; handle `NaN`.
- **Date inputs**: `new Date(dateInput.value)` on `YYYY-MM-DD` parses as UTC midnight → shows the previous day west of UTC. Fix: keep the string or build a local date from its parts.
