---
name: JavaScript payload and hydration cost
description: Client JavaScript cost — whole-library and namespace imports, barrel files, heavy features not code-split, oversized serialized SSR state and hydrating content that never needs to be interactive.
priority: 50
activation:
  content:
    - '(?:\bfrom|\brequire\()\s*[''"](?:lodash|moment|aws-sdk|firebase|@mui/icons-material|react-icons/\w+|chart\.js|echarts|three|monaco-editor|pdfjs-dist|xlsx|core-js)[''"]'
    - '\bimport\s*\*\s*as\s+\w+\s+from\b'
    - 'from\s*[''"](?:@/|~/|\.{1,2}/)(?:components|utils|lib|helpers|icons|hooks)[''"]'
    - '\bwindow\.__\w+__\s*=|__NEXT_DATA__|\bhydrat\w*|\bclient:(?:load|idle|visible)\b'
sources:
  - https://web.dev/articles/reduce-javascript-payloads-with-code-splitting
  - https://vite.dev/guide/performance
  - https://web.dev/articles/rendering-on-the-web
---
- **Whole-library imports**: `import _ from 'lodash'`, `moment` (all locales), `import * as Icons`, `aws-sdk` v2 or full `core-js` in browser code → hundreds of KB parsed per load. Fix: ESM/per-function entry points, `Intl`/`date-fns`, per-icon and modular SDK imports.
- **Barrel files**: importing one helper from an `index` that re-exports a whole folder → every module and its side effects loaded or bundled. Fix: import from the module file; mark packages `"sideEffects": false`.
- **No code splitting**: rarely used heavy features (rich-text editors, charts, maps, PDF/XLSX export, admin screens) imported statically into the entry or route bundle → slower load and interactivity for every user. Fix: `import()`/lazy routes, load on interaction.
- **Serialized state bloat**: SSR pages embedding large JSON (`window.__INITIAL_STATE__`, framework data scripts with whole records) → extra HTML bytes and parse time, plus exposure of fields the page never shows. Fix: serialize only what the page renders.
- **Hydrating static content**: whole pages hydrated (`client:load` everywhere, client components at the root) although most content is static → JS execution delays interactivity. Fix: server-only components/islands; hydrate widgets on idle or visibility.
