---
name: Unsafe deserialization
description: Gadget-chain deserialization of untrusted data — ObjectInputStream without filters, XMLDecoder, XStream, Jackson default typing or class-name type ids, SnakeYAML before 2.0, Kryo/Hessian and JDK-serialized cache or JMS payloads.
priority: 78
tags: [CWE-502, A08:2025]
activation:
  content:
    - '\b(?:ObjectInputStream|XMLDecoder|XStream|ObjectMessage|Kryo|HessianInput|Hessian2Input|JdkSerializationRedisSerializer)\b'
    - '\.(?:readObject|readUnshared)\('
    - '\b(?:enableDefaultTyping|activateDefaultTyping|LaissezFaireSubTypeValidator)\b'
    - '@JsonTypeInfo\b'
    - '\bnew\s+Yaml\('
    - '\bSerializationUtils\.deserialize\('
  examples:
    - 'ObjectInputStream in = new ObjectInputStream(socket.getInputStream());'
    - 'Object obj = in.readObject();'
    - 'mapper.activateDefaultTyping(ptv, ObjectMapper.DefaultTyping.NON_FINAL);'
    - '@JsonTypeInfo(use = JsonTypeInfo.Id.CLASS)'
    - 'Yaml yaml = new Yaml();'
    - 'Object payload = SerializationUtils.deserialize(bytes);'
sources:
  - https://docs.oracle.com/en/java/javase/25/core/serialization-filtering1.html
  - https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html
  - https://github.com/FasterXML/jackson-docs/wiki/JacksonPolymorphicDeserialization
  - https://x-stream.github.io/security.html
---
- **ObjectInputStream on untrusted bytes**: `readObject` on data from sockets, uploads, cookies, queues or shared caches → remote code execution through classpath gadgets. Fix: JSON/protobuf DTOs, or an allow-list `ObjectInputFilter` (JEP 290; filter factories since JDK 17).
- **XMLDecoder / XStream**: `XMLDecoder` executes arbitrary method calls; XStream before 1.4.18 relied on a bypassable deny-list, and `allowTypesByWildcard`/`AnyTypePermission` re-open it. Fix: never on untrusted XML; explicit type allow-lists.
- **Jackson polymorphism**: `enableDefaultTyping`/`activateDefaultTyping` with a permissive validator, or `@JsonTypeInfo(use = Id.CLASS/MINIMAL_CLASS)` on `Object`/`Serializable`/broad base types → attacker-chosen gadget classes. Fix: `Id.NAME` + `@JsonSubTypes`, or an allow-listing `BasicPolymorphicTypeValidator`.
- **SnakeYAML < 2.0**: `new Yaml().load(input)` instantiates any class named by a global tag (CVE-2022-1471). Fix: SnakeYAML 2.x (global tags blocked by default) or `SafeConstructor`.
- **Other formats**: Kryo with `setRegistrationRequired(false)`, Hessian, `SerializationUtils.deserialize`, JMS `ObjectMessage.getObject()` → the same gadget risk. Fix: class registration, trusted-package allow-lists.
- **JDK-serialized caches**: values stored with `JdkSerializationRedisSerializer` (the Spring Data Redis default) are deserialized on read → whoever can write the store gets RCE. Fix: JSON serializers with fixed types.
