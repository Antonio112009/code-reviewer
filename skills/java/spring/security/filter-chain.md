---
name: SecurityFilterChain authorization rules
description: HTTP authorization misconfiguration — first-match rule ordering, unmatched requests allowed in Spring Security 5, antMatchers/MVC path mismatches, multiple chains without securityMatcher, web.ignoring(), header-trusting custom filters and a weakened HttpFirewall.
priority: 78
tags: [CWE-862, CWE-863, CWE-284, A01:2025]
activation:
  content:
    - '\b(?:SecurityFilterChain|HttpSecurity|WebSecurityCustomizer|WebSecurityConfigurerAdapter|OncePerRequestFilter|HttpFirewall|StrictHttpFirewall)\b'
    - '\.(?:authorizeHttpRequests|authorizeRequests|authorizeExchange|requestMatchers|antMatchers|mvcMatchers|securityMatcher|anyRequest|permitAll|ignoring)\('
  examples:
    - 'SecurityFilterChain filterChain(HttpSecurity http) throws Exception {'
    - 'http.authorizeHttpRequests(auth -> auth.requestMatchers("/admin/**").hasRole("ADMIN"));'
sources:
  - https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html
  - https://github.com/spring-projects/spring-security/issues/11958
  - https://docs.spring.io/spring-security/reference/servlet/exploits/firewall.html
---
- **First match wins**: a broad rule (`/api/**` with `permitAll()` or just `authenticated()`) declared before narrower admin rules makes those rules unreachable. Fix: most specific matchers first, `anyRequest()` last.
- **No default deny (Spring Security 5)**: on 5.x, requests matching no rule are allowed (6.x denies them). Fix: always end with `anyRequest().authenticated()` or `denyAll()`.
- **Path mismatch (Spring Security 5 / Boot 2)**: `antMatchers("/admin")` doesn't cover `/admin/` or `/admin.json`, which Spring MVC 5 still routes (trailing-slash/suffix matching) → bypass. Fix: `mvcMatchers`/`requestMatchers` (5.8+), `/admin/**`.
- **Multiple chains**: several `SecurityFilterChain` beans without `securityMatcher(...)` and `@Order` → the first chain handles every request and stricter chains never run. Fix: scope and order each chain.
- **web.ignoring()**: `WebSecurityCustomizer` ignoring non-static paths skips all security for them (authorization, headers, firewall). Fix: `permitAll()` in the chain; ignore only static resources.
- **Trusting custom filters**: `OncePerRequestFilter`s that authenticate from headers (`X-User-Id`, API keys) without rejecting missing or invalid values, or skip paths via `getRequestURI().startsWith(...)` (bypassable with `;` or encoded segments). Fix: fail closed; use request matchers.
- **Weakened firewall**: relaxing `StrictHttpFirewall` (`setAllowUrlEncodedSlash(true)`, `setAllowSemicolon(true)`) or using `DefaultHttpFirewall` → path confusion that bypasses matchers. Fix: keep the defaults.
