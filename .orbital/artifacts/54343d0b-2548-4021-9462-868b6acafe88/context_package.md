# Context Package: Addition and Subtraction Operations

## Codebase References

### Primary Implementation Files

| File Path | Role | Modification Required |
|-----------|------|----------------------|
| `Calculator.cs` | Core arithmetic logic | Add `Add(double a, double b)` and `Subtract(double a, double b)` methods |
| `Program.cs` | Console UI and operation dispatcher | Add menu options "1. Add" and "2. Subtract" with case handlers for both operations |
| `CalculatorTests.cs` | Unit test suite | Add test methods for addition and subtraction scenarios |

### Configuration Files

| File Path | Role | Modification Required |
|-----------|------|----------------------|
| `Calculator.csproj` | Main project configuration | No changes required |
| `CalculatorTests.csproj` | Test project configuration | No changes required |

### Documentation

| File Path | Role | Modification Required |
|-----------|------|----------------------|
| `README.md` | Project documentation | Already references addition and subtraction operations; verify accuracy after implementation |

### Non-Relevant Files

The following files are legacy artifacts from a previous Node.js project and are not relevant to this orbit:
- `backend/api/properties/search.js`
- `backend/database/queries/property-search.sql`

## Architecture Context

### Application Structure

The Calculator application follows a simple three-layer architecture:

1. **Core Logic Layer** (`Calculator.cs`): Pure arithmetic methods that accept `double` parameters and return `double` results
2. **Presentation Layer** (`Program.cs`): Console-based user interface that handles input/output, menu navigation, and operation dispatch
3. **Test Layer** (`CalculatorTests.cs`): xUnit-based test suite that validates core logic in isolation

### Data Flow Pattern

Based on the README example and the existing multiplication operation (orbit 634a82e2), the standard flow is:

```
User Input (Program.cs)
    ↓
Menu Selection Parsing (1-5)
    ↓
Number Input Collection (2 operands)
    ↓
Calculator Method Invocation (Calculator.cs)
    ↓
Result Calculation
    ↓
Console Output (Program.cs)
    ↓
Loop Back to Menu
```

Addition and subtraction must integrate into this exact flow pattern at menu positions "1" and "2" respectively.

### Error Handling Architecture

The application uses a **defensive validation** pattern:
- Input validation occurs at the UI layer (`Program.cs`) for numeric parsing using `double.TryParse`
- Domain validation (e.g., division by zero) occurs at the core logic layer where applicable
- Errors are communicated back to the UI layer for user-friendly display via console messages
- The application continues running after errors (no exception crashes in the main loop)

**Addition and Subtraction Specific:** Unlike division, addition and subtraction have no invalid mathematical states. All `double + double` and `double - double` operations are valid within IEEE 754 floating-point arithmetic. Therefore, no domain-level error handling is required in `Calculator.cs` for these operations.

### Technology Stack

- **Language:** C# with .NET 6.0+ runtime
- **Testing Framework:** xUnit (standard for .NET projects)
- **Deployment:** Console application (no web server, no external services)
- **Data Persistence:** None (stateless operation-by-operation execution)

### Current Menu Structure

Per the README.md example, the menu structure is:

```
1. Add          ← TO BE IMPLEMENTED
2. Subtract     ← TO BE IMPLEMENTED
3. Multiply     ← EXISTS (orbit 634a82e2)
4. Divide       ← EXISTS or planned
5. Exit         ← EXISTS
```

This orbit will complete slots 1 and 2, which are currently either empty placeholders or need implementation.

## Pattern Library

### Method Signature Pattern

Based on orbit 634a82e2 (multiplication), arithmetic methods in `Calculator.cs` follow this signature pattern:

```csharp
public double OperationName(double a, double b)
```

Expected method signatures for this orbit:
```csharp
public double Add(double a, double b)
public double Subtract(double a, double b)
```

### Implementation Pattern for Simple Operations

For operations without error conditions (like addition and subtraction), the pattern is:

```csharp
public double OperationName(double a, double b)
{
    return a [operator] b;
}
```

Example from multiplication:
```csharp
public double Multiply(double a, double b)
{
    return a * b;
}
```

### Error Handling Pattern

For operations requiring error handling (like division by zero), the pattern uses exceptions:

```csharp
public double OperationName(double a, double b)
{
    if (invalid_condition)
    {
        throw new SpecificException("Error message");
    }
    return a [operator] b;
}
```

**Not applicable to addition and subtraction** — these operations have no invalid states.

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

Error messages for input validation follow this format:
```
Error: Invalid number format. Please try again.
```

### Program.cs Case Handler Pattern

Each operation in `Program.cs` follows this structure:

```csharp
case "[number]":
    Console.Write("Enter first number: ");
    if (double.TryParse(Console.ReadLine(), out double num1))
    {
        Console.Write("Enter second number: ");
        if (double.TryParse(Console.ReadLine(), out double num2))
        {
            // Optional: try-catch for operations with error conditions
            double result = calculator.OperationName(num1, num2);
            Console.WriteLine($"Result of [operation]: {result}");
        }
        else
        {
            Console.WriteLine("Error: Invalid number format. Please try again.");
        }
    }
    else
    {
        Console.WriteLine("Error: Invalid number format. Please try again.");
    }
    break;
```

For addition and subtraction, no try-catch block is needed because there are no domain-level exceptions.

### Naming Conventions

- **Method Names:** PascalCase, verb-based (e.g., `Add`, `Subtract`, `Multiply`)
- **Parameter Names:** Single lowercase letters for operands (`a`, `b`)
- **Test Method Names:** Follow xUnit convention: `MethodName_Scenario_ExpectedBehavior`
  - Example: `Add_TwoPositiveNumbers_ReturnsCorrectSum`
  - Example: `Subtract_NegativeFromPositive_ReturnsCorrectDifference`

### Test Structure Pattern

Each operation should have test methods covering:
- **Happy path:** Correct results for typical inputs
- **Edge cases:** Zero operands, negative numbers, decimal values, mixed signs
- **Boundary cases:** Very large/small numbers (stretch goal)

Test methods use xUnit's `[Fact]` attribute for simple tests and `[Theory]` with `[InlineData]` for parameterized tests.

Example structure:
```csharp
[Fact]
public void Add_TwoPositiveIntegers_ReturnsCorrectSum()
{
    var calculator = new Calculator();
    double result = calculator.Add(5, 3);
    Assert.Equal(8.0, result);
}

[Theory]
[InlineData(5, 3, 8)]
[InlineData(-5, 3, -2)]
[InlineData(5, -3, 2)]
public void Add_VariousInputs_ReturnsCorrectSum(double a, double b, double expected)
{
    var calculator = new Calculator();
    double result = calculator.Add(a, b);
    Assert.Equal(expected, result);
}
```

## Prior Orbit References

### Orbit 634a82e2: Multiplication Operation

This orbit established the current pattern for arithmetic operations and serves as the direct template for addition and subtraction implementation.

**Key Artifacts:**
- `.orbital/artifacts/634a82e2-fe76-43e4-90c4-5cbc43033ad8/intent_document.md`
- `.orbital/artifacts/634a82e2-fe76-43e4-90c4-5cbc43033ad8/context_package.md`
- `.orbital/artifacts/634a82e2-fe76-43e4-90c4-5cbc43033ad8/proposal_record.md`
- `.orbital/artifacts/634a82e2-fe76-43e4-90c4-5cbc43033ad8/code_generation.md`
- `.orbital/artifacts/634a82e2-fe76-43e4-90c4-5cbc43033ad8/test_results.md`

**Patterns to Replicate:**
- Method implementation in `Calculator.cs` with `double` parameters and simple return statement
- Menu integration in `Program.cs` with sequential numbering
- Test coverage in `CalculatorTests.cs` with multiple scenarios using `[Theory]` and `[InlineData]`

**Key Difference:**
Addition and subtraction are even simpler than multiplication — no error conditions exist, so no exception handling is required in the core logic methods.

### Orbit 54343d0b: Division Operation (In Progress)

This orbit is currently generating artifacts for division (option "4" in the menu). It includes additional complexity for division-by-zero handling.

**Key Artifacts:**
- `.orbital/artifacts/54343d0b-2548-4021-9462-868b6acafe88/intent_document.md`
- `.orbital/artifacts/54343d0b-2548-4021-9462-868b6acafe88/context_package.md`
- `.orbital/artifacts/54343d0b-2548-4021-9462-868b6acafe88/proposal_record.md`

**Relevance:**
Division demonstrates the error handling pattern with `DivideByZeroException`. Addition and subtraction do NOT require this complexity.

### Other Prior Orbits

Two additional orbit artifact directories exist:
- `.orbital/artifacts/98c23c71-dce9-4fbb-8422-9c6b36bb3743/`
- `.orbital/artifacts/e89626f7-2fb2-42bf-b881-84a9ea17c15d/`

These may represent earlier iterations or alternative implementations. The multiplication orbit (634a82e2) is the primary reference pattern.

## Risk Assessment

### Critical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Menu option conflicts** | User confusion, wrong operation executed | Medium | Verify menu options "1" and "2" are correctly positioned; test all 5 menu options after implementation |
| **Breaking existing operations** | Regression in multiply/divide | Low | Run full test suite before completing orbit; no shared code modifications expected |
| **Inconsistent output formatting** | Poor UX, user confusion | Low | Follow exact pattern from multiplication: "Result of [operation]: [value]" |
| **Test coverage gaps** | Undetected bugs in edge cases | Medium | Implement test matrix covering positive, negative, zero, and decimal operands |

### Implementation Risks

**Method Placement in Calculator.cs:**
- **Risk:** Adding methods in incorrect order disrupts logical flow
- **Impact:** Code readability, maintenance confusion
- **Mitigation:** Add `Add` method first, then `Subtract`, maintaining alphabetical or logical ordering with existing `Multiply` method

**Floating-Point Arithmetic Behavior:**
- **Risk:** Floating-point precision limitations cause unexpected results (e.g., 0.1 + 0.2 ≠ 0.3 exactly)
- **Impact:** User surprise at "incorrect" decimal results
- **Mitigation:** This is accepted behavior per Intent Document constraints; document in tests if necessary

### Integration Risks

**Menu System Modification:**
- **Risk:** Incorrect switch/case logic in `Program.cs` breaks operation dispatch
- **Impact:** Operations don't execute or wrong operation runs
- **Mitigation:** Follow exact pattern from multiplication case; add case "1" and case "2" blocks before case "3"

**Input Validation Consistency:**
- **Risk:** Error messages differ from existing operations
- **Impact:** Inconsistent UX
- **Mitigation:** Use exact error message text: "Error: Invalid number format. Please try again."

### Test Coverage Risks

**Insufficient Edge Case Testing:**
- **Risk:** Edge cases like negative operands or zero not tested
- **Impact:** Silent failures or incorrect results in production
- **Mitigation:** Implement test matrix covering:
  - Positive + Positive, Negative + Negative, Positive + Negative
  - Zero + Number, Number + Zero, Zero + Zero
  - Decimal + Decimal combinations
  - Same patterns for subtraction

**Floating-Point Assertion Precision:**
- **Risk:** Tests fail due to floating-point representation (e.g., 0.1 + 0.2)
- **Impact:** False test failures block orbit completion
- **Mitigation:** Use direct equality for simple integer results; accept standard `double` precision behavior for decimals per Intent Document

### Architecture Risks

**Pattern Divergence:**
- **Risk:** Implementing addition/subtraction differently than multiplication breaks consistency
- **Impact:** Maintenance burden, confusion for future developers
- **Mitigation:** Strictly follow orbit 634a82e2 patterns for method signatures, UI integration, and test structure

**No Error Handling Assumption:**
- **Risk:** Future requirements might need error handling that wasn't built in
- **Impact:** Rework required if constraints change
- **Mitigation:** Document that addition/subtraction have no mathematical error states; this is by design, not oversight

### Performance Considerations

**Not Applicable:** Addition and subtraction of two `double` values are single CPU instructions with negligible performance impact. No performance risks exist for this orbit.

### Security Considerations

**Not Applicable:** This is a local console application with no network exposure, no user authentication, and no data persistence. Standard floating-point arithmetic introduces no security vulnerabilities.

### Regression Testing Strategy

To mitigate breaking changes:
1. Run full existing test suite before any code changes
2. After implementation, run full test suite again to verify no regressions
3. Manually test all five menu options (Add, Subtract, Multiply, Divide, Exit)
4. Verify the application can execute multiple operations in succession without crashing