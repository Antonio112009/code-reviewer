---
name: Mocking pitfalls
description: Moq/NSubstitute defects that hide bugs — loose mocks returning defaults, over-broad argument matchers, setups never verified, mocking DbContext/IQueryable with LINQ-to-objects semantics and NSubstitute argument specs used outside a call.
priority: 48
activation:
  content:
    - '\bnew\s+Mock<|\bMock\.Of<|\.Setup(?:Get|Set|Sequence)?\(|\.Verify(?:All|NoOtherCalls|Get|Set)?\(|\bMockBehavior\.'
    - '\bIt\.(?:IsAny|Is|IsIn|IsRegex)\b|\bSubstitute\.For<|\bArg\.(?:Any|Is|Do)\b|\.Received\('
  examples:
    - 'var mock = new Mock<IEmailSender>(MockBehavior.Strict);'
    - 'mock.Setup(x => x.Send(It.IsAny<string>())).Returns(Task.CompletedTask);'
    - 'substitute.Received(1).Send(Arg.Any<string>());'
sources:
  - https://github.com/devlooped/moq/wiki/Quickstart
  - https://nsubstitute.github.io/help/argument-matchers/
  - https://learn.microsoft.com/en-us/ef/core/testing/testing-without-the-database
---
- **Loose defaults**: Moq's default `MockBehavior.Loose` returns `null`/default values (and completed tasks with default results) for anything not set up → the code under test runs with nulls or zeros and the test still passes. Fix: `MockBehavior.Strict` for collaborators that matter, `VerifyNoOtherCalls()`.
- **Over-broad matchers**: `It.IsAny<T>()`/`Arg.Any<T>()` for every argument → the test passes even when wrong ids, amounts or users are passed. Fix: match expected values or `It.Is<T>(x => …)`.
- **Setups never verified**: `Setup(...)` for commands (send e-mail, publish, save) without `Verify(..., Times.Once)`/`Received()` → the side effect is never asserted. Fix: verify interactions that are the behaviour under test.
- **Mocking EF/IQueryable**: mocked `DbSet`/`IQueryable` or a list `.AsQueryable()` evaluates LINQ in memory (case sensitivity, nulls, untranslatable expressions differ from SQL) → green tests, failing queries in production. Fix: a real database (containers) or repository-level fakes.
- **NSubstitute specs outside calls**: `Arg.Any/Is` stored in variables or used outside a substitute call (`Returns`/`Received`) → matchers applied to the wrong call or `AmbiguousArgumentsException`. Fix: use argument matchers inline only.
