---
name: Routes, hooks and login protection
description: Flask access-control defects — auth decorators placed above @route, blueprint before_request hooks that do not cover the app, state changes on GET, Flask-Login next= open redirects, user_loader pitfalls and long-lived remember-me cookies.
priority: 72
tags: [CWE-862, CWE-601, CWE-352, A01:2025]
activation:
  content:
    - '@\w+\.(?:route|get|post|put|patch|delete)\('
    - '\b(?:before_request|before_app_request|login_required|login_user|logout_user|user_loader|request_loader|current_user)\b'
    - '\bredirect\([^)\n]{0,80}\b(?:next|args|values|form)\b'
    - '\bREMEMBER_COOKIE_\w+|\bremember\s*=\s*True\b'
sources:
  - https://flask.palletsprojects.com/en/stable/patterns/viewdecorators/
  - https://flask.palletsprojects.com/en/stable/blueprints/
  - https://flask-login.readthedocs.io/en/latest/
  - https://flask.palletsprojects.com/en/stable/web-security/
---
- **Decorator order**: `@login_required` (or any auth wrapper) placed above `@app.route` wraps the function after Flask registered the unprotected original → public endpoint. Fix: `@route` outermost, auth directly below it.
- **Blueprint hook scope**: `@bp.before_request` guards only that blueprint's routes; views on the app or other blueprints stay open. Fix: `before_app_request`/`app.before_request` or per-blueprint checks.
- **Hook that never blocks**: a `before_request` auth check that does not `return`/`abort()` on failure lets the view run anyway.
- **State change on GET**: routes that mutate data accept GET (the default `methods`) → link/image-triggered CSRF, prefetching and crawler side effects. Fix: `methods=["POST"]` plus CSRF protection.
- **Open redirect after login**: `redirect(request.args.get("next"))` without validation → phishing redirects (Flask-Login explicitly requires validating `next`). Fix: allow only relative paths on your host.
- **user_loader pitfalls**: the loader must return `None` for unknown/invalid ids (not raise), and should reject disabled users; `int(user_id)` on malformed session data raising → 500 on every request.
- **Unrevocable remember-me**: `login_user(remember=True)` issues a 365-day cookie holding `get_id()`; with the primary key as id, a password change does not invalidate stolen cookies. Fix: an alternative id rotated on password change, shorter `REMEMBER_COOKIE_DURATION`, `fresh_login_required` for sensitive actions.
