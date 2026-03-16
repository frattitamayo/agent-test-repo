# Context Package: Addition Functionality for Calculator

## Codebase References

### Primary Files (to be created)
- `Program.cs` — Console application entry point; contains Main method and user interaction loop
- `Calculator.cs` — Core calculation logic; contains addition method as first operation
- `InputValidator.cs` — Input validation and parsing logic; separates validation from calculation

### Secondary Files (to be created)
- `Calculator.Tests/` — Unit test project directory
- `Calculator.Tests/CalculatorTests.cs` — Tests for addition logic
- `Calculator.Tests/InputValidatorTests.cs` — Tests for input validation

### Configuration Files
- `Calculator.csproj` — Project file defining .NET target framework and dependencies
- `Calculator.Tests/Calculator.Tests.csproj` — Test project file with testing framework reference (xUnit, NUnit, or MSTest)

### Note on Repository Mismatch
The provided repository structure (`frattitamayo/agent-test-repo`) contains Node.js backend code for property search, which does not align with the C# Calculator project described. The files above represent the expected structure for a new C# console calculator project. If an existing C# project structure exists in the repository, those paths should take precedence.

## Architecture Context

### Application Architecture
This is a **console-based calculator** following a simple layered structure appropriate for a command-line utility:

1. **Presentation Layer** (`Program.cs`): Handles user interaction, input prompting, output formatting, and application lifecycle.
2. **Domain Layer** (`Calculator.cs`): Contains pure calculation logic with no I/O concerns; methods accept numeric parameters and return numeric results.
3. **Validation Layer** (`InputValidator.cs`): Parses and validates console input; converts strings to numeric types with error handling.

### Data Flow
```
Console Input → InputValidator.Parse() → Calculator.Add() → Console Output
                       ↓ (on error)
                   Error Message → Console Output → Retry Prompt
```

### Technology Stack
- **Runtime:** .NET 6.0 or later (LTS version recommended)
- **Language:** C# 10.0+ with nullable reference types enabled
- **Testing Framework:** xUnit, NUnit, or MSTest (select one for consistency)
- **Numeric Types:** Use `decimal` for user-facing calculations to avoid floating-point precision issues common with `double`

### Design Patterns
- **Separation of Concerns:** Calculation logic isolated from I/O logic; enables unit testing without console dependencies.
- **Fail-Fast Validation:** Input validation occurs before calculation; invalid input produces immediate error without side effects.
- **Single Responsibility:** Each class has one reason to change (Calculator changes only for calculation logic; InputValidator changes only for parsing/validation rules).

## Pattern Library

### C# Naming Conventions
- **Classes:** PascalCase (e.g., `Calculator`, `InputValidator`)
- **Methods:** PascalCase (e.g., `Add()`, `ParseDecimal()`)
- **Local Variables:** camelCase (e.g., `firstNumber`, `result`)
- **Constants:** PascalCase (e.g., `MaxDecimalPlaces`)

### Error Handling Pattern
```csharp
// InputValidator should use TryParse pattern
public bool TryParseNumber(string input, out decimal result)
{
    return decimal.TryParse(input, out result);
}

// Program.cs wraps calls in validation checks
if (!validator.TryParseNumber(input, out decimal number))
{
    Console.WriteLine("Error: Please enter a valid number.");
    // Prompt for retry
}
```

### Method Signature Pattern
```csharp
// Calculator methods: pure functions with no side effects
public decimal Add(decimal a, decimal b)
{
    return a + b;
}
```

### Console Output Pattern
```csharp
// Clear, consistent result formatting
Console.WriteLine($"Result: {result}");

// Clear error messages with actionable guidance
Console.WriteLine("Error: Input must be a number. Please try again.");
```

### Test Pattern
```csharp
// Table-driven tests with descriptive names
[Theory]
[InlineData(5, 3, 8)]
[InlineData(-5, 3, -2)]
[InlineData(0, 0, 0)]
public void Add_WithVariousInputs_ReturnsCorrectSum(decimal a, decimal b, decimal expected)
{
    var calculator = new Calculator();
    var result = calculator.Add(a, b);
    Assert.Equal(expected, result);
}
```

## Prior Orbit References

### Completed Orbits
None. This is the first feature orbit for the Calculator project.

### Established Patterns
None yet. This orbit establishes foundational patterns for:
- User input handling (will be reused for subtract, multiply, divide)
- Output formatting (will be reused for all operations)
- Error message style (will be consistent across operations)
- Test structure (will be template for future operation tests)

### Architectural Decisions to Document
After completing this orbit, document the following decisions for future reference:
- **Numeric type choice** (`decimal` vs `double`) and rationale
- **Input validation approach** (TryParse vs exceptions)
- **Error handling strategy** (retry loop vs exit on error)
- **Project structure** (single project vs separate class library)

These decisions set precedent for operations added in future orbits.

## Risk Assessment

### High-Priority Risks

#### R1: Floating-Point Precision Issues
**Risk:** Using `double` for calculations can produce unexpected results (e.g., 0.1 + 0.2 ≠ 0.3 exactly).  
**Impact:** User-facing incorrect results; erodes trust in calculator accuracy.  
**Mitigation:** Use `decimal` type for all user-facing arithmetic; document this choice in code comments and architecture notes for consistency in future operations.

#### R2: Invalid Input Crashes Application
**Risk:** Unhandled exceptions from parsing invalid input (non-numeric strings, overflow values) cause application exit.  
**Impact:** Poor user experience; users cannot recover from typos without restarting application.  
**Mitigation:** Use `decimal.TryParse()` instead of `decimal.Parse()`; validate all input before passing to calculation logic; test error paths explicitly.

#### R3: Inconsistent Error Messages
**Risk:** Ad-hoc error messages (e.g., "Bad input", "Error", exception stack traces) confuse users.  
**Impact:** Users don't know how to correct input; support burden increases.  
**Mitigation:** Define standard error message format; use descriptive, actionable messages (e.g., "Error: Please enter a valid number."); suppress technical stack traces from console output.

### Medium-Priority Risks

#### R4: Tight Coupling Blocks Future Extensibility
**Risk:** Mixing calculation logic with console I/O in `Program.cs` makes adding new operations or interfaces (GUI, web) difficult.  
**Impact:** Future orbits require refactoring rather than extension; increases change cost.  
**Mitigation:** Separate `Calculator` class from `Program.cs`; calculator methods accept parameters and return values with no console dependencies; enables future operations (subtract, multiply, divide) to follow same pattern.

#### R5: Insufficient Test Coverage
**Risk:** Missing edge case tests (overflow, underflow, maximum precision) leads to undetected bugs.  
**Impact:** Production issues with large numbers or high-precision inputs; regression risk when adding new operations.  
**Mitigation:** Test matrix includes: positive/negative numbers, zero, decimals, boundary values (`decimal.MaxValue`, `decimal.MinValue`), and invalid input handling; aim for >90% code coverage.

### Low-Priority Risks

#### R6: Locale-Specific Parsing Issues
**Risk:** Decimal separator varies by locale (`.` vs `,`); hardcoded parsing may fail for some users.  
**Impact:** Application unusable in non-US locales without code changes.  
**Mitigation:** Use `decimal.TryParse()` with `CultureInfo.InvariantCulture` for consistent parsing; document locale assumptions; consider locale support in future enhancements if international deployment planned.

#### R7: Performance Degradation with Large Numbers
**Risk:** `decimal` arithmetic slower than `double` for very large datasets.  
**Impact:** None for this use case (single operations, human input speed); noted for awareness if future requirements include batch processing.  
**Mitigation:** Accept performance tradeoff for accuracy; document that `decimal` chosen for correctness over speed; monitor if requirements evolve to include high-throughput scenarios.

### Regression Prevention

Since this is the first orbit:
- Establish CI pipeline expectations (tests must pass before merge)
- Document baseline performance (addition execution time < 1ms)
- Create test suite structure that scales to four operations (add, subtract, multiply, divide)
- Version lock .NET framework to prevent breaking changes from runtime updates