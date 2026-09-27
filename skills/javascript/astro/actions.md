---
name: Astro Actions
description: Astro Actions defects — public /_actions endpoints without authorization, loose input schemas, form actions without accept form, leaky errors, lost form results and Zod 4 changes in Astro 6.
category: security
priority: 66
tags: [CWE-862, CWE-20]
activation:
  files: ["**/src/actions/**/*.{ts,js}"]
  content:
    - "\\bdefineAction\\s*\\("
    - "from ['\"]astro:actions['\"]"
    - "\\bActionError\\b"
    - "\\b(?:getActionContext|getActionResult|callAction)\\b"
  versions: { framework.astro: ">=4.15" }
sources:
  - https://docs.astro.build/en/guides/actions/
  - https://docs.astro.build/en/reference/modules/astro-actions/
  - https://docs.astro.build/en/guides/upgrade-to/v6/
---
- **Public endpoints**: every action is reachable at `/_actions/<name>` by anyone → handlers without `context.locals.user` or ownership checks = broken access control. Fix: authorize inside each handler (or gate with `getActionContext` in middleware).
- **Loose input**: no `input` schema, `z.any()`, or passthrough objects spread into DB writes → mass assignment, type confusion. Fix: strict schemas listing only writable fields.
- **Form actions without accept**: `<form method="POST" action={actions.x}>` posting to an action lacking `accept: 'form'` → the handler gets raw `FormData`, not the schema-validated object. Fix: `accept: 'form'`; `z.coerce` for numbers/booleans.
- **Leaky errors**: throwing raw errors or `ActionError` messages with internals → returned to the client. Fix: generic messages; log details server-side.
- **Lost form results**: relying on `Astro.getActionResult()` after a redirect → the result is gone (POST/Redirect/GET needs your own storage). Fix: persist results in `Astro.session`.
- **Zod 4 (Astro 6+)**: `z` imported from `astro:schema`/`astro:content`, or Zod 3 APIs (`z.string().email()`) → removed or changed validation. Fix: `import { z } from 'astro/zod'` with Zod 4 syntax (`z.email()`).
