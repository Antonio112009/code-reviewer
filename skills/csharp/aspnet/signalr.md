---
name: SignalR hubs
description: SignalR defects — hub methods trusting client-supplied ids, principals cached for the connection lifetime, state in hub instances or static maps, groups lost on reconnect, access tokens in query strings and raised message/concurrency limits or detailed errors.
priority: 70
tags: [CWE-639, CWE-613, CWE-598, A01:2025]
activation:
  content:
    - ':\s*Hub(?:<\w+>)?\b|\bIHubContext<|\bMapHub<|\bHubConnection(?:Builder)?\b'
    - '\bClients\.(?:All|Caller|Others|Group|Groups|User|Users|Client|AllExcept)\b|\bGroups\.(?:Add|Remove)\w*Async\('
    - '\bOnConnectedAsync\(|\baccess_token\b|\bMaximumReceiveMessageSize\b|\bMaximumParallelInvocationsPerClient\b|\bEnableDetailedErrors\b'
  examples:
    - 'public class ChatHub : Hub'
    - 'await Clients.Group(groupName).SendAsync("ReceiveMessage", message);'
    - 'public override Task OnConnectedAsync() => Groups.AddToGroupAsync(Context.ConnectionId, groupName);'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/signalr/authn-and-authz
  - https://learn.microsoft.com/en-us/aspnet/core/signalr/security
  - https://learn.microsoft.com/en-us/aspnet/core/signalr/configuration
  - https://learn.microsoft.com/en-us/aspnet/core/signalr/groups
---
- **Client-supplied ids**: `[Authorize]` on the hub only proves authentication; methods like `JoinGroup(string orderId)`/`SendTo(userId, …)` that act on caller-provided ids without checking `Context.User`/`Context.UserIdentifier` → any user reads or writes others' data. Fix: ownership checks per method.
- **Stale principal**: the user is captured at connect time and cached — role changes, logout or token expiry don't affect an open WebSocket by default. Fix: `CloseOnAuthenticationExpiration`, disconnect on revocation.
- **State in hubs**: a hub instance is created per invocation, so fields don't survive between calls; static connection dictionaries leak and break when scaled out. Fix: groups/`IHubContext`, an external store and a backplane for multiple instances.
- **Groups on reconnect**: membership isn't restored after a reconnect (new connection id) → clients silently stop receiving group messages. Fix: re-add in `OnConnectedAsync` from server-side state.
- **Tokens in URLs**: browsers send `access_token` in the query string for WebSockets/SSE → logged by proxies and request logs; accepting query tokens on every path makes URL tokens valid app-wide. Fix: read them only for hub paths in `OnMessageReceived`, scrub logs.
- **Limits and errors**: raising `MaximumReceiveMessageSize` (32 KB) or `MaximumParallelInvocationsPerClient` (1) → memory/CPU abuse; `EnableDetailedErrors = true` in production sends exception messages to clients. Fix: keep defaults, stream large payloads.
