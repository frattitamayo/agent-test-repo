# Context Package: Division Operation

## Codebase References

### Primary Implementation Files

| File Path | Role | Modification Required |
|-----------|------|----------------------|
| `Calculator.cs` | Core arithmetic logic | Add `Divide(double a, double b)` method with zero-divisor handling |
| `Program.cs` | Console UI and operation dispatcher | Update menu to include "4. Divide" option and add case handler for division |
| `CalculatorTests.cs` | Unit test suite | Add test methods for division scenarios including zero-divisor cases |

### Configuration Files

| File Path | Role | Modification Required |
|-----------|------|----------------------|
| `Calculator.csproj` | Main project configuration | No changes required |
| `CalculatorTests.csproj` | Test project configuration | No changes required |

### Documentation

| File Path | Role | Modification Required |
|-----------|------|----------------------|
| `README.md` | Project documentation | Already references division operation; verify accuracy after implementation |

### Non-Relevant Files

The following files are legacy artifacts from a previous Node.js project and are not relevant to this orbit:
- `backend/api/properties/search.js`
- `backend/database/queries/property-search.sql`

## Architecture Context

### Application Structure

The Calculator application follows a simple three-layer architecture:

1. **Core Logic Layer** (`Calculator.cs`): Pure arithmetic methods that accept `double` parameters and return `double` results or handle error conditions
2. **Presentation Layer** (`Program.cs`): Console-based user interface that handles input/output, menu navigation, and operation dispatch
3. **Test Layer** (`CalculatorTests.cs`): xUnit-based test suite that validates core logic in isolation

### Data Flow Pattern

Based on the existing operations (add, subtract, multiply), the standard flow is:

```
User Input (Program.cs)
    ↓
Menu Selection Parsing
    ↓
Number Input Collection (2 operands)
    ↓
Calculator Method Invocation (Calculator.cs)
    ↓
Result or Error Handling
    ↓
Console Output (Program.cs)
    ↓
Loop Back to Menu
```

Division must integrate into this exact flow pattern at the menu selection and method invocation points.

### Error Handling Architecture

The application uses a **defensive validation** pattern:
- Input validation occurs at the UI layer (`Program.cs`) for numeric parsing
- Domain validation (e.g., division by zero) occurs at the core logic layer (`Calculator.cs`)
- Errors are communicated back to the UI layer for user-friendly display
- The application continues running after errors (no exception crashes)

### Technology Stack

- **Language:** C# with .NET 6.0+ runtime
- **Testing Framework:** xUnit (inferred from test project structure)
- **Deployment:** Console application (no web server, no external services)
- **Data Persistence:** None (stateless operation-by-operation execution)

## Pattern Library

### Method Signature Pattern

Based on the Intent Document's reference to orbit 634a82e2 (multiplication), arithmetic methods in `Calculator.cs` follow this signature pattern:

```csharp
public double OperationName(double a, double b)
```

Expected division method signature:
```csharp
public double Divide(double a, double b)
```

### Error Handling Pattern

Error handling must follow the established pattern where:
1. Invalid states are detected within the core logic method
2. Error conditions return a sentinel value or use a result wrapper pattern
3. The UI layer checks for error conditions and displays user-friendly messages

For division by zero, the pattern should be:
- Check `if (b == 0.0)` within the `Divide` method
- Return a sentinel value or throw a controlled exception that `Program.cs` catches
- Display a clear error message: "Error: Cannot divide by zero. Please try again."

### Naming Conventions

- **Method Names:** PascalCase, verb-based (e.g., `Add`, `Subtract`, `Multiply`, `Divide`)
- **Parameter Names:** Single lowercase letters for operands (`a`, `b`)
- **Test Method Names:** Follow xUnit convention with descriptive names (e.g., `Divide_TwoPositiveNumbers_ReturnsCorrectQuotient`)

### Console UI Pattern

Menu options follow this format:
```
[number]. [Operation Name]
```

User prompts follow this format:
```
Enter first number: 
Enter second number: 
```

Result display follows this format:
```
Result of [operation]: [value]
```

Error messages follow this format:
```
Error: [description]. Please try again.
```

### Test Structure Pattern

Each operation should have test methods covering:
- **Happy path:** Correct results for typical inputs
- **Edge cases:** Zero operands, negative numbers, decimal values
- **Error conditions:** Invalid states (e.g., division by zero)

Test methods use xUnit's `[Fact]` attribute for simple tests and `[Theory]` with `[InlineData]` for parameterized tests.

## Prior Orbit References

### Orbit 634a82e2: Multiplication Operation

This orbit established the current pattern for arithmetic operations and serves as the direct template for division implementation.

**Key Artifacts:**
- `.orbital/artifacts/634a82e2-fe76-43e4-90c4-5cbc43033ad8/intent_document.md`
- `.orbital/artifacts/634a82e2-fe76-43e4-90c4-5cbc43033ad8/context_package.md`
- `.orbital/artifacts/634a82e2-fe76-43e4-90c4-5cbc43033ad8/proposal_record.md`
- `.orbital/artifacts/634a82e2-fe76-43e4-90c4-5cbc43033ad8/code_generation.md`
- `.orbital/artifacts/634a82e2-fe76-43e4-90c4-5cbc43033ad8/test_results.md`

**Patterns to Replicate:**
- Method implementation in `Calculator.cs` with `double` parameters
- Menu integration in `Program.cs` with sequential numbering
- Test coverage in `CalculatorTests.cs` with multiple scenarios

**Differences for Division:**
Division requires additional error handling that multiplication did not:
- Multiplication has no invalid input states (all `double` × `double` operations are valid)
- Division must explicitly check for zero divisor before performing the operation
- Test coverage must include error condition scenarios

### Other Prior Orbits

Two additional orbit artifact directories exist:
- `.orbital/artifacts/98c23c71-dce9-4fbb-8422-9c6b36bb3743/`
- `.orbital/artifacts/e89626f7-2fb2-42bf-b881-84a9ea17c15d/`

These likely represent earlier operations (addition, subtraction) and may contain additional context about error handling patterns and test strategies.

## Risk Assessment

### Critical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Division by zero not handled** | Application crash, poor UX | High | Explicit `if (b == 0.0)` check before division operation; return error state |
| **Floating-point precision issues** | Incorrect results for certain inputs | Medium | Accept standard `double` precision; document behavior in tests |
| **Menu numbering conflict** | User confusion, wrong operation executed | Low | Verify menu option "4" is available; update README if needed |
| **Breaking existing operations** | Regression in add/subtract/multiply | Low | Run full test suite before completing orbit |

### Error Handling Risks

**Division by Zero Detection:**
- **Risk:** Using `== 0.0` for floating-point comparison may miss near-zero values
- **Impact:** Division by very small numbers produces `Infinity` or `-Infinity` results
- **Mitigation (Minimum):** Exact zero check is sufficient per Intent Document acceptance boundaries
- **Mitigation (Stretch):** Consider `Math.Abs(b) < double.Epsilon` for near-zero detection if stretch goals are pursued

**Exception Propagation:**
- **Risk:** Unhandled exceptions crash the console loop
- **Impact:** User must restart application
- **Mitigation:** Ensure all error paths return control to `Program.cs` menu loop

### Integration Risks

**Menu System Modification:**
- **Risk:** Incorrect switch/case logic in `Program.cs` breaks operation dispatch
- **Impact:** Division option doesn't execute or wrong operation runs
- **Mitigation:** Follow exact pattern from multiplication case; test manual execution

**Exit Option Renumbering:**
- **Risk:** If "Exit" is currently option "4", adding division creates conflict
- **Impact:** User cannot exit application cleanly
- **Mitigation:** Verify current menu structure; "Exit" should already be option "5" per README example

### Test Coverage Risks

**Insufficient Boundary Testing:**
- **Risk:** Edge cases like `0 ÷ n` or negative operands not tested
- **Impact:** Silent failures or incorrect results in production
- **Mitigation:** Implement test matrix covering all acceptance boundary scenarios from Intent Document

**Floating-Point Assertion Precision:**
- **Risk:** Tests fail due to rounding differences (e.g., `10 ÷ 3 = 3.33333...`)
- **Impact:** False test failures block orbit completion
- **Mitigation:** Use appropriate floating-point comparison tolerance in assertions (e.g., `Assert.Equal(expected, actual, precision: 10)`)

### Performance Considerations

**Not Applicable:** Division of two `double` values is a single CPU instruction with negligible performance impact. No performance risks exist for this orbit.

### Security Considerations

**Not Applicable:** This is a local console application with no network exposure, no user authentication, and no data persistence. Standard floating-point division introduces no security vulnerabilities.