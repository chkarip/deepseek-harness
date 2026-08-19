---
name: unit-test-writer
description: Design comprehensive unit tests including edge cases, exception handling, parameterization, and mocking. Use when asked to write tests, add test suites, mock external dependencies, or increase test coverage.
---

# Unit Testing Standards

When generating unit tests:

1. **Structure**: Follow Arrange-Act-Assert (AAA) pattern.
2. **Isolation**: Mock all network calls, file system I/O, and external APIs.
3. **Coverage Targets**:
   - Happy path
   - Edge cases (null, empty, boundary numbers, unicode)
   - Error branches and expected exceptions
4. **Naming**: Use descriptive test names indicating `test_<function>_<scenario>_<expected_result>`.
