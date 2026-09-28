---
name: Native sessions and cookies
description: session fixation, use_strict_mode off by default, insecure cookie defaults, incomplete logout, session file locking, missing timeouts and $_SESSION keys with a pipe (8.5).
priority: 74
tags: [CWE-384, CWE-614, CWE-1004, CWE-613]
activation:
  content:
    - '\bsession_(?:start|regenerate_id|destroy|set_cookie_params|write_close|id)\s*\('
    - '\$_SESSION\b|\bset(?:raw)?cookie\s*\('
    - '\bsession\.(?:use_strict_mode|cookie_\w+|gc_maxlifetime)\b'
  examples:
    - 'session_regenerate_id(true);'
    - '$_SESSION[''user_id''] = $user->id;'
    - 'ini_set(''session.cookie_secure'', ''1'');'
sources:
  - https://www.php.net/manual/en/session.configuration.php
  - https://www.php.net/manual/en/function.session-regenerate-id.php
  - https://www.php.net/manual/en/features.session.security.management.php
  - https://www.php.net/manual/en/migration85.incompatible.php
---
- **Fixation**: no `session_regenerate_id(true)` after login or privilege change → a planted session id stays authenticated; the default `false` keeps the old session alive. Fix: regenerate with `true`.
- **Strict mode off**: `session.use_strict_mode` defaults to 0, so PHP adopts attacker-chosen uninitialized ids. Fix: enable it.
- **Cookie defaults**: `session.cookie_secure` and `cookie_httponly` default to off and `cookie_samesite` is empty; `setcookie($name, $value)` for auth cookies sets no flags → theft over HTTP/XSS, CSRF. Fix: set them via the options array before `session_start()`.
- **Incomplete logout**: `session_destroy()` neither clears `$_SESSION` for the rest of the request nor deletes the cookie → later code still sees the user. Fix: `$_SESSION = []`, expire the cookie, then destroy.
- **Session locking**: the files handler locks the session for the whole request → parallel AJAX calls from one user serialize and time out behind a slow request. Fix: `session_write_close()` after the last write, `read_and_close`.
- **No timeouts**: relying on `session.gc_maxlifetime` (probabilistic GC) → stolen ids stay valid indefinitely on busy or GC-disabled servers. Fix: enforce idle and absolute timeouts in session data.
- **Pipe in keys**: `$_SESSION` keys containing `|` cannot be written by the default `php` serializer → data silently lost (a warning since 8.5).
