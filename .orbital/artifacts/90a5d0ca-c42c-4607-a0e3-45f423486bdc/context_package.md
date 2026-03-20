# Context Package: Division Operation for Calculator

## Codebase References

### Primary Implementation Files

**Calculator.cs** — Core arithmetic logic class
- Location: `./Calculator.cs` (repository root)
- Purpose: Contains all arithmetic operation methods (Add, Subtract, Multiply)
- Expected modification: Add new `Divide(double a, double b)` method
- Current pattern: Public instance methods returning `double`, no state management

**Program.cs** — Console application entry point
- Location: `./Program.cs` (repository root)
- Purpose: User interface loop, menu display, input collection, operation dispatch
- Expected modification: Add case statement for division operation in main switch block
- Current pattern: While loop with switch statement, numeric menu choices, `Console.WriteLine` for output

**CalculatorTests.cs** — Unit test suite
- Location: `./CalculatorTests.cs` (repository root)
- Purpose: xUnit test methods covering all calculator operations
- Expected modification: Add test methods for division scenarios including division by zero
- Current pattern: One test class, multiple `[Fact]` methods, `Assert.Equal` for validation

### Project Configuration Files

**Calculator.csproj** — Main application project file
- Location: `./Calculator.csproj` (repository root)
- Purpose: Defines .NET target framework, output type (console executable)
- Expected modification: None required for this orbit

**CalculatorTests.csproj** — Test project file
- Location: `./CalculatorTests.csproj` (repository root)
- Purpose: References Calculator project, includes xUnit test framework
- Expected modification: None required for this orbit

### Documentation Files

**README.md** — Project documentation
- Location: `./README.md` (repository root)
- Purpose: User-facing documentation including feature list and usage examples
- Current state: Already lists "Divide" as a supported operation with division by zero protection
- Expected modification: Verify accuracy after implementation, update if menu numbering changes

### Non-Relevant Files

The following files exist in the repository but are not relevant to this orbit:
- `backend/api/properties/search.js` — Legacy Node.js property search functionality
- `backend/database/queries/property-search.sql` — Legacy database query
- `.orbital/artifacts/*` — Historical orbit artifacts (context reference only)

## Architecture Context

### System Architecture

This is a **single-process console application** with no external dependencies, persistence layer, or network communication. The architecture follows a simple three-layer pattern:

1. **Domain Layer** (`Calculator.cs`) — Pure calculation logic, stateless methods
2. **Presentation Layer** (`Program.cs`) — Console I/O, user interaction loop
3. **Test Layer** (`CalculatorTests.cs`) — Automated verification

### Data Flow

```
User Input (Console) 
  → Program.cs validates input
  → Program.cs calls Calculator method
  → Calculator.cs performs calculation
  → Result returned to Program.cs
  → Program.cs displays result (Console)
```

**Key Characteristics:**
- Synchronous execution, no async/await patterns
- No data persistence between sessions
- No shared state between operations
- Input validation happens at presentation layer
- Business logic validation (e.g., division by zero) happens at domain layer

### Division Operation Integration Points

**Domain Layer Integration:**
- New method `Divide` must be added to the `Calculator` class alongside existing arithmetic methods
- Method must accept two `double` parameters and return `double` (consistent with Add, Subtract, Multiply)
- Division by zero detection must occur within this method, not in the presentation layer

**Presentation Layer Integration:**
- Menu display in `Program.cs` requires new numbered option (currently shows operations 1-5 where 5 is Exit)
- New case statement in switch block to handle division selection
- Input prompts and result display must follow existing format patterns

**Test Layer Integration:**
- New test methods in `CalculatorTests.cs` must follow xUnit `[Fact]` attribute pattern
- Tests must cover both successful division and division by zero scenarios
- Test method naming should follow existing convention (likely `TestDivide_*` or `Divide_*`)

### Infrastructure Constraints

- **.NET 6.0 SDK or later** — Minimum runtime requirement (already established)
- **Console output limitations** — Text-only interface, no rich formatting
- **Floating-point arithmetic** — C# `double` type limitations apply (IEEE 754 standard)
- **No external package dependencies** — Pure .NET BCL usage only

### Design Patterns in Use

- **Stateless Service Pattern** — Calculator class maintains no state between method calls
- **Command Pattern (Implicit)** — Menu-driven operation selection in Program.cs
- **Fail-Fast Validation** — Input validation occurs before method invocation where possible

## Pattern Library

### Method Signature Pattern

Based on existing operations in `Calculator.cs`:

```csharp
public double OperationName(double a, double b)
{
    // Validation (if needed)
    // Calculation
    return result;
}
```

**Established conventions:**
- Public access modifier (all operations are public)
- PascalCase method names (Add, Subtract, Multiply)
- Two `double` parameters named `a` and `b`
- Direct return of `double` result (no out parameters or result objects)
- No XML documentation comments currently present (but Intent specifies they should be added)

### Console Interaction Pattern

From `Program.cs` menu structure:

```csharp
Console.WriteLine("Select operation:");
Console.WriteLine("1. Add");
Console.WriteLine("2. Subtract");
Console.WriteLine("3. Multiply");
Console.WriteLine("N. [New Operation]");
Console.WriteLine("X. Exit");

switch (choice)
{
    case "1":
        // Get inputs
        Console.Write("Enter first number: ");
        double num1 = Convert.ToDouble(Console.ReadLine());
        Console.Write("Enter second number: ");
        double num2 = Convert.ToDouble(Console.ReadLine());
        
        // Execute operation
        double result = calculator.Add(num1, num2);
        
        // Display result
        Console.WriteLine($"Result of addition: {result}");
        break;
}
```

**Established conventions:**
- Menu options numbered sequentially starting from 1
- "Exit" option is the last menu item
- Input prompts use `Console.Write` (no newline) followed by `Console.ReadLine()`
- Result display uses `Console.WriteLine` with string interpolation
- Operation name in result message matches menu text ("addition" for "Add")

### Error Handling Pattern

From README.md and Intent Document requirements:

```csharp
// Division by zero must be detected and handled gracefully
// Error messaging must be clear and user-friendly
// Application must remain running after errors
```

**Current error handling observations:**
- README indicates "Division by zero is detected and reported with a clear error message"
- README states "Invalid numeric input is rejected with helpful feedback"
- No try-catch blocks visible in provided context (validation-first approach likely used)

**Expected pattern for division by zero:**
- Check `if (b == 0)` before performing division
- Return a sentinel value OR throw a specific exception that Program.cs catches
- Display error message via `Console.WriteLine` in Program.cs
- Allow user to return to main menu (no application termination)

### Testing Pattern

From `CalculatorTests.cs` expected structure:

```csharp
[Fact]
public void TestOperation_Scenario_ExpectedBehavior()
{
    // Arrange
    var calculator = new Calculator();
    
    // Act
    double result = calculator.Operation(input1, input2);
    
    // Assert
    Assert.Equal(expectedValue, result);
}
```

**Established conventions:**
- xUnit framework with `[Fact]` attributes
- Test method names follow pattern: `Test[Operation]_[Scenario]_[Expected]`
- Arrange-Act-Assert pattern
- New Calculator instance per test (no shared state)
- `Assert.Equal` for numeric comparisons
- Minimum 4 test cases per operation (per Intent acceptance criteria)

### Naming Conventions

| Element | Convention | Examples |
|---------|-----------|----------|
| Class names | PascalCase | `Calculator`, `CalculatorTests` |
| Method names | PascalCase | `Add`, `Subtract`, `Multiply` |
| Parameters | camelCase | `a`, `b`, `num1`, `num2` |
| Local variables | camelCase | `result`, `choice`, `calculator` |
| Test methods | PascalCase with underscores | `TestAdd_PositiveNumbers_ReturnsSum` |

## Prior Orbit References

### Orbit 634a82e2 — Multiplication Operation

**Status:** Completed (artifacts present in `.orbital/artifacts/634a82e2-fe76-43e4-90c4-5cbc43033ad8/`)

**Relevance:** Most recent arithmetic operation, immediate precedent for division implementation

**Key artifacts:**
- `intent_document.md` — Approach to defining arithmetic operation requirements
- `proposal_record.md` — Implementation strategy that should mirror division approach
- `code_generation.md` — Actual code changes made to Calculator.cs, Program.cs, CalculatorTests.cs
- `test_results.md` — Test coverage and verification approach

**Lessons to apply:**
- Follow the same file modification pattern (Calculator.cs, Program.cs, CalculatorTests.cs)
- Use multiplication implementation as template for method structure
- Verify menu numbering sequence (multiplication likely added as option 3)
- Match test coverage approach from multiplication orbit

### Orbit 98c23c71 — Subtraction Operation

**Status:** Completed (artifacts present in `.orbital/artifacts/98c23c71-dce9-4fbb-8422-9c6b36bb3743/`)

**Relevance:** Established initial arithmetic operation pattern alongside Add

**Key artifacts:**
- Pattern for second arithmetic operation added to codebase
- Test structure for operations with potential negative results

**Lessons to apply:**
- Subtraction likely established pattern for handling negative numbers in tests
- May contain examples of edge case testing (negative operands, zero handling)

### Orbit 54343d0b — Previous Orbit (Unknown Intent)

**Status:** Completed (artifacts present in `.orbital/artifacts/54343d0b-2548-4021-9462-868b6acafe88/`)

**Re-orbit note:** Current orbit is marked as "Re-orbit from 54343d0b-2548-4021-9462-868b6acafe88: p"

**Relevance:** Immediate predecessor to current division orbit, unclear why re-orbit was needed

**Risk consideration:** Review this orbit's artifacts to understand:
- What was attempted that required re-orbit
- Whether there are environmental or tooling issues affecting execution
- Any partial changes that need to be reverted or completed

### Orbit e89626f7 — Unknown Early Orbit

**Status:** Completed (artifacts present in `.orbital/artifacts/e89626f7-2fb2-42bf-b881-84a9ea17c15d/`)

**Relevance:** Early orbit in calculator trajectory, possibly initial setup or Add operation

**Lessons to apply:**
- May contain initial project structure decisions
- Likely defines baseline testing approach

## Risk Assessment

### Implementation Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Division by zero not properly caught** | Medium | High | Explicit `if (b == 0)` check before division operation; dedicated unit test for division by zero scenario; verify error message displays without exception propagation |
| **Menu numbering conflict** | High | Medium | Review existing Program.cs to confirm current operation numbering; README shows division as option 4 but may not reflect current code state; verify against multiplication orbit artifacts |
| **Inconsistent method signature** | Low | Medium | Verify Add, Subtract, Multiply signatures in Calculator.cs before implementing Divide; ensure two `double` parameters, `double` return type |
| **Floating-point precision issues** | Medium | Low | Accept C# default double division behavior per Intent constraints; test with decimal operands to verify precision; document any known IEEE 754 limitations in code comments |
| **Test coverage gaps** | Medium | Medium | Implement minimum 4 test cases per Intent acceptance criteria; cover positive/negative operands, decimal operands, division by zero, and edge cases like very small divisors |

### Regression Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Existing operations break** | Low | High | Run full test suite after changes; verify Calculator.cs additions don't modify existing methods; ensure Program.cs changes don't alter existing case statements |
| **Menu display corruption** | Low | Medium | Verify menu formatting remains consistent; test that "Exit" option remains last; ensure line breaks and numbering display correctly |
| **Build errors from syntax issues** | Low | High | Verify code compiles with `dotnet build` before committing; ensure all braces balanced, semicolons present; test project references remain intact |

### User Experience Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Unclear division by zero error message** | Medium | Medium | Use plain language error message (e.g., "Error: Cannot divide by zero. Please enter a non-zero divisor."); verify message displays prominently; test that user can continue after error |
| **Confusing menu option label** | Low | Low | Use "Divide" to match existing operation naming (Add, Subtract, Multiply); ensure consistency with README.md documentation |
| **Unexpected results with negative numbers** | Low | Medium | Test negative dividend, negative divisor, and both negative scenarios; verify results match mathematical expectations; document behavior if non-intuitive |

### Security Considerations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Integer overflow in console input** | Low | Low | Rely on C# `Convert.ToDouble()` exception handling already in place (per README statement about invalid input rejection); division operation unlikely to cause overflow |
| **Denial of service via division by very small numbers** | Very Low | Low | Accept default C# behavior for very small divisors resulting in very large quotients or infinity; no mitigation needed for console application |
| **Injection attacks via console input** | Not Applicable | N/A | Console application with numeric-only input has no injection surface; `Convert.ToDouble()` safely handles non-numeric input |

### Performance Considerations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Slow division operations** | Very Low | Very Low | Division is O(1) operation; no performance constraints for console application; no mitigation needed |
| **Memory leaks from repeated operations** | Very Low | Very Low | Stateless Calculator class with no resource management; C# garbage collection handles cleanup; no mitigation needed |

### Technical Debt Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Missing XML documentation comments** | Medium | Low | Intent specifies XML comments should be added; if not added, future maintainability decreases; ensure all public methods documented per acceptance criteria |
| **Inconsistent error handling patterns** | Medium | Medium | Division by zero introduces first error case requiring runtime validation; establish clear pattern (exception vs. sentinel value) that can scale to future operations |
| **Test organization becoming unwieldy** | Low | Low | Current single-test-class approach acceptable for 4 operations; monitor test file size; consider splitting if exceeds ~500 lines in future orbits |

### Mitigation Summary

**Critical mitigations for this orbit:**
1. Explicit division by zero check with dedicated test coverage
2. Verification of menu numbering against actual Program.cs state (not just README)
3. Full regression test execution before orbit completion
4. Clear, user-friendly error message validation
5. Review of prior orbit (54343d0b) to understand re-orbit context