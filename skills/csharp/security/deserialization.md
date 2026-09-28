---
name: Insecure deserialization
description: .NET deserializers that let input choose types — BinaryFormatter family, Newtonsoft TypeNameHandling, JavaScriptSerializer type resolvers, DataSet/DataTable.ReadXml, MessagePack Typeless and hand-rolled `$type` converters.
priority: 76
tags: [CWE-502, A08:2025]
activation:
  content:
    - '\b(?:BinaryFormatter|SoapFormatter|NetDataContractSerializer|LosFormatter|ObjectStateFormatter)\b'
    - '\bTypeNameHandling\b|\bI?SerializationBinder\b|\bJavaScriptSerializer\b|\bSimpleTypeResolver\b'
    - '\.ReadXml(?:Schema)?\(|\bAllowArbitraryDataSetTypeInstantiation\b'
    - '\bTypeless\w*|\bMessagePackSecurity\b|"\$type"'
  examples:
    - 'var formatter = new BinaryFormatter(); var obj = formatter.Deserialize(stream);'
    - 'var settings = new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.All };'
    - 'dataSet.ReadXml(userStream, XmlReadMode.Auto);'
    - 'var data = MessagePackSerializer.Deserialize<object>(bytes, TypelessContractlessStandardResolver.Options);'
sources:
  - https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-security-guide
  - https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2326
  - https://learn.microsoft.com/en-us/dotnet/framework/data/adonet/dataset-datatable-dataview/security-guidance
  - https://github.com/MessagePack-CSharp/MessagePack-CSharp#security
---
- **BinaryFormatter family**: `BinaryFormatter`, `SoapFormatter`, `NetDataContractSerializer`, `LosFormatter`, `ObjectStateFormatter` on data from requests, files, queues, caches or cookies → remote code execution. .NET 9+ `BinaryFormatter` always throws unless the unsupported compat package is added. Fix: `System.Text.Json` with fixed types.
- **Newtonsoft type names**: `TypeNameHandling` other than `None` (`Auto`, `Objects`, `All`), especially with `object`/`dynamic`/base-typed members and no restrictive `ISerializationBinder` → attacker picks gadget types (RCE). Fix: `None`, or an allowlist binder.
- **Type resolvers**: `JavaScriptSerializer` with `SimpleTypeResolver`, `DataContractSerializer`/`XmlSerializer` whose type or known types come from the payload → arbitrary type instantiation. Fix: fixed contract types.
- **DataSet/DataTable**: `DataSet.ReadXml`/`DataTable.ReadXml` or deserialized `DataSet` members on untrusted input → DoS and possible RCE; `Switch.System.Data.AllowArbitraryDataSetTypeInstantiation` removes the type allowlist. Fix: typed DTOs.
- **MessagePack Typeless**: `MessagePackSerializer.Typeless`/`TypelessContractlessStandardResolver` on untrusted bytes, or deserializing without `MessagePackSecurity.UntrustedData` → unexpected types, code execution, DoS. Fix: typed resolvers plus `UntrustedData`.
- **Home-made polymorphism**: custom converters that read `"$type"`/a class name and call `Type.GetType` recreate the problem. Fix: map discriminators to a closed set (`[JsonDerivedType]`).
