---
name: Locks and borrows across .await
description: Guards and borrows held across await points — std/parking_lot guards in !Send contexts, tokio Mutex over I/O, re-entrant tokio RwLock reads, DashMap shard guards, RefCell borrows and watch::Ref.
priority: 62
tags: [CWE-833, CWE-667]
activation:
  content:
    - '\.(?:lock|read|write|try_lock)\(\)'
    - '\bDash(?:Map|Set)\b'
    - '\bRefCell\b|\.borrow(?:_mut)?\(\)'
    - '\bwatch::|\.borrow_and_update\(\)'
    - '\bparking_lot\b|\bspawn_local\b|\bLocalSet\b|current_thread'
  examples:
    - 'let guard = state.lock().await;'
    - 'let map: DashMap<String, User> = DashMap::new();'
    - 'let cache: RefCell<HashMap<u32, User>> = RefCell::new(HashMap::new());'
    - 'let value = *rx.borrow_and_update();'
    - 'use parking_lot::Mutex;'
sources:
  - https://tokio.rs/tokio/tutorial/shared-state
  - https://docs.rs/tokio/latest/tokio/sync/struct.RwLock.html
  - https://docs.rs/tokio/latest/tokio/sync/watch/struct.Receiver.html#method.borrow
  - https://docs.rs/dashmap/latest/dashmap/struct.DashMap.html
---
- **Sync guards across `.await`**: `tokio::spawn` rejects them (`!Send`), but they compile in `spawn_local`/`LocalSet`, current-thread runtimes, actix handlers and with parking_lot's `send_guard` → deadlock when another task on the thread locks. Fix: end the guard's scope before `.await`.
- **tokio `Mutex` over I/O**: holding the guard across network/DB calls serializes every request behind the slowest; holding it while `send().await`-ing to a bounded channel whose consumer needs the lock deadlocks. Fix: copy out, release, then await.
- **tokio `RwLock` re-read**: it is write-preferring, so a task holding a read guard that awaits `read()` again deadlocks once a writer queues. Fix: pass the guard down.
- **DashMap guards**: `get`, `get_mut`, `entry` and `iter` hold shard locks; keeping one across `.await`, or calling `insert`/`remove` on the same map while it lives → deadlock. Fix: clone the value out and drop the `Ref` first.
- **`RefCell` in `!Send` futures**: a `borrow_mut()` alive across `.await` (LocalSet, wasm) panics when another task borrows. Fix: scope borrows between awaits.
- **`watch::Ref`**: `rx.borrow()` holds a read lock; keeping it across `.await` or slow work blocks `send()` and can deadlock. Fix: clone the value.
- **Not every std `Mutex` is a bug**: short critical sections without `.await` should stay on `std::sync::Mutex` (faster than tokio's); flag only guards crossing `.await` or long blocking.
