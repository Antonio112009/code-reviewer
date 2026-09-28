---
name: Authentication, sessions, CSRF and CORS
description: Django auth and request-forgery defects — raw password storage, hand-rolled login, open next= redirects, mis-ordered login mixins, LoginRequiredMiddleware gaps, object permissions, csrf_exempt/GET writes and credentialed CORS.
priority: 72
tags: [CWE-287, CWE-352, CWE-601, CWE-942, A01:2025, A07:2025]
activation:
  content:
    - '\b(?:authenticate|login|alogin|logout|create_user|set_password|check_password|has_perm|has_perms|get_user_model)\('
    - '\b(?:LoginRequiredMixin|PermissionRequiredMixin|UserPassesTestMixin|login_required|login_not_required|LoginRequiredMiddleware|permission_required)\b'
    - '\b(?:csrf_exempt|require_POST|require_http_methods|url_has_allowed_host_and_scheme)\b'
    - '\bCORS_\w+\s*='
    - '\b(?:redirect|HttpResponseRedirect)\([^)\n]{0,60}\b(?:GET|POST|next|return_to|redirect_to)\b'
    - '\.objects\.create\([^)\n]{0,120}\bpassword\s*='
  examples:
    - 'user = authenticate(request, username=username, password=password)'
    - 'class DashboardView(LoginRequiredMixin, TemplateView):'
    - '@csrf_exempt'
    - 'CORS_ALLOW_ALL_ORIGINS = True'
    - 'return redirect(request.GET["next"])'
    - 'User.objects.create(username=username, password=raw_password)'
sources:
  - https://docs.djangoproject.com/en/stable/topics/auth/default/
  - https://docs.djangoproject.com/en/stable/ref/csrf/
  - https://docs.djangoproject.com/en/stable/ref/middleware/#django.contrib.auth.middleware.LoginRequiredMiddleware
  - https://github.com/adamchainz/django-cors-headers
---
- **Raw passwords**: `User.objects.create(password=...)` or assigning `user.password` stores plaintext and breaks login. Fix: `create_user()` / `set_password()`.
- **Hand-rolled login**: setting `request.session["user_id"]` instead of `authenticate()` + `login()` skips session-key rotation (fixation) and password-change invalidation; `authenticate()` returning `None` must be handled.
- **Open redirect**: `redirect(request.GET["next"])` → phishing. Fix: `url_has_allowed_host_and_scheme(url, allowed_hosts={request.get_host()}, require_https=request.is_secure())`.
- **Mixin order**: `LoginRequiredMixin`/`PermissionRequiredMixin` not leftmost (after `View`) never run; `@login_required` on one CBV method leaves the others open. Fix: leftmost mixin or `method_decorator(..., name="dispatch")`.
- **LoginRequiredMiddleware (5.1+)**: it must follow `AuthenticationMiddleware`; every `@login_not_required` view (and any view exempted by a library) is public, so check each exemption.
- **Object permissions**: with `ModelBackend`, `has_perm(perm, obj)` is always `False`, while `has_perm(perm)` grants every object. Fix: also filter by owner/tenant.
- **CSRF gaps**: `@csrf_exempt` on cookie-authenticated views, or state changes on GET (no `require_POST`) → cross-site actions.
- **Credentialed CORS (django-cors-headers)**: `CORS_ALLOW_ALL_ORIGINS = True` with `CORS_ALLOW_CREDENTIALS = True` echoes any `Origin`; `CORS_ALLOWED_ORIGIN_REGEXES` without `$` (checked with `re.match`) or with unescaped dots accept attacker domains.
