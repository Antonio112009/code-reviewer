---
name: Shared mutable state and atomicity
description: Data races on shared fields and collections — non-thread-safe types shared across threads, check-then-act on maps, slow or recursive computeIfAbsent, non-atomic compound updates, missing volatile publication and nulls in ConcurrentHashMap.
priority: 66
tags: [CWE-362, CWE-366, CWE-567]
activation:
  content:
    - '\b(?:ConcurrentHashMap|ConcurrentMap|ConcurrentSkipListMap|CopyOnWriteArrayList|AtomicInteger|AtomicLong|AtomicBoolean|AtomicReference|LongAdder)\b'
    - '\bvolatile\b'
    - '\bstatic\s+(?:final\s+)?(?:Map|HashMap|List|ArrayList|Set|HashSet|StringBuilder)\b'
    - '\bCollections\.synchronized\w+\('
    - '\.(?:putIfAbsent|computeIfAbsent|computeIfPresent|compute|merge)\('
  examples:
    - 'private final AtomicLong counter = new AtomicLong();'
    - 'private volatile boolean initialized;'
    - 'private static final Map<String, User> CACHE = new HashMap<>();'
    - 'List<String> names = Collections.synchronizedList(new ArrayList<>());'
    - 'cache.computeIfAbsent(key, k -> loadValue(k));'
sources:
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/package-summary.html
  - https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.4
---
- **Unsafe shared types**: `HashMap`, `ArrayList`, `HashSet` or `StringBuilder` in static fields or singletons used by several threads → lost updates, corrupted structures. Fix: concurrent collections, immutability or confinement.
- **Check-then-act**: `if (!map.containsKey(k)) map.put(k, v)` or get → compute → put on a shared map → duplicate work, lost values. Fix: `putIfAbsent`, `computeIfAbsent`, `merge`.
- **Heavy or recursive compute**: `ConcurrentHashMap.computeIfAbsent`/`compute` doing I/O blocks other writers; touching the same map inside throws `IllegalStateException: Recursive update` or deadlocks. Fix: compute outside, then `putIfAbsent`.
- **Non-atomic compound ops**: `count++` on a `volatile`, `atomic.set(atomic.get() + 1)`, `if (flag.get()) flag.set(false)` → races. Fix: `incrementAndGet`, `updateAndGet`, `compareAndSet`, `LongAdder`.
- **Missing visibility**: stop flags, lazily created singletons or swapped config without `volatile`/locking → other threads may never see updates; double-checked locking without `volatile` publishes half-built objects. Fix: `volatile`, holder idiom, `AtomicReference`.
- **Synchronized wrappers**: iterating `Collections.synchronizedList/Map` without holding its lock → `ConcurrentModificationException`; `ConcurrentHashMap.size()`/`isEmpty()` are estimates, not control flow. Fix: lock around iteration; atomic methods.
- **Nulls in ConcurrentHashMap**: null keys or values (e.g., caching "not found" as `null`) throw NPE, unlike `HashMap`. Fix: sentinel values or `Optional`.
