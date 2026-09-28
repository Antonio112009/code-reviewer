---
name: gRPC-Go clients and streams
description: ClientConn per call, NewClient versus Dial behaviour, RPCs without deadlines, leaked client streams, concurrent SendMsg, plaintext credentials to remote hosts and keepalive settings the server rejects.
priority: 62
tags: [CWE-404, CWE-319, CWE-400]
activation:
  content:
    - '\bgrpc\.(?:NewClient|Dial\w{0,10}|With\w{2,40}|WaitForReady)\b'
    - '\binsecure\.NewCredentials\b'
    - '\.(?:CloseSend|RecvMsg|SendMsg|CloseAndRecv)\('
    - '\bkeepalive\.ClientParameters\b'
  examples:
    - 'conn, err := grpc.NewClient(target, grpc.WithTransportCredentials(creds))'
    - 'creds := insecure.NewCredentials()'
    - 'if err := stream.CloseSend(); err != nil { return err }'
    - 'kp := keepalive.ClientParameters{Time: 30 * time.Second}'
sources:
  - https://github.com/grpc/grpc-go/blob/master/Documentation/anti-patterns.md
  - https://pkg.go.dev/google.golang.org/grpc#ClientConn.NewStream
  - https://github.com/grpc/grpc-go/blob/master/Documentation/keepalive.md
---
- **Connection per call**: `grpc.NewClient`/`Dial` inside handlers or per RPC (often never closed) → leaked connections and goroutines, a TLS handshake per request. Fix: one long-lived `ClientConn` per target, closed at shutdown.
- **NewClient vs Dial**: `NewClient` (grpc-go 1.63+) connects lazily and defaults to the `dns` resolver (Dial: `passthrough`); `WithBlock`/`FailOnNonTempDialError` don't apply → bad addresses surface on the first RPC, custom resolvers need the right scheme. Fix: handle RPC errors.
- **No deadline**: RPCs made with `context.Background()` or without a timeout wait forever on a stuck server. Fix: per-call `context.WithTimeout`.
- **Stream leaks**: a client stream is released only when its ctx is cancelled, `RecvMsg` returns a non-nil error, or the conn closes — `CloseSend` alone leaks it. Fix: `defer cancel()` for the stream ctx; read until `io.EOF`.
- **Concurrent SendMsg**: one sender plus one receiver per stream is safe; `Send`/`SendMsg` from several goroutines corrupts the stream. Fix: a single sending goroutine.
- **Plaintext**: `insecure.NewCredentials()` (or deprecated `WithInsecure`) to non-local hosts sends tokens and data unencrypted. Fix: TLS credentials.
- **Keepalive rejected**: client `keepalive.ClientParameters{Time: <5m}` against servers with the default enforcement policy (MinTime 5 min) → GOAWAY `too_many_pings`, connection churn. Fix: align server `EnforcementPolicy`.
