---
name: gRPC-Go servers and interceptors
description: Handler panics crashing the server, auth only in unary interceptors, plain errors leaking as codes.Unknown, trusting incoming metadata, message/stream limits, GracefulStop hangs and stream handlers sending after return.
priority: 66
tags: [CWE-248, CWE-285, CWE-209, CWE-400]
activation:
  content:
    - '\bgrpc\.(?:NewServer|UnaryInterceptor|StreamInterceptor|ChainUnaryInterceptor|ChainStreamInterceptor|MaxRecvMsgSize|MaxConcurrentStreams|KeepaliveParams|KeepaliveEnforcementPolicy|Creds)\b'
    - '\.(?:GracefulStop|RegisterService)\('
    - '\bmetadata\.FromIncomingContext\b'
    - '\bstatus\.(?:Error|Errorf|New)\b'
    - '\bUnimplemented\w{1,60}Server\b'
sources:
  - https://pkg.go.dev/github.com/grpc-ecosystem/go-grpc-middleware/v2/interceptors/recovery
  - https://pkg.go.dev/google.golang.org/grpc/status#FromError
  - https://pkg.go.dev/google.golang.org/grpc
---
- **Panics kill the server**: grpc-go does not recover handler panics → one nil dereference terminates the process for every client. Fix: recovery interceptors for both unary and stream (`go-grpc-middleware/v2/interceptors/recovery`).
- **Unary-only auth**: authentication/authorisation installed via `UnaryInterceptor`/`ChainUnaryInterceptor` only → streaming RPCs bypass it. Fix: matching `ChainStreamInterceptor`, or checks in each method.
- **Plain errors**: returning `err`/`fmt.Errorf` from handlers becomes `codes.Unknown` with `err.Error()` sent to the client → SQL/paths leak and clients can't branch on codes. Fix: `status.Error(codes.NotFound, "…")`; map internal errors.
- **Trusted metadata**: user ids, tenants or `x-forwarded-for` read via `metadata.FromIncomingContext` are client-controlled unless a trusted proxy sets them. Fix: derive identity from verified credentials (mTLS, JWT).
- **Limits**: raising `MaxRecvMsgSize` (default 4 MiB) or accumulating client streams in memory, without `MaxConcurrentStreams` → memory exhaustion. Fix: bounded sizes and per-stream processing.
- **Shutdown**: `GracefulStop` waits forever for long-lived streams. Fix: run it with a timeout, then `Stop()`.
- **Stream handler lifetime**: returning from a stream handler ends the stream; goroutines still calling `stream.Send` afterwards, or several goroutines sending at once, fail or race. Fix: one sender; wait before returning.
