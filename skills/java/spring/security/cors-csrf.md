---
name: CSRF and CORS configuration
description: Spring Security CSRF and CORS mistakes — csrf().disable() with cookie or session authentication, broad CSRF exclusions, SPA token handling in 6.x, state-changing GET or method-less mappings, and credentialed wildcard CORS via allowedOriginPatterns.
priority: 76
tags: [CWE-352, CWE-942, CWE-346, A01:2025]
activation:
  content:
    - '\.csrf\('
    - '\b(?:CsrfTokenRepository|CookieCsrfTokenRepository|CsrfTokenRequestAttributeHandler|XorCsrfTokenRequestAttributeHandler)\b'
    - '\b(?:CorsConfiguration|CorsConfigurationSource|CorsRegistry|UrlBasedCorsConfigurationSource)\b'
    - '@CrossOrigin\b'
    - '\.(?:allowedOrigins|allowedOriginPatterns|setAllowedOrigins|setAllowedOriginPatterns|allowCredentials|setAllowCredentials|cors)\('
    - '@(?:RequestMapping|GetMapping)\b'
  examples:
    - 'http.csrf(csrf -> csrf.disable());'
    - 'CookieCsrfTokenRepository repo = CookieCsrfTokenRepository.withHttpOnlyFalse();'
    - 'CorsConfiguration config = new CorsConfiguration();'
    - '@CrossOrigin(origins = "*")'
    - 'config.setAllowedOriginPatterns(List.of("*"));'
    - '@GetMapping("/api/orders")'
sources:
  - https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html
  - https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/cors/CorsConfiguration.html
  - https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html
---
- **CSRF disabled with cookies**: `csrf(c -> c.disable())` while browsers authenticate with session cookies (form login, `oauth2Login`, remember-me, cookie-held tokens) → cross-site requests act as the user. Fix: disable only for stateless `Authorization`-header APIs.
- **SPA "fix"**: disabling CSRF because Spring Security 6's BREACH-masked tokens broke a JavaScript client. Fix: `csrf.spa()` (6.4+) or `CookieCsrfTokenRepository.withHttpOnlyFalse()` with a plain `CsrfTokenRequestAttributeHandler`.
- **Broad exclusions**: `ignoringRequestMatchers("/api/**")` covering endpoints that browsers call with cookies. Fix: exclude only machine-to-machine paths.
- **State changes over GET**: CSRF checks skip safe methods, so `@GetMapping` or method-less `@RequestMapping` handlers that modify data are forgeable (and triggered by crawlers or prefetch). Fix: POST/PUT/DELETE with an explicit `method`.
- **Credentialed wildcard CORS**: `allowedOriginPatterns("*")` or an echoed `Origin` with `allowCredentials(true)` — the usual workaround after `allowedOrigins("*")` plus credentials is rejected — lets any site read authenticated responses. Fix: explicit trusted origins.
