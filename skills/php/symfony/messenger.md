---
name: Messenger handlers and workers
description: Symfony Messenger reliability — unrouted messages handled synchronously, retries then silent discard without a failure transport, non-idempotent handlers, entities in messages, dispatch before commit, worker state and message decoding after deploys.
priority: 66
tags: [CWE-362, CWE-755, CWE-488]
activation:
  files: ["**/config/packages/messenger.{yaml,yml,php}"]
  content:
    - '#\[(?:AsMessageHandler|AsMessage)\b|\bMessageBusInterface\b|\bDispatchAfterCurrentBusStamp\b'
    - '\b(?:failure_transport|max_retries|doctrine_transaction)\b|\b(?:Unr|R)ecoverableMessageHandlingException\b'
sources:
  - https://symfony.com/doc/current/messenger.html
  - https://symfony.com/doc/current/messenger.html#retries-failures
  - https://symfony.com/doc/current/messenger/dispatch_after_current_bus.html
---
- **Unrouted means synchronous**: messages without a `routing` entry or `#[AsMessage]` transport are handled inside the HTTP request → slow responses and handler exceptions shown to users. Fix: route every async message ('*' also catches Mailer messages).
- **Retry then discard**: failures retry 3 times (1s, 2s, 4s) and are then dropped unless a `failure_transport` exists; `RecoverableMessageHandlingException` retries forever. Fix: configure failure transports and alerting.
- **At-least-once delivery**: a crash after handling but before ack re-delivers the message → double charges or e-mails. Fix: idempotency keys derived from the business event plus a unique constraint.
- **Entities in messages**: serialized entities are stale snapshots and detached from the EntityManager in the worker. Fix: send ids and re-fetch.
- **Dispatch before commit**: messages dispatched before `flush()` or inside a later-rolled-back transaction are consumed before the row exists or for undone work. Fix: `DispatchAfterCurrentBusStamp` with `doctrine_transaction`, or dispatch after commit.
- **Worker state**: `messenger:consume` keeps services alive; per-message state is cleared only for services implementing `ResetInterface` (and not at all with `--no-reset`) → data from one message leaks into the next. Fix: `ResetInterface`, `--time-limit`/`--memory-limit`.
- **Deploys**: renaming a message class or changing its constructor breaks decoding of messages already queued → failures after release. Fix: keep old shapes until queues drain.
