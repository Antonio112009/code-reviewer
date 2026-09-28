---
name: Secrets handling
description: Credential leaks and weak secret handling in code and config, such as committed keys, insecure env fallbacks, public env prefixes, credentials sent to configurable hosts, secrets in command lines, plaintext stored tokens, weak shared keys, default logins and env-exposing endpoints.
category: security
priority: 72
tier: essential
tags:
  - CWE-798
  - CWE-1188
  - CWE-1392
  - CWE-200
  - CWE-214
  - CWE-312
  - CWE-321
  - CWE-522
  - CWE-538
  - OWASP-A02
  - OWASP-A04
  - OWASP-A07
activation:
  files:
    - "**/.env"
    - "**/.env.*"
    - "**/*.{pem,key,p12,pfx,jks,keystore,tfvars,tfstate}"
    - "**/id_{rsa,ecdsa,ed25519}*"
    - "**/*{secret,Secret,credential,Credential}*"
    - "**/{.npmrc,.pypirc,.netrc,.git-credentials,.gitignore}"
    - "**/{docker-compose,compose}*.{yml,yaml}"
    - "**/{appsettings,application,settings,config,secrets}*.{json,yml,yaml,properties,py,toml}"
    - "**/{vite,next,nuxt,webpack,svelte,astro}.config.*"
    - "**/*{seed,Seed}*.{ts,js,py,rb,php,sql,cs,java,go}"
  content:
    - -----BEGIN [A-Z ]{0,40}PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{36,}|\bgithub_pat_\w{20,}|\b(?:sk|rk)_live_[A-Za-z0-9]{16,}|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{35}
    - \b(?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC|NUXT_PUBLIC|PUBLIC)_\w{0,60}(?:SECRET|TOKEN|PRIVATE|PASSWORD|API_KEY|SERVICE_ROLE)|\b(?:define\s*:|DefinePlugin\()\s*\{[^}\n]{0,200}\bprocess\.env\b|\bservice_role\b
    - (?:[Ss]ecret|SECRET|[Pp]assword|PASSWORD|passwd|[Aa]pi_?[Kk]ey|API_?KEY|[Pp]rivate_?[Kk]ey|PRIVATE_?KEY)\w{0,40}['"]?[ \t]{0,4}(?:=|:|=>)[ \t]{0,4}['"][^'"\s]{8,200}['"]
    - (?:\bprocess\.env\.|\bgetenv\(\s*['"]|\benviron\.get\(\s*['"]|\$\{)[\w.-]{0,60}(?:SECRET|[Ss]ecret|TOKEN|[Tt]oken|KEY\b|_KEY|[Kk]ey\b|PASSWORD|[Pp]assword|SALT)[\w.-]{0,60}(?:\s*(?:\|\||\?\?)\s*['"]|['"]\s*,\s*['"]|:[^}\n]{1,100}\})
    - \bexpress\.static\(\s*(?:__dirname\s*\)|process\.cwd\(\)\s*\)|['"]\.{1,2}/?['"])|\bphpinfo\(|"expvar"|"net/http/pprof"|\bsshpass\b|\bcurl\s[^\n]{0,80}\s-u\s
  examples:
    - 'const openaiKey = "sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx";'
    - 'DB_PASSWORD = "changeme-local-only"'
    - 'const key = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;'
    - 'const secret = process.env.JWT_SECRET || "dev-secret";'
    - 'app.use(express.static(__dirname));'
---
- **Committed credentials**: live keys, tokens, passwords or private keys in code, tests, fixtures or compose files → compromise, kept in git history. Fix: rotate, secret store. Publishable keys (Stripe `pk_`, Firebase web config) are fine.
- **Insecure fallbacks**: `process.env.JWT_SECRET || 'dev'`, `getenv("KEY", "changeme")`, `${jwt.secret:secret}`, or verification skipped when the secret is unset → known key or no auth in production. Fix: fail startup when unset.
- **Client exposure**: secrets under `NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`, `PUBLIC_` or Nuxt `runtimeConfig.public`; Vite/webpack `define` of the whole `process.env`; service-role or admin keys in browser or mobile code → shipped to every user. Fix: server-only modules.
- **Credentials to configurable hosts**: server API keys, cloud credentials or `Authorization` headers attached to URLs from requests or tenant settings (webhooks, custom endpoints) → key exfiltration. Fix: bind each credential to fixed hosts.
- **Process exposure**: passwords in command lines (`mysql -p$PW`, `curl -u user:$TOKEN`) visible in `ps` and CI logs; untrusted child processes inheriting the full environment → theft. Fix: stdin or `0600` files, minimal env.
- **Stored secrets**: API keys, refresh or reset tokens and webhook secrets in plaintext columns; key files written with default `0644` → theft via dumps, backups, local users. Fix: store SHA-256 of random tokens, `0600`.
- **Weak shared keys**: short or sample HMAC/JWT secrets, one key across environments, tenants or purposes → offline brute force, cross-environment forgery. Fix: random 256-bit key per environment and purpose.
- **Default logins**: seeds or migrations creating admins with fixed passwords that run in production; services left on default credentials (`guest/guest`) → takeover. Fix: generate at deploy, force rotation.
- **Env-exposing endpoints**: debug pages, `phpinfo()`, Go `expvar`/`pprof` handlers, env-dumping routes, or static serving of the project root (`express.static(__dirname)`) exposing `.env`/`.git` → full secret leak. Fix: disable in production, serve a public dir.
