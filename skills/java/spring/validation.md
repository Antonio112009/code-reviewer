---
name: Bean Validation in Spring
description: Validation that silently doesn't run — missing @Valid on request bodies and nested objects, method-validation differences before/after Spring 6.1, ignored BindingResult, no validator on the classpath, null-tolerant constraints and validation groups.
priority: 64
tags: [CWE-20, CWE-1173]
activation:
  content:
    - '@(?:Valid|Validated|NotNull|NotBlank|NotEmpty|Size|Min|Max|Pattern|Email|Positive|PositiveOrZero|Negative|Past|Future|Digits|DecimalMin|DecimalMax|AssertTrue)\b'
    - '\bBindingResult\b'
    - '\b(?:jakarta|javax)\.validation\b'
  examples:
    - '@NotBlank private String name;'
    - 'public void create(@Valid @RequestBody Order order, BindingResult result) {'
    - 'import jakarta.validation.Valid;'
sources:
  - https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-validation.html
  - https://docs.spring.io/spring-framework/reference/core/validation/beanvalidation.html
  - https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-2.3-Release-Notes
---
- **No @Valid on the argument**: `@RequestBody`/`@ModelAttribute`/`@RequestPart` parameters without `@Valid`/`@Validated` → constraints on the DTO never run. Fix: annotate the parameter.
- **Nested objects and elements**: constraints inside nested DTOs or collection elements run only with `@Valid` on the field or type argument (`List<@Valid Item>`). Fix: add cascading `@Valid`.
- **Parameter constraints**: `@RequestParam @Min(1) int page` is validated natively only since Spring 6.1; earlier it needs a class-level `@Validated`. On 6.1+ a class-level `@Validated` switches to AOP validation (`ConstraintViolationException`, often a 500). Fix: follow the version's model.
- **Ignored BindingResult**: a `BindingResult`/`Errors` parameter makes Spring invoke the handler even when validation failed → invalid data processed unless `hasErrors()` is checked. Fix: check it or drop the parameter.
- **No validator present**: since Boot 2.3 web starters don't include `spring-boot-starter-validation` → without a Bean Validation provider the annotations do nothing. Fix: add the starter.
- **null passes most constraints**: `@Size`, `@Email`, `@Pattern`, `@Min` accept `null`; `@NotNull` accepts `""`. Fix: combine with `@NotNull`/`@NotBlank`.
- **Groups**: constraints declared with `groups = X.class` don't run under plain `@Valid` (Default group only). Fix: `@Validated(X.class)` or include `Default`.
