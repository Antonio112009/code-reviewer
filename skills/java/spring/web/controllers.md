---
name: Spring MVC controllers
description: Controller defects — binding requests straight into entities (mass assignment), serializing entities, parameter names lost without -parameters (Spring 6.1+), leaky or security-masking exception handlers, errors returned as 200 and open redirects.
priority: 66
tags: [CWE-915, CWE-209, CWE-601, A01:2025]
activation:
  content:
    - '@(?:RestController|Controller|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestBody|ModelAttribute|PathVariable|RequestParam|RequestHeader|ExceptionHandler|ControllerAdvice|RestControllerAdvice|ResponseStatus|InitBinder)\b'
    - '"redirect:'
sources:
  - https://docs.spring.io/spring-framework/reference/core/validation/data-binding.html
  - https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-6.1-Release-Notes
  - https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html
  - https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-exceptionhandler.html
---
- **Entities as request models**: `@RequestBody`/`@ModelAttribute` bound to JPA entities → clients set `id`, `role`, `owner` or `balance` (mass assignment), and merges null out unsent fields. Fix: request DTOs, constructor binding, `setAllowedFields`.
- **Entities as responses**: returning entities lets Jackson walk lazy associations (N+1, `LazyInitializationException`, infinite recursion) and expose fields such as password hashes. Fix: response DTOs or projections.
- **Parameter names (Spring 6.1+/Boot 3.2+)**: `@PathVariable Long id`/`@RequestParam String q` without explicit names need the `-parameters` compiler flag, otherwise they fail at runtime. Fix: the flag (Boot build plugins set it) or explicit names.
- **Leaky exception handlers**: `@ExceptionHandler`/`@ControllerAdvice` returning `ex.getMessage()`, SQL errors or stack traces → internal details and data exposed. Fix: generic messages plus an error id; log the details.
- **Handlers masking security**: `@ExceptionHandler(Exception.class)` also catches `AccessDeniedException`/`AuthenticationException` from method security → 500 or 200 instead of 403/401. Fix: rethrow or map them explicitly.
- **Errors as 200**: error bodies returned without `ResponseEntity.status(...)`/`@ResponseStatus` → clients and retries treat failures as success. Fix: proper status codes (`ProblemDetail`).
- **Open redirects**: `"redirect:" + param` or a `Location` header built from request input → phishing through the trusted domain. Fix: allow-listed relative targets.
