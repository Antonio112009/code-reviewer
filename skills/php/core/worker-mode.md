---
name: Long-running workers and event loops
description: Code running in FrankenPHP worker mode, RoadRunner, Swoole/OpenSwoole, ReactPHP/Amp or forked processes — state leaking between requests, superglobals, exit(), stale connections, blocking calls and per-process settings.
priority: 62
tags: [CWE-488, CWE-401, CWE-404]
activation:
  content:
    - '\bfrankenphp_handle_request\s*\(|\bSpiral\\RoadRunner\\|\bPSR7Worker\b'
    - '\b(?:Open)?Swoole\\|\bHyperf\\|\bWorkerman\\|\bReact\\(?:Http|EventLoop)\\|\bAmp\\'
    - '\bpcntl_fork\s*\('
  examples:
    - 'use Spiral\RoadRunner\PSR7Worker;'
    - 'use Swoole\Coroutine;'
    - 'pcntl_fork();'
sources:
  - https://frankenphp.dev/docs/worker/
  - https://docs.roadrunner.dev/docs/php-worker/worker
  - https://www.php.net/manual/en/function.pcntl-fork.php
  - https://www.php.net/manual/en/migration84.incompatible.php
---
- **State between requests**: statics, singletons, globals and in-memory caches survive the request → user A's auth, tenant, locale or cart served to user B; unbounded caches grow until OOM. Fix: reset per request, request-scoped objects.
- **Process-wide settings**: `date_default_timezone_set()`, `setlocale()`, `ini_set()`, `error_reporting()` persist for the next request on that worker. Fix: set per request or restore in `finally`.
- **Superglobals and headers**: in Swoole/RoadRunner/ReactPHP `$_SERVER`, `$_GET`, `$_SESSION`, `header()`, `setcookie()` are not tied to the current request; FrankenPHP resets superglobals except `$_ENV` → use the PSR-7/framework request, never write request data to `$_ENV`.
- **exit and shutdown**: `exit()`/`die()` end the worker script (restart, lost in-flight work); `register_shutdown_function` callbacks and destructors of long-lived objects run only when the worker script ends.
- **Stale connections**: DB/Redis connections time out between requests (MySQL 8.0.24+ reports error 4031, not 2006, so reconnect checks on 2006 miss it) or keep a failed request's open transaction and locks. Fix: ping/reconnect, roll back per request.
- **Blocking calls**: in Swoole/ReactPHP/Amp loops, `sleep()`, PDO, `file_get_contents()` block every concurrent request on the worker. Fix: async clients or offload.
- **pcntl_fork**: children inherit open DB/Redis sockets → parent and child interleave on one connection or close it for each other. Fix: reconnect in the child.
