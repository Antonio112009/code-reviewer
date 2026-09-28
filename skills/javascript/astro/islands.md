---
name: Islands and hydration
description: Astro island defects — framework components without client directives (dead handlers), function props, secrets serialized into island props, over-hydration and server-island context.
priority: 62
activation:
  content:
    - "\\bclient:(?:load|idle|visible|media|only)\\b"
    - "\\bserver:defer\\b"
    - "<[A-Z][\\w.]{0,60}\\s[^>\\n]{0,200}\\bon[A-Z][a-zA-Z]{0,40}=\\{"
    - "from ['\"][^'\"\\n]{1,120}\\.(?:jsx|tsx|vue|svelte)['\"]"
  examples:
    - '<Counter client:visible />'
    - '<Avatar server:defer />'
    - '<Button onClick={() => save()} client:load />'
    - 'import Counter from ''../components/Counter.tsx'';'
sources:
  - https://docs.astro.build/en/guides/framework-components/
  - https://docs.astro.build/en/reference/directives-reference/
  - https://docs.astro.build/en/guides/server-islands/
---
- **No client directive**: React/Vue/Svelte/Solid components rendered without `client:*` → static HTML only; `onClick`, state and effects never run. Fix: `client:visible`, `client:idle` or `client:load`.
- **Function props**: callbacks or class instances passed to hydrated components → not serializable (functions only work during server rendering). Fix: keep interactivity inside the island; pass plain data.
- **Props leak into HTML**: every prop of a `client:*` component is serialized into the page for hydration → tokens, full user rows or internal flags become public. Fix: pass only the fields the island needs.
- **Over-hydration**: `client:load` on below-the-fold or non-interactive components → large JS on the critical path. Fix: `client:visible`/`client:idle`, or no directive.
- **Server island context**: inside `server:defer` components `Astro.url` is the island route (`/_server-islands/…`), and props (encrypted) travel with the island request. Fix: read the page URL from `Referer`; pass ids, not objects.
