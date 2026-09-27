---
name: JDK upgrade compatibility
description: Code that breaks or degrades on newer JDKs — reflective access to JDK internals (17+), final-field mutation (warns on 26), Security Manager (24), Thread.stop (20+), sun.misc.Unsafe memory access (warns on 24), dynamic agents (21) and finalizers.
priority: 56
tags: [CWE-477]
activation:
  content:
    - '\.setAccessible\(\s*true'
    - '\b(?:SecurityManager|AccessController)\b|\bsetSecurityManager\('
    - '\bsun\.misc\.Unsafe\b|\bjdk\.internal\.'
    - '[Tt]hread\w{0,30}(?:\(\))?\.(?:stop|suspend|resume)\(\s*\)'
    - '\bvoid\s+finalize\s*\(\s*\)'
    - '\bVirtualMachine\.attach\(|\bByteBuddyAgent\.install\('
sources:
  - https://openjdk.org/jeps/403
  - https://openjdk.org/jeps/500
  - https://openjdk.org/jeps/486
  - https://openjdk.org/jeps/451
---
- **Reflection into the JDK**: `setAccessible(true)` on `java.*`/`sun.*` members throws `InaccessibleObjectException` on JDK 17+ (JEP 403) unless `--add-opens` is configured. Fix: public APIs or documented `--add-opens`.
- **Mutating final fields**: `Field.set` on `final` fields warns on JDK 26 (JEP 500) and will throw in a later release; records already refuse. Fix: constructors/builders instead of reflection.
- **Security Manager**: on JDK 24+ (JEP 486) `System.setSecurityManager` throws, `AccessController.checkPermission` always throws and `doPrivileged` no longer elevates → sandboxing code stops protecting anything. Fix: OS/container isolation.
- **Thread.stop/suspend/resume**: `stop()` throws `UnsupportedOperationException` since JDK 20; `suspend`/`resume` were removed in JDK 23. Fix: cooperative cancellation via `interrupt()`.
- **sun.misc.Unsafe**: memory-access methods warn on JDK 24+ (JEP 498) and are slated for removal. Fix: `VarHandle` or the FFM API.
- **Dynamic agents**: attaching agents at runtime (`ByteBuddyAgent.install`, `VirtualMachine.attach` to the own JVM) warns on JDK 21+ (JEP 451) and will be disallowed. Fix: `-javaagent` on the command line.
- **Finalizers**: `finalize()` used for cleanup is deprecated for removal (JEP 421, JDK 18) and off with `--finalization=disabled` → leaked native resources. Fix: try-with-resources or `Cleaner`.
