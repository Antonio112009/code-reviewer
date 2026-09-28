---
name: protobuf-go messages
description: Comparing messages with == or reflect.DeepEqual, relying on serialized bytes, proto3 field presence in partial updates, copying messages by value and nil-unsafe field access.
priority: 58
tags: [CWE-697, CWE-476]
activation:
  content:
    - '\bproto\.(?:Equal|Clone|Marshal\w{0,8}|Unmarshal\w{0,8}|Merge|Size)\b'
    - '\bproto(?:json|text)\.'
    - '\bprotocmp\b|\bfieldmaskpb\b'
    - '\b\w{1,30}pb\.[A-Z]\w{0,60}\{'
  examples:
    - 'if !proto.Equal(want, got) { t.Fatalf("mismatch") }'
    - 'b, err := protojson.Marshal(msg)'
    - 'diff := cmp.Diff(a, b, protocmp.Transform())'
    - 'req := userpb.CreateUserRequest{Name: name}'
sources:
  - https://protobuf.dev/reference/go/faq/
  - https://pkg.go.dev/google.golang.org/protobuf/proto#Equal
  - https://protobuf.dev/programming-guides/field_presence/
---
- **Equality**: `==`, `reflect.DeepEqual` or `assert.Equal` on messages also compare internal state → false mismatches and flaky tests. Fix: `proto.Equal`, or `cmp.Diff(a, b, protocmp.Transform())`.
- **Byte stability**: protojson/prototext output is deliberately unstable and binary map order is not deterministic → golden files, cache keys, hashes or signatures over serialized bytes break. Fix: compare parsed messages; don't hash wire bytes.
- **Field presence**: proto3 scalars without `optional` can't tell unset from zero → partial updates overwrite values with `0`/`""`/`false`. Fix: `optional` fields, wrapper types or a `FieldMask`.
- **Copying**: `m2 := *m1` or storing messages by value copies internal state (races, vet copylocks); shallow copies share nested messages and slices. Fix: `proto.Clone`.
- **Nil access**: direct field access through nil nested messages (`req.User.Id`) panics; getters (`req.GetUser().GetId()`) are nil-safe but return zero values that must still be validated.
