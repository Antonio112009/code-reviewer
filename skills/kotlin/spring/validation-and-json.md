---
name: Validation annotations and Jackson in Spring
description: Kotlin + Spring input handling — Bean Validation annotations on constructor properties that land on the parameter only (Kotlin < 2.4), nested @Valid not applied, and custom ObjectMapper beans that drop the Kotlin module.
priority: 64
tags: [CWE-20, CWE-1287]
activation:
  content:
    - '@(?:NotBlank|NotNull|NotEmpty|Size|Min|Max|Email|Pattern|Positive|PositiveOrZero|Past|Future|Valid|DecimalMin|DecimalMax)\b'
    - '@field:\w+'
    - '\bObjectMapper\s*\(|\bJsonMapper\.builder\s*\(|\bJackson2ObjectMapperBuilder\w*\b'
    - '\bXannotation-default-target\b'
  examples:
    - 'data class Req(@NotBlank val name: String)'
    - 'data class Req(@field:NotBlank val name: String)'
    - 'val mapper = ObjectMapper()'
    - 'freeCompilerArgs.add("-Xannotation-default-target=param-property")'
sources:
  - https://kotlinlang.org/docs/annotations.html#annotation-use-site-targets
  - https://kotlinlang.org/docs/compatibility-guide-24.html#change-default-use-site-target-selection-for-annotations
  - https://docs.spring.io/spring-boot/reference/features/json.html
---
- **Constraints on the parameter only (Kotlin < 2.4)**: in `data class Req(@NotBlank val name: String)` the annotation targets only the constructor parameter → Bean Validation (fields/getters) never sees it → invalid input accepted. Fix: `@field:NotBlank`, or Kotlin 2.4+ defaults.
- **Nested objects unchecked**: the same applies to `@Valid` on nested DTO properties → nested objects skip validation entirely. Fix: `@field:Valid` on Kotlin < 2.4.
- **Custom mapper bean**: an `ObjectMapper`/`JsonMapper` bean built from scratch (Boot 4 defaults to Jackson 3) replaces Boot's auto-configured mapper and its Kotlin module → DTOs without default constructors fail, defaults ignored. Fix: customize Boot's builder.
- **Behavior change on upgrade**: Kotlin 2.4 (or `-Xannotation-default-target=param-property` on 2.2–2.3) re-targets unqualified annotations to param+field → validation that was silently off starts rejecting requests. Fix: review DTO annotations and API tests when upgrading.
