---
name: Template and format-string injection
description: Server-side template injection with Jinja2/Mako used outside a web framework, Jinja autoescape off by default, Markup/|safe on dynamic data, str.format/format_map templates from users and templates generating non-HTML languages.
priority: 78
tags: [CWE-1336, CWE-79, CWE-134, OWASP-A05]
activation:
  content:
    - "\\bjinja2\\b|\\b(?:Environment|Template|SandboxedEnvironment)\\s*\\(|\\bfrom_string\\s*\\(|\\bmako\\b"
    - "\\bautoescape\\s*=|\\bMarkup\\s*\\(|\\|\\s*safe\\b"
    - "\\b\\w*(?:template|tmpl|fmt|format_str|pattern|message)\\w*\\.format(?:_map)?\\s*\\("
    - "\\.format\\s*\\(\\s*\\*\\*|\\.format_map\\s*\\(|\\bstring\\.Template\\b"
  examples:
    - 'template = jinja2.Template(user_text)'
    - 'env = Environment(autoescape=False)'
    - 'output = message_template.format(**request.args)'
    - 'output = template.format_map(ctx)'
sources:
  - https://jinja.palletsprojects.com/en/stable/api/#autoescaping
  - https://jinja.palletsprojects.com/en/stable/sandbox/
  - https://docs.python.org/3/library/string.html#format-string-syntax
  - https://markupsafe.palletsprojects.com/en/stable/
---
- **User text as template source**: `jinja2.Template(user_text)`, `Environment().from_string(...)` or Mako `Template(...)` built from requests, DB rows or uploads → SSTI and RCE (`{{ cycler.__init__.__globals__ }}`). Fix: fixed templates with user data as variables; `SandboxedEnvironment` for user-authored templates, plus output limits.
- **Autoescape off by default**: a bare `jinja2.Environment()` or `Template()` has `autoescape=False` → HTML built from variables is XSS. Fix: `autoescape=select_autoescape()` (or `True`) for HTML/XML output.
- **`Markup` and `|safe` on dynamic data**: wrapping user input, f-strings or `%`-formatted strings in `Markup(...)`, or `|safe` in templates, disables escaping. Fix: `Markup` only on constants; `Markup("<b>{}</b>").format(value)` escapes its arguments.
- **Format-string injection**: a user-controlled template passed to `.format(**ctx)` or `.format_map(ctx)` can traverse attributes and indexes (`{user.__class__.__init__.__globals__[SECRET]}`) → secret disclosure. Fix: `string.Template.safe_substitute` with plain values, never objects.
- **Templates for other languages**: rendering SQL, shell commands, YAML or email headers through templates (HTML-escaped or not) → injection in the target language. Fix: that language's parameterization or escaping, not a text template.
