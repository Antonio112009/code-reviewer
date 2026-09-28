---
name: Temporaries, guards and copies
description: Ownership traps the compiler accepts — lock guards kept alive by match/while-let/if-let temporaries, `let _` dropping guards at once, move closures copying Copy state, edits to copies, and leaks.
priority: 60
tags: [CWE-833, CWE-667, CWE-401]
activation:
  content:
    - '\.(?:lock|read|write|borrow_mut|borrow|try_lock)\(\)'
    - '\blet\s+_\s*='
    - '\bmove\s*\|'
    - '\bwhile\s+let\b'
    - '\bmem::forget\b|\bBox::leak\b|\bRc::new\(\s*RefCell'
    - '\.enter\(\)|\.acquire(?:_owned)?\(\)|\btempdir\(\)'
  examples:
    - 'let value = cache.borrow_mut();'
    - 'let _ = mutex.lock().await;'
    - 'let handle = thread::spawn(move || counter += 1);'
    - 'while let Some(job) = queue.lock().unwrap().pop() {'
    - 'mem::forget(guard);'
    - 'let permit = semaphore.acquire().await?;'
sources:
  - https://doc.rust-lang.org/reference/destructors.html#temporary-scopes
  - https://doc.rust-lang.org/edition-guide/rust-2024/temporary-if-let-scope.html
  - https://doc.rust-lang.org/std/sync/struct.Mutex.html
---
- **Guard in a `match` scrutinee**: `match m.lock().unwrap().get(&k) {…}` holds the guard through every arm → re-locking in an arm deadlocks. Fix: bind `let v = m.lock().unwrap().get(&k).cloned();` first.
- **`while let` keeps the lock**: `while let Some(j) = q.lock().unwrap().pop() {…}` holds the guard during the body (all editions) → serialized workers; pushing to `q` deadlocks. Fix: pop in its own statement.
- **`if let … else` (edition ≤2021)**: the scrutinee's guard or `RefCell` borrow is still held in `else` → `else { lock.write() }` deadlocks. Edition 2024 drops it before `else`.
- **`let _ =` drops non-std guards at once**: `let _ = mutex.lock().await`, `sem.acquire().await`, `span.enter()`, `tempdir()?` → no exclusion or limit, directory deleted. Fix: `let _guard = …`.
- [full] **Mutating copies**: `move || n += 1` on a `Copy` counter, a `move` thread setting a `bool`, `let mut c = self.cfg;` on a `Copy` struct, `for mut x in items.clone()` → updates silently lost. Fix: `Arc<Atomic*>`, `&mut`, `iter_mut()`.
- **Leaks**: `mem::forget(guard)` never unlocks; `Rc<RefCell<…>>` parent↔child cycles never free; `Box::leak` per request grows memory. Fix: `Weak` back-references.
