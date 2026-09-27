---
name: Channels and notifications
description: tokio channel semantics that lose data or hang — unbounded queues, channels kept open by stray senders, ignored send errors, broadcast lag, watch change tracking and Notify permits.
priority: 58
tags: [CWE-400, CWE-252, CWE-833]
activation:
  content:
    - '\b(?:mpsc|broadcast|watch|oneshot)::'
    - '\bunbounded_channel\(|\bchannel\(\s*\d'
    - '\bNotify\b|\.notify_(?:one|waiters)\('
    - '\.try_send\(|\bRecvError::Lagged\b'
    - '\b(?:flume|crossbeam_channel|async_channel)::'
sources:
  - https://docs.rs/tokio/latest/tokio/sync/mpsc/index.html
  - https://docs.rs/tokio/latest/tokio/sync/broadcast/index.html
  - https://docs.rs/tokio/latest/tokio/sync/watch/struct.Receiver.html
  - https://docs.rs/tokio/latest/tokio/sync/struct.Notify.html
---
- **Unbounded queues**: `unbounded_channel()` (or std/crossbeam unbounded) fed by network input grows without limit when the consumer lags → OOM. Fix: bounded `channel(n)` with backpressure or `try_send` shedding (`channel(0)` panics).
- **Channels that never close**: `recv()` returns `None` only after every `Sender` clone is dropped; a clone kept in shared state or by the consumer itself hangs consumer loops and shutdown. Fix: drop extra senders, `WeakSender`, or a cancellation token.
- **Ignored send failures**: `let _ = tx.send(v)` and ignored `oneshot` send errors mean the receiver is gone (crashed task) → work silently lost. Fix: handle `SendError` — log, stop or restart.
- **broadcast lag**: slow receivers get `RecvError::Lagged(n)` with messages skipped; treating it as fatal ends the loop, ignoring it drops events silently. Fix: handle `Lagged` and resync.
- **watch semantics**: only the latest value is kept (intermediate states are lost by design); `borrow()` doesn't mark it seen, so `changed()` returns again immediately (busy loop). Fix: `borrow_and_update()`.
- **Notify permits**: `notify_waiters()` stores no permit, so waiters not yet registered miss it; `notify_one()` stores at most one, so two notifications racing two waiters can leave one asleep forever. Fix: `Notified::enable()` before checking state, or a channel.
