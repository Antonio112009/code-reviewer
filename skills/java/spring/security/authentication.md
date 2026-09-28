---
name: Authentication and session handling
description: Spring Security authentication defects — custom logins not saving the SecurityContext (6.x), missing session-fixation protection, shared-context mutation, weak or no-op password encoders, BCrypt's 72-byte limit, UserDetails without equals/hashCode and inheritable contexts.
priority: 76
tags: [CWE-384, CWE-256, CWE-916, A07:2025]
activation:
  content:
    - '\b(?:SecurityContextHolder|SecurityContextRepository|SessionAuthenticationStrategy|AuthenticationManager|UsernamePasswordAuthenticationToken)\b'
    - '\b(?:NoOpPasswordEncoder|StandardPasswordEncoder|MessageDigestPasswordEncoder|LdapShaPasswordEncoder|Md4PasswordEncoder|BCryptPasswordEncoder|PasswordEncoder)\b'
    - '\bwithDefaultPasswordEncoder\(|\{noop\}'
    - '\bimplements\s+[\w, ]{0,60}\bUserDetails\b'
    - '\bMODE_INHERITABLETHREADLOCAL\b'
  examples:
    - 'SecurityContextHolder.getContext().setAuthentication(token);'
    - 'PasswordEncoder encoder = new BCryptPasswordEncoder();'
    - 'User.withDefaultPasswordEncoder().username("admin").password("pw").roles("ADMIN").build();'
    - 'public class AppUser implements UserDetails {'
    - 'SecurityContextHolder.setStrategyName(SecurityContextHolder.MODE_INHERITABLETHREADLOCAL);'
sources:
  - https://docs.spring.io/spring-security/reference/servlet/authentication/persistence.html
  - https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html
  - https://docs.spring.io/spring-security/reference/features/authentication/password-storage.html
  - https://spring.io/security/cve-2025-22228
---
- **Context not saved (6.x)**: a custom login endpoint calling `SecurityContextHolder.setContext(...)` without `securityContextRepository.saveContext(...)` → the user is anonymous again on the next request. Fix: save through the `SecurityContextRepository`.
- **No session-fixation protection**: since 6.0 custom authentication must invoke the `SessionAuthenticationStrategy` itself → the session id isn't rotated at login. Fix: call it, or use the built-in login filters.
- **Mutating the shared context**: `SecurityContextHolder.getContext().setAuthentication(...)` instead of `createEmptyContext()` → races between concurrent requests of one session. Fix: create a new context, then set it.
- **Weak encoders**: `NoOpPasswordEncoder`, `{noop}`, `User.withDefaultPasswordEncoder()` (demos only), `StandardPasswordEncoder`/`MessageDigestPasswordEncoder`/`LdapShaPasswordEncoder` → plaintext or fast hashes. Fix: `PasswordEncoderFactories.createDelegatingPasswordEncoder()`.
- **BCrypt 72 bytes**: bcrypt ignores input past 72 bytes; Spring Security up to 6.4.3/6.3.7 let `matches()` accept any password sharing the first 72 characters (CVE-2025-22228). Fix: upgrade; cap password length.
- **UserDetails equality**: custom `UserDetails` without `equals`/`hashCode` → `maximumSessions` control and the session registry never recognize the same user. Fix: implement both on the username.
- **Inheritable context with pools**: the `MODE_INHERITABLETHREADLOCAL` strategy with thread pools leaves another user's authentication on pooled threads. Fix: `DelegatingSecurityContext*` executors.
