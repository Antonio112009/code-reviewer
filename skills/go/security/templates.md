---
name: html/template and text/template XSS
description: text/template producing HTML, trusted-type casts (template.HTML, JS, URL…) on untrusted data, templates parsed from user input, HTML built outside the template engine and unsafe FuncMap helpers.
priority: 76
tags: [CWE-79, CWE-1336]
activation:
  content:
    - '"(?:html|text)/template"'
    - '\btemplate\.(?:HTML|JS|JSStr|URL|HTMLAttr|CSS|Srcset|FuncMap)\b'
    - '\btemplate\.(?:New|Must)\(|\.Parse(?:Files|Glob|FS)?\('
    - '<(?:div|p|span|a|li|td|h\d|script|img|body)\b[^\n]{0,80}%[sv]'
sources:
  - https://pkg.go.dev/html/template
  - https://pkg.go.dev/html/template#HTML
  - https://pkg.go.dev/text/template
---
- **Wrong package**: `text/template` rendering HTML, email bodies or pages (or an alias hiding which package is imported) performs no escaping → stored/reflected XSS. Fix: `html/template` for any HTML output.
- **Trusted-type casts**: `template.HTML(s)`, `template.JS`, `template.URL`, `template.HTMLAttr`, `template.CSS` or `template.Srcset` around user or database content bypass contextual escaping. Fix: pass plain strings; sanitise (e.g., bluemonday) before any cast.
- **User-controlled templates**: `template.New(…).Parse(userInput)` or templates stored in the DB — template authors are trusted, and actions can call exported methods and `FuncMap` functions → data exposure or server-side template injection. Fix: plain placeholder substitution.
- **HTML outside the engine**: `fmt.Fprintf(w, "<p>%s</p>", name)`, `w.Write([]byte("<a href='"+u+"'>"))` or string-built fragments later cast to `template.HTML` → XSS. Fix: render through `html/template`.
- **Unsafe FuncMap helpers**: custom funcs such as `safe`, `raw`, `markdown` returning `template.HTML` for arbitrary input. Fix: sanitise inside the helper.
- **Script contexts**: `template.JS(…)` around strings built from input, or JSON produced with `SetEscapeHTML(false)`/third-party encoders, inside `<script>` → `</script>` breakout or JS injection. Fix: pass the Go value and let html/template JS-escape it.
