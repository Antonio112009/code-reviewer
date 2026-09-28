---
name: Server-side templates and SSR data
description: Unescaped template output (EJS, Pug, Handlebars, Nunjucks), compiling user-supplied templates, request objects passed as engine data/options, Handlebars prototype access flags, and JSON state inlined into script tags.
priority: 75
tags: [CWE-79, CWE-1336, CWE-94, A05:2025]
activation:
  content:
    - '\b(?:ejs|pug|jade|handlebars|Handlebars|hbs|nunjucks|mustache|Mustache|eta|liquidjs)\b'
    - '\brender(?:File|String)\s*\(|\b(?:ejs|pug|Handlebars|handlebars|nunjucks|_)\.(?:render|compile|template)\s*\('
    - '<%-|\{\{\{|!\{|\|\s*safe\b|\bautoescape\s*:\s*false|\bSafeString\b'
    - '\ballowProto(?:Properties|Methods)ByDefault\b'
    - '<script[^>\n]{0,80}>[^<\n]{0,200}\$\{|\bwindow\.__\w+__\s*='
  examples:
    - 'const html = ejs.render(template, data);'
    - '<%- userInput %>'
    - 'allowProtoPropertiesByDefault: true,'
    - '<script>window.__STATE__ = ${JSON.stringify(state)}</script>'
sources:
  - https://ejs.co/#docs
  - https://github.com/advisories/GHSA-phwq-j96m-2c2q
  - https://handlebarsjs.com/api-reference/runtime-options.html#options-to-control-prototype-access
  - https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
---
- **Unescaped output**: EJS `<%-`, Pug `!{}`/`!=`, Handlebars/Mustache `{{{ }}}` or `SafeString`, Nunjucks `| safe` or `autoescape: false` with user data → stored/reflected XSS. Fix: escaped forms; sanitize (DOMPurify/sanitize-html) when HTML is intended.
- **Compiling user templates**: `ejs.render(userText)`, `pug.compile`, `Handlebars.compile`, `_.template`, `nunjucks.renderString` on user-controlled text → server-side template injection = code execution. Fix: fixed templates; user content only as data.
- **Request objects as engine data**: `ejs.renderFile(view, req.body)`, `ejs.render(tpl, request.query)` or a framework `view()` fed the raw request lets attackers set engine options (EJS `settings[view options][outputFunctionName]`, CVE-2022-29078, fixed in 3.1.7) → RCE. Fix: pass an explicit locals object.
- **Handlebars prototype access**: `allowProtoPropertiesByDefault`/`allowProtoMethodsByDefault: true` re-enable the gadget chains blocked by default since 4.6.0. Fix: keep them off; allowlist specific properties.
- **JSON state in `<script>`**: `<script>window.__STATE__ = ${JSON.stringify(state)}</script>` - `JSON.stringify` doesn't escape `</script>` or `<!--` → XSS through any user-controlled string. Fix: escape `<` as `\u003c` or use `serialize-javascript`.
