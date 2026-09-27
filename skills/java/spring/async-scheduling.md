---
name: '@Async, @Scheduled and task executors'
description: Spring task execution defects — unbounded default executors, lost @Async exceptions and security/MDC context, single-threaded and per-replica @Scheduled jobs, 6-field cron and server time zones, and virtual-thread settings (Boot 3.2+).
priority: 64
tags: [CWE-400, CWE-362]
activation:
  content:
    - '@(?:Async|Scheduled|Schedules|EnableAsync|EnableScheduling)\b'
    - '\b(?:ThreadPoolTaskExecutor|ThreadPoolTaskScheduler|SimpleAsyncTaskExecutor|TaskDecorator|AsyncConfigurer|SchedulingConfigurer)\b'
    - '\bspring\.(?:task|threads|main\.keep-alive)\b'
    - '^\s*(?:task|threads|virtual|keep-alive|scheduling|execution):'
sources:
  - https://docs.spring.io/spring-boot/reference/features/task-execution-and-scheduling.html
  - https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/annotation/EnableAsync.html
  - https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/annotation/Scheduled.html
  - https://docs.spring.io/spring-boot/reference/features/spring-application.html
---
- **Unbounded @Async executor**: Boot's `ThreadPoolTaskExecutor` runs 8 threads over an unbounded queue (`max-size` never applies) → backlog, work lost at shutdown; without Boot or an executor bean, `SimpleAsyncTaskExecutor` starts a thread per task. Fix: bounded queue.
- **Lost exceptions**: exceptions from `@Async void` methods are only logged → failures invisible to callers. Fix: return `CompletableFuture` and handle it.
- **Lost context**: `SecurityContext`, MDC, request attributes and the caller's transaction don't reach `@Async` threads. Fix: `TaskDecorator`, `DelegatingSecurityContextAsyncTaskExecutor`, or context propagation (automatic for `@Async` since Boot 4.1).
- **Single scheduler thread**: Boot's default `ThreadPoolTaskScheduler` has one thread → a slow or hung `@Scheduled` job delays all others. Fix: `spring.task.scheduling.pool.size` or dedicated executors.
- **Every replica runs it**: `@Scheduled` jobs run on each instance → duplicate emails, charges or imports. Fix: ShedLock/DB lock, leader election or an external scheduler.
- **Cron fields and zone**: Spring cron has 6 fields, seconds first — `"* 0 * * * *"` fires every second of minute 0, not hourly; `zone` defaults to the server's. Fix: `"0 0 * * * *"`, explicit `zone`.
- **Virtual threads (Boot 3.2+, JDK 21+)**: `spring.threads.virtual.enabled=true` ignores pool-size properties (guard DB/HTTP pools yourself), lets the JVM exit when only virtual threads run (`spring.main.keep-alive=true`), and runs `fixedDelay` tasks on one thread.
