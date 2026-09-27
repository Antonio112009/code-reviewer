---
name: Extension pitfalls
description: Defects in common Flask extensions — uncapped Flask-SQLAlchemy paginate(), db.session outside the app context and create_all() instead of migrations, Flask-WTF CSRF gaps, credentialed wildcard Flask-CORS and per-process or proxy-blind Flask-Limiter limits.
priority: 66
tags: [CWE-400, CWE-352, CWE-942, CWE-770]
activation:
  content:
    - '^[ \t]*(?:from|import)[ \t]+flask_(?:sqlalchemy|wtf|cors|limiter|migrate)\b'
    - '\b(?:paginate|get_or_404|first_or_404|create_all)\('
    - '\b(?:CSRFProtect|csrf\.exempt|WTF_CSRF_\w+)\b'
    - '\bCORS\(|@cross_origin\b|\bsupports_credentials\b'
    - '\bLimiter\(|\bRATELIMIT_\w+|\bget_remote_address\b'
sources:
  - https://flask-sqlalchemy.readthedocs.io/en/stable/pagination/
  - https://flask-wtf.readthedocs.io/en/latest/csrf/
  - https://github.com/corydolphin/flask-cors/blob/main/flask_cors/core.py
  - https://flask-limiter.readthedocs.io/en/stable/configuration.html
---
- **Uncapped paginate()**: `db.paginate(select)` and `query.paginate()` read `page`/`per_page` from `request.args`, and in Flask-SQLAlchemy 3.x the default `max_per_page=None` is passed through (despite the documented 100) → `?per_page=1000000` loads everything. Fix: pass `max_per_page=`.
- **db.session outside the app context**: threads, executors or scripts using `db.session` raise "Working outside of application context"; objects carried across contexts become detached. Fix: `with app.app_context():` and reload by id.
- **create_all() as migration**: `db.create_all()` at startup never alters existing tables → schema drift in production. Fix: Flask-Migrate/Alembic.
- **CSRF gaps (Flask-WTF)**: without `CSRFProtect(app)`, only `FlaskForm.validate_on_submit()` checks tokens, so plain `request.form`/JSON handlers are open; `@csrf.exempt` or `WTF_CSRF_ENABLED = False` leaking from test config disables it.
- **Credentialed wildcard CORS**: `CORS(app, supports_credentials=True)` with the default origins `*` echoes any request `Origin` → any site reads authenticated responses; flask-cors <6.0.0 also had path-matching CVEs (e.g. CVE-2024-6844). Fix: explicit origins.
- **Rate limits that do not limit**: Flask-Limiter with `memory://` storage (the default when unset) counts per process; `get_remote_address` behind a proxy sees the proxy IP (one shared bucket) unless ProxyFix is configured correctly. Fix: Redis storage, correct ProxyFix.
