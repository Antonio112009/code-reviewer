---
name: Ruby security
description: Ruby-level sinks in any Ruby app, such as send/constantize dispatch, string eval and ERB templates, Marshal/YAML/Oj/JSON.load deserialization, shell strings, Kernel#open and URI.open, path joins, line-anchored validation regexes, unescaped ERB outside Rails and Nokogiri XXE options.
category: security
priority: 74
tier: essential
tags:
  - CWE-470
  - CWE-94
  - CWE-502
  - CWE-78
  - CWE-88
  - CWE-22
  - CWE-625
  - CWE-79
  - CWE-611
  - OWASP-A05
  - OWASP-A08
activation:
  languages:
    - ruby
  content:
    - \b(?:constantize|safe_constantize|const_get|public_send|__send__|instance_variable_set|instance_eval|class_eval|module_eval)\b|\.send\(\s*(?:params|"#\{)|\beval\(|\bERB\.new\b
    - \b(?:Marshal|YAML|Psych|Oj|JSON)\.(?:load|unsafe_load|restore)\b|\b(?:cookies_serializer|use_yaml_unsafe_load|permitted_classes)\b|\bNokogiri::XML\b|\b(?:noent|dtdload|NOENT|DTDLOAD)\b
    - \b(?:system|exec|spawn)\s*\(?\s*["']|%x[({\[|]|`[^`\n]{0,200}#\{|\b(?:Open3|IO\.popen|URI\.open|Kernel\.open)\b|\bIO\.(?:read|readlines|write|binread)\(
    - \bFile\.(?:join|expand_path)\(|\bPathname\b|\bsend_file\b|\bescape_html\b|\bSinatra\b|\bRoda\b|(?:=~|\.match\??\()\s*/\^|/\^[^/\n]{0,200}\$/
  examples:
    - 'klass = params[:type].constantize'
    - 'data = Marshal.load(cookie_value)'
    - 'system("convert #{filename} out.png")'
    - 'path = File.join(base_dir, params[:name])'
---
- **Dynamic dispatch**: `send` (reaches private `system`, `eval`), `public_send`, `instance_variable_set`, `constantize` or `const_get` with request data → arbitrary calls or class instantiation. Fix: allowlist hash.
- **String evaluation**: `eval`, string `instance_eval`/`class_eval`, or `ERB.new(user_text).result` → RCE. Fix: never evaluate input; Liquid for user templates.
- **Deserialization**: `Marshal.load`, `YAML.unsafe_load` or broad `permitted_classes` (`YAML.load` is safe since Psych 4), `Oj.load` (object mode), `JSON.load` before json 3.0, `:marshal` cookies → RCE. Fix: `JSON.parse`, `YAML.safe_load`.
- **Commands**: interpolated single strings in `system`, `exec`, `spawn`, backticks, `%x()`, `Open3` or `IO.popen` run through a shell → RCE. Fix: argv arrays, `--` before user operands.
- **Opening input**: `Kernel#open`/`IO.read` on user strings (a leading `|` runs a command before Ruby 4.0); `URI.open` treats non-URLs like `Kernel#open` → RCE, file read, SSRF. Fix: `File.open`, `Net::HTTP`.
- **Path joins**: `File.join(base, input)` keeps `..`; `File.expand_path(input, base)` and `Pathname#join` return absolute input and expand `~user` → traversal. Fix: expand, then `start_with?(base + "/")`.
- **Line anchors**: `^`/`$` match per line, so `"ok\n<script>"` passes `=~`/`match?` checks (only Rails `format:` rejects them) → bypass. Fix: `\A…\z`, not `\Z`.
- **Unescaped ERB**: Sinatra, Roda and plain `ERB`/Erubi output `<%= %>` raw by default (only Rails escapes) → XSS. Fix: `escape_html: true`, `Rack::Utils.escape_html`.
- **XML options**: Nokogiri with `noent`, `dtdload` or `huge` on untrusted input → XXE, SSRF, entity-expansion DoS. Fix: default parse options.
