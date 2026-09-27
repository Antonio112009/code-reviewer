---
name: Use-after-free and dangling pointers
description: Freed, out-of-scope or foreign memory used or released again in C/C++ — use after free, double free, list teardown, returned stack addresses, frees of non-heap pointers and allocator mismatches.
priority: 70
tags: [CWE-416, CWE-415, CWE-562, CWE-590, CWE-762]
activation:
  content:
    - '\b(?:free|g_free|kfree|OPENSSL_free|CRYPTO_free)\s*\('
    - '\bdelete\s*(?:\[\s*\]\s*)?[\w(*]'
    - '\breturn\s+&\s*\w'
sources:
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/memory-management-mem/mem30-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/memory-management-mem/mem34-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/declarations-and-initialization-dcl/dcl30-c/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/microsoft-windows-win/win30-c/
---
- **Use after free**: memory read after `free`/`delete` — in error paths, logging (`free(req); log(req->id)`) or through a second pointer → UAF, often exploitable. Fix: release last; NULL shared pointers.
- **Double free**: two owners release one block (struct copies sharing a pointer, an early `free` plus a common cleanup label, callee and caller both freeing) → heap corruption. Fix: a single owner; NULL after free.
- **List teardown**: `for (p = head; p; p = p->next) free(p);` reads `p->next` from freed memory. Fix: save `next` first.
- **Returned stack addresses**: pointers to locals, local arrays, compound literals or `alloca` memory returned or stored in globals/structs → dangling after return (DCL30-C). Fix: caller buffers or heap storage.
- **Freeing what you do not own**: `free(p + off)`, string literals, stack arrays, or results of `getenv`/`strerror`/`localtime`/`inet_ntoa` → heap corruption. Fix: free exactly what the allocator returned.
- **Allocator mismatches**: memory released by another family than it came from (`g_malloc`/`free`, `OPENSSL_malloc`/`free`, another DLL's CRT heap) → corruption. Fix: pair each API's alloc/free.
- **Registered callbacks**: objects freed while still registered with timers, event loops or other threads → UAF when the callback fires. Fix: unregister or join before freeing.
