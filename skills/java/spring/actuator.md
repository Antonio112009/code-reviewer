---
name: Spring Boot Actuator exposure
description: Actuator misconfiguration — exposing heapdump/env/configprops/loggers/shutdown over HTTP, actuator security backing off with a custom SecurityFilterChain, unmasked values, public health details, write access and liveness probes that check dependencies.
priority: 70
tags: [CWE-200, CWE-215, CWE-306, A02:2025]
activation:
  content:
    - '\bmanagement\.'
    - '^\s*(?:management|exposure|endpoints?|show-values|show-details|access):'
    - '^\s*include:\s*["'']?\*'
    - '\b(?:heapdump|threaddump|configprops|jolokia)\b'
    - '\bEndpointRequest\b'
    - '@(?:Endpoint|WebEndpoint|ReadOperation|WriteOperation|DeleteOperation)\b'
  examples:
    - 'management.endpoints.web.exposure.include=*'
    - 'endpoints:'
    - '  include: "*"'
    - 'management.endpoint.heapdump.enabled=true'
    - '.requestMatchers(EndpointRequest.toAnyEndpoint()).hasRole("ADMIN")'
    - '@Endpoint(id = "custom")'
sources:
  - https://docs.spring.io/spring-boot/reference/actuator/endpoints.html
  - https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide
  - https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide
---
- **Sensitive endpoints exposed**: `management.endpoints.web.exposure.include=*` or listing `heapdump`, `env`, `configprops`, `threaddump`, `loggers`, `mappings`, `jolokia`, `shutdown` → heap dumps leak secrets and sessions, `loggers` POST changes levels, `shutdown` stops the app. Fix: expose `health`/`info`, secure the rest.
- **Security backs off**: defining any `SecurityFilterChain` turns off Boot's actuator protection → `/actuator/**` falls under app rules (e.g., `permitAll` on `/**`). Fix: an explicit chain for `EndpointRequest.toAnyEndpoint()` requiring an admin role.
- **Unmasked values**: `show-values: always` on `env`/`configprops` exposes secrets; Boot 3+ masks everything by default, Boot 2 only keys like `password`/`secret`/`token` → custom secret names leak. Fix: `never` or `when-authorized` with roles.
- **Public health details**: `management.endpoint.health.show-details=always` → DB, disk, version and host details for anonymous callers. Fix: `when-authorized`.
- **Public port**: actuator served on the application port behind the public load balancer. Fix: `management.server.port` on an internal network.
- **Write access (Boot 3.4+)**: `management.endpoints.access.default` / `management.endpoint.<id>.access: unrestricted` enable write operations. Fix: `read-only` unless writes are needed.
- **Probes (enabled by default in Boot 4)**: DB or remote checks added to the liveness group → restarts during a dependency outage. Fix: external checks in readiness only.
