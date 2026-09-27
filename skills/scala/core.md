---
name: Scala
description: Scala runtime defects, such as partial operations on empty data, blocking or accidentally sequential Futures, eager effects, unjoined fibers and Ref races, actor state leaks, array equality and lazy views, Spark closure traps and raw SQL splices.
category: language
priority: 50
tier: essential
tags:
  - CWE-248
  - CWE-400
  - CWE-362
  - CWE-89
  - OWASP-A05
  - OWASP-A10
activation:
  languages:
    - scala
    - text
  files:
    - "**/*.{scala,sc}"
---
- **Partial calls**: `.get`, `.head`, `.reduce`, `Map(key)` on possibly empty values, `map { case … }` or non-sealed matches → `NoSuchElementException`, `MatchError`; `Some(javaCall())` keeps null. Fix: `headOption`, `collect`, `Option(x)`.
- **Blocking futures**: JDBC, `Thread.sleep` or `Await.result` inside `Future`s on the global or a shared pool, `Duration.Inf` waits → pool starvation, hangs. Fix: a dedicated blocking pool, finite timeouts.
- **Accidental sequencing**: `Future`s created inside a `for`-comprehension run one after another; ones created before it start eagerly even if unused → lost parallelism, stray side effects. Fix: start deliberately, `Future.traverse`.
- **Eager effects**: `IO.pure(effect)`, `Future.successful(compute())` or an `unsafeRunSync()` result in a `val` → runs once at definition, not per call. Fix: `IO.delay`, `ZIO.attempt`.
- **Fiber lifecycles**: discarded `Future`s, `.start` fibers never joined, ZIO `.fork` children interrupted with their parent, `Ref.get` then `set` → lost errors, killed work, lost updates. Fix: `background`, `forkDaemon`, `Ref.update`.
- **Actor state**: `sender()` or mutable actor fields used inside `Future` callbacks (Akka/Pekko) → replies to the wrong actor, data races. Fix: `val s = sender()` first, `pipeTo(self)`.
- **Collections**: `==` on `Array`s (reference), an `Iterator` consumed twice, `mapValues`/`view` results recomputed per access, `List(i)` in loops → always-false checks, empty second pass, O(n²). Fix: `sameElements`, `.toMap`, `Vector`.
- **Spark closures**: driver `var`s mutated in `rdd.foreach` (executors change copies), `collect()` on big data, closures capturing a non-serializable outer class → zero counts, driver OOM, `Task not serializable`. Fix: accumulators.
- **SQL splices**: Slick or Quill `#$value`, doobie `Fragment.const(input)` with user text → SQL injection. Fix: `$value` binds, allowlisted identifiers.
