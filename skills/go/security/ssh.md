---
name: golang.org/x/crypto/ssh clients and servers
description: Host keys ignored with InsecureIgnoreHostKey, clients without timeouts, servers authorising by a PublicKeyCallback key the client never proved (CVE-2024-45337), NoClientAuth and remote commands built from input.
priority: 76
tags: [CWE-295, CWE-287, CWE-78]
activation:
  content:
    - 'golang\.org/x/crypto/ssh'
    - '\bssh\.(?:InsecureIgnoreHostKey|FixedHostKey|ClientConfig|ServerConfig|Dial|NewClientConn|NewServerConn|Permissions)\b'
    - '\b(?:PublicKeyCallback|PasswordCallback|NoClientAuth|HostKeyCallback)\b'
    - '\bsession\.(?:Run|Start|Output|CombinedOutput)\('
sources:
  - https://pkg.go.dev/golang.org/x/crypto/ssh
  - https://pkg.go.dev/vuln/GO-2024-3321
  - https://pkg.go.dev/golang.org/x/crypto/ssh/knownhosts
---
- **Host key ignored**: `HostKeyCallback: ssh.InsecureIgnoreHostKey()` (or a callback returning nil) accepts any server → MITM captures passwords, keys and commands. Fix: `knownhosts.New(path)` or `ssh.FixedHostKey`.
- **No client timeout**: `ClientConfig.Timeout` zero means no dial timeout, and sessions have no command timeout → automation hangs on unreachable or stuck hosts. Fix: set `Timeout`; enforce ctx deadlines around sessions.
- **PublicKeyCallback state (CVE-2024-45337)**: servers that remember the key seen in `PublicKeyCallback` and authorise by it later can be fooled — clients may offer keys they don't own before authenticating with another. Fix: `Permissions.Extensions`; x/crypto ≥ v0.31.0.
- **Weak server auth**: `NoClientAuth: true`, password callbacks comparing with `==`, or negative `MaxAuthTries` (unlimited) → unauthenticated access or brute force. Fix: key auth, constant-time checks, attempt limits.
- **Remote command injection**: `session.Run("tar -xf " + name)` is executed by the remote user's shell → metacharacters in input run arbitrary commands on the target host. Fix: strict validation and quoting, or fixed commands with data sent over stdin.
