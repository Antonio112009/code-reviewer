---
name: Logging and privacy
description: Secrets and personal data leaking through logs, telemetry and URLs, log injection and field clobbering, lost error details, verbose production logging and missing security audit events.
category: practice
priority: 50
tier: essential
tags:
  - CWE-532
  - CWE-117
  - CWE-359
  - CWE-598
  - CWE-778
  - OWASP-A09
activation:
  languages:
    - typescript
    - javascript
    - python
    - php
    - java
    - kotlin
    - csharp
    - go
    - rust
    - c
    - cpp
    - ruby
    - swift
    - scala
    - dart
    - elixir
    - objective-c
    - vue
    - svelte
    - groovy
    - yaml
    - json
    - toml
    - text
  files:
    - "**/{logback,logback-spring,log4j2}*.xml"
    - "**/{logging,log}*.{yaml,yml,ini,conf,json,toml}"
    - "**/{sentry,instrumentation,otel,telemetry}*.{ts,js,mjs,py}"
  content:
    - \b(?:console|_?logger|_?log|LOG|LOGGER|logging|slog|zap|zerolog|logrus|winston|pino|bunyan|structlog|Log|Logger)\s*\.\s*\w+\([^\n]{0,200}?\b(?:req|request|res|response|body|headers?|cookies?|session|user|account|customer|token|jwt|password|passwd|secret|credentials?|api_?[kK]ey|auth\w*|email|phone|address|ssn|card|payload|params|query|config|env|environ|err|error|exc|exception|e)\b
    - \b(?:info|debug|warn|error|trace)!\([^\n]{0,200}?\b(?:req|request|body|headers?|user|token|password|secret|email|payload|err|error|e)\b|\bLog::\w+\(|\berror_log\(|\bRails\.logger\b|\bMDC\.put\(|\bLogContext\.PushProperty\(
    - \bSentry\.\w+|\bcaptureException\(|\bsendDefaultPii\b|\bbeforeSend\b|\b(?:posthog|mixpanel|amplitude|segment|analytics)\.(?:capture|track|identify)\(|\b(?:span|currentSpan)\.(?:setAttributes?|set_attributes?|SetAttributes)\(|\bredact\b
    - "[?&](?:access_?token|api_?key|apikey|token|password|passwd|secret|client_secret|session_?id|email)="
    - \blogging\.level\b|\blog_?[lL]evel\b|\becho\s*=\s*True\b|\borg\.hibernate\.(?:SQL|orm\.jdbc\.bind|type\.descriptor)\b|\bshow[-_]sql\b|\blog:\s*\[[^\]\n]*['"]query['"]|\baudit\w*
  examples:
    - 'logger.info("login", { user, password: req.body.password });'
    - 'error!("request failed: {:?}", request);'
    - 'Sentry.captureException(err);'
    - 'const url = `/reset?token=${resetToken}`;'
    - 'logging.level: DEBUG'
---
- **Secrets in logs**: `Authorization`/`Cookie` headers, tokens, reset links, connection strings, env dumps, or whole HTTP client errors (axios `err.config` holds headers) → credentials in log stores. Fix: allowlist fields.
- **Whole-object dumps**: logging `req.body`, user or ORM entities, `%+v` structs or payload spreads with password hashes, emails, phones, card or health data → personal data breach. Fix: log ids and chosen fields.
- **Redaction gaps**: redact rules (pino `redact`, Serilog, logback masks) missing real key paths, casing, nesting or arrays, or new sensitive fields → data passes through. Fix: test with real payloads.
- **Log injection**: user-controlled strings interpolated into plain-text lines without escaping CR/LF or ANSI sequences → forged entries, broken parsers, terminal injection. Fix: structured fields, escape control characters.
- **Clobbered fields**: user input spread into log context (`{...req.query}`, MDC from headers) overriding `level`, `msg` or `userId`; Python `extra` with a `message` key raises KeyError → forged or crashing logs. Fix: nest under one key.
- **Lost errors**: `JSON.stringify(err)` gives `{}`; pino ignores an error passed after the message; Python `logger.error(e)` without `exc_info` → no stack or cause. Fix: `log.error({ err }, msg)`, `logger.exception`.
- **Verbose production logging**: debug/trace levels, SQL logging with bound values (`echo=True`, Hibernate bind TRACE, Prisma `query` events) or body-logging HTTP interceptors left on in production → secrets and PII at scale. Fix: environment-gated levels.
- **Telemetry leakage**: PII or secrets sent to Sentry, APM, analytics or traces (`sendDefaultPii`, body breadcrumbs, span attributes holding SQL values or tokens, unmasked replays) → data leaves your control. Fix: scrub in `beforeSend`.
- **Secrets in URLs**: tokens, API keys, emails or reset codes in query strings → stored by access logs, proxies, `Referer` and browser history. Fix: headers or POST bodies.
- **Missing audit trail**: login failures, permission denials, role/password/MFA changes and admin or export actions not logged or only at debug → attacks go unnoticed. Fix: log security events with actor, target, outcome.
