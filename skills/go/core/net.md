---
name: net connections, deadlines and IP addresses
description: Dials without timeouts, one-shot absolute deadlines, listeners on all interfaces, net.IP comparisons that miss 4-in-6 forms, host:port parsing that breaks IPv6 and RemoteAddr/IP-range checks used for access control.
priority: 58
tags: [CWE-400, CWE-1289, CWE-291]
activation:
  content:
    - '\bnet\.(?:Dial\w{0,7}|Listen\w{0,6}|ParseIP|ParseCIDR|IP|IPNet|SplitHostPort|JoinHostPort|Dialer)\b'
    - '\bnetip\.'
    - '\.Set(?:Read|Write)?Deadline\('
    - '\bRemoteAddr\b'
    - '\.Is(?:Private|Loopback|LinkLocalUnicast|Unspecified|Global\w{0,7})\(\)'
  examples:
    - 'conn, err := net.Dial("tcp", addr)'
    - 'addr := netip.MustParseAddr("1.2.3.4")'
    - 'conn.SetDeadline(time.Now().Add(d))'
    - 'log.Println(r.RemoteAddr)'
    - 'if ip.IsLoopback() { return true }'
sources:
  - https://pkg.go.dev/net#Conn
  - https://pkg.go.dev/net#IP.Equal
  - https://pkg.go.dev/net/netip#Addr.Unmap
  - https://pkg.go.dev/net#SplitHostPort
---
- **No dial timeout**: `net.Dial`, `tls.Dial` and a zero `net.Dialer` wait for the OS connect timeout (minutes) on blackholed hosts → goroutines pile up. Fix: `net.Dialer{Timeout: …}` or `DialContext` with a deadline.
- **Absolute deadlines**: `SetReadDeadline(time.Now().Add(d))` set once fails every read after `d`; never setting one lets a silent peer hold the goroutine forever. Fix: refresh the deadline per read/write.
- **All interfaces**: `net.Listen("tcp", ":6060")` for debug/admin/metrics listeners binds every interface → exposed beyond the host. Fix: `127.0.0.1:port`.
- **IP comparisons**: `net.IP` stores IPv4 as 4 or 16 bytes, so `bytes.Equal`, `string(ip)` or map keys see one address as two; `netip.Addr` treats `1.2.3.4` and `::ffff:1.2.3.4` as different → allowlists bypassed. Fix: `ip.Equal`, `addr.Unmap()`, `netip.Prefix.Contains`.
- **host:port parsing**: `strings.Split(addr, ":")` or comparing `r.RemoteAddr` (which includes the port) with an IP breaks for IPv6 and never matches allowlists. Fix: `net.SplitHostPort`/`net.JoinHostPort`.
- **Incomplete internal-range checks**: `IsPrivate()` alone misses loopback, link-local (169.254.169.254), `0.0.0.0` and CGNAT → SSRF filters pass internal targets. Fix: also `IsLoopback`, `IsLinkLocalUnicast`, `IsUnspecified`, explicit prefixes.
