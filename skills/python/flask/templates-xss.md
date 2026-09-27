---
name: Jinja templates and escaping
description: Flask/Jinja XSS and template-injection defects — templates outside the autoescaped extensions, render_template_string with user input, autoescape disabled per block or app-wide, unquoted attributes, javascript URLs and data in scripts or data- attributes without tojson.
priority: 72
tags: [CWE-79, CWE-1336, A05:2025]
activation:
  files: ["**/*.{j2,jinja,jinja2}"]
  content:
    - '\b(?:render_template_string|jinja_env|select_jinja_autoescape|jinja_options)\b'
    - '\{%-?\s*autoescape\s+false\b|\|\s*tojson\b'
    - '\brender_template\(\s*["''][^"''\n]{1,120}\.(?:txt|j2|jinja2?|HTML|Html|md)["'']'
    - '<script\b[^>\n]{0,80}>[^<\n]{0,200}\{\{'
    - '\b(?:href|src|action)=["'']?\{\{'
sources:
  - https://flask.palletsprojects.com/en/stable/templating/
  - https://flask.palletsprojects.com/en/stable/web-security/#cross-site-scripting-xss
  - https://jinja.palletsprojects.com/en/stable/api/#autoescaping
  - https://flask.palletsprojects.com/en/stable/changes/
---
- **Extension decides escaping**: Flask autoescapes only `.html`, `.htm`, `.xml`, `.xhtml` and `.svg` templates (case-sensitive up to 3.1, so `.HTML` is not escaped); HTML rendered from `.j2`, `.jinja` or `.txt` templates is unescaped → XSS. Fix: rename, or configure `jinja_env.autoescape`.
- **Template built from input**: `render_template_string(f"...{user}...")` or passing user text as the template source → server-side template injection and code execution. Fix: fixed templates, user data only as context variables.
- **Escaping disabled**: `{% autoescape false %}` blocks around request or database values, or `app.jinja_env.autoescape` / an overridden `select_jinja_autoescape()` turning it off app-wide.
- **Attribute and URL contexts**: unquoted `href={{ url }}` allows attribute injection; quoted values still run `javascript:` URLs. Fix: quote attributes, allow only http(s) schemes.
- **Data in scripts**: `var x = {{ data }}` or `"{{ value }}"` inside `<script>` is HTML-escaped, not JS-escaped → breakout or broken JSON. Fix: `{{ data|tojson }}` without extra quotes; in `data-` attributes only single-quoted (`data-x='{{ v|tojson }}'`).
