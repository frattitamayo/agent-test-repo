# Context Package: Division Operation Implementation

## Codebase References

### Primary Implementation Files

**Calculator.cs**
- Core arithmetic logic class containing existing operations
- Expected location for the new `Divide` method
- Must maintain consistency with existing method signatures: `public double MethodName(double a, double b)`
- Current operations (Add, Subtract, Multiply) serve as direct templates

**Program.cs**
- Console application entry point and user interface controller
- Contains main menu loop and operation selection logic
- Handles user input parsing and result display
- Must be modified to add "Divide" option to the operation menu and route selection to the new divide method

**CalculatorTests.cs**
- xUnit test suite for all calculator operations
- Contains test patterns for each existing operation
- Must be extended with division test cases following established naming conventions
- Uses standard xUnit assertions (Assert.Equal, Assert.Throws, etc.)

### Project Configuration Files

**Calculator.csproj**
- Main project definition targeting .NET 6.0+
- No modifications required (no new dependencies needed)

**CalculatorTests.csproj**
- Test project configuration
- References Calculator project and xUnit framework
- No modifications required

### Irrelevant Legacy Files

**backend/api/properties/search.js**
**backend/database/queries/property-search.sql**
- Node.js remnants from previous repository contents
- Not related to the C# calculator implementation
- Should be ignored for this orbit

## Architecture Context

### System Structure

The calculator follows a simple three-layer console application architecture:

1. **Core Logic Layer** (`Calculator.cs`)
   - Pure computation methods with no I/O concerns
   - Each operation is a public method accepting two `double` parameters and returning a `double`
   - No state management — all methods are stateless computations
   - Error conditions are communicated through return values or thrown exceptions (pattern TBD from code inspection)

2. **Presentation Layer** (`Program.cs`)
   - Console-based user interface
   - Main loop pattern: display menu → read selection → read operands → invoke operation → display result → repeat
   - Input validation and parsing happen in this layer
   - User-facing error messages originate here

3. **Test Layer** (`CalculatorTests.cs`)
   - Isolated unit tests with no integration or end-to-end tests
   - Each operation has multiple test methods covering positive cases, negative cases, and edge cases
   - Tests use xUnit framework conventions

### Data Flow

```
User Input (Console) → Program.cs validates and parses
                     ↓
                Calculator.cs performs computation
                     ↓
                Result or Error → Program.cs formats and displays
```

### Error Handling Strategy

Based on the Intent Document's requirement that "division by zero MUST return an error condition without throwing unhandled exceptions," the implementation must determine:

- Whether existing operations throw exceptions or return special values for errors
- How `Program.cs` currently handles operation failures
- Whether a consistent error pattern exists across Add, Subtract, Multiply

**Critical Unknown:** The actual error handling mechanism must be extracted from `Calculator.cs` and `Program.cs` source code inspection. The README mentions "robust error handling" but doesn't specify the technical approach.

### No External Dependencies

- No database connections
- No network calls or external APIs
- No file system access
- No third-party NuGet packages beyond xUnit (test-only dependency)
- Pure .NET standard library arithmetic

## Pattern Library

### Method Signature Pattern

Based on the Intent Document's constraint that division "MUST follow the same method signature pattern as existing operations":

```csharp
public double OperationName(double a, double b)
```

Expected pattern for division:
```csharp
public double Divide(double dividend, double divisor)
```

### Naming Conventions

- **Class names:** PascalCase (e.g., `Calculator`, `CalculatorTests`)
- **Method names:** PascalCase verbs (e.g., `Add`, `Subtract`, `Multiply` → `Divide`)
- **Test method names:** Likely follows xUnit convention `MethodName_Scenario_ExpectedBehavior` or similar descriptive pattern
- **Parameter names:** camelCase, semantically meaningful (e.g., `dividend`, `divisor` rather than generic `a`, `b`)

### Console UI Pattern

Based on README example and Intent constraints:

1. Display numbered menu with operation names
2. Read user choice (1-5, where 5 is Exit)
3. For valid operation selection:
   - Prompt "Enter first number:"
   - Read and parse input
   - Prompt "Enter second number:"
   - Read and parse input
   - Execute operation
   - Display "Result of [operation]: [value]"
4. Handle invalid selections by re-prompting
5. Loop until user selects Exit

### Test Pattern Standards

Expected test structure based on existing xUnit practices:

```csharp
[Fact]
public void OperationName_Scenario_ExpectedOutcome()
{
    // Arrange
    var calculator = new Calculator();
    
    // Act
    var result = calculator.OperationName(input1, input2);
    
    // Assert
    Assert.Equal(expectedValue, result);
}
```

For exception testing (if division by zero throws):
```csharp
[Fact]
public void Divide_ByZero_ThrowsException()
{
    var calculator = new Calculator();
    Assert.Throws<DivideByZeroException>(() => calculator.Divide(10, 0));
}
```

### Code Style Observations

- C# standard conventions (4-space indentation likely, though not confirmed)
- Public methods in Calculator class
- Console.WriteLine for output
- Console.ReadLine for input
- Double.TryParse or similar for input validation

## Prior Orbit References

### No Direct Prior Orbits

This is Orbit 1 in the "Division" intent within the "Calculator" trajectory. No previous orbits have touched this codebase in the ORBITAL system context.

### Existing Implementation Reference

The three existing operations (Add, Subtract, Multiply) serve as the de facto "prior work":

**Add Operation:**
- Provides the template for basic binary arithmetic operation implementation
- Demonstrates method signature pattern
- Shows how positive and negative numbers are handled

**Subtract Operation:**
- Similar to Add, demonstrates sign handling in results
- May have specific test cases for negative results

**Multiply Operation:**
- Most similar to division in complexity
- May handle edge cases like multiplication by zero
- Could provide insights into error handling patterns if any exist

### README Documentation as Specification

The README already lists "Divide" as a supported feature with "division by zero protection," indicating:
- The feature design has been documented
- User expectations are set for divide-by-zero handling
- Error message should align with documented behavior
- Example shows operation number 4 for Divide (if menu uses 1=Add, 2=Subtract, 3=Multiply, 4=Divide, 5=Exit)

**Implication:** Implementation must match the README's promises or the README must be updated if current documentation is aspirational rather than descriptive.

## Risk Assessment

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Inconsistent error handling pattern** — Division by zero approach differs from existing operations | High | Medium | Inspect Calculator.cs before implementation; follow established pattern exactly; if no pattern exists, choose exception-based approach consistent with .NET conventions |
| **Floating-point precision issues** — Division creates repeating decimals or precision loss | Medium | Low | Accept standard `double` precision per constraints; document behavior in tests; no custom rounding unless existing operations use it |
| **Menu numbering conflicts** — Assuming operation 4 is Divide when it might be different | Low | Low | Verify actual menu structure in Program.cs; adjust numbering to match existing sequence |
| **Test framework version mismatch** — xUnit version might affect test writing syntax | Low | Low | Inspect CalculatorTests.csproj for xUnit version; use compatible assertion syntax |

### Regression Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Accidental modification of existing operations** — Changes to Calculator.cs affect Add/Subtract/Multiply | Low | High | Only add new Divide method; do not refactor existing methods; run all existing tests before and after |
| **Menu loop break** — Changes to Program.cs break operation selection flow | Medium | Medium | Minimize changes to Program.cs structure; only add case for division; preserve existing control flow |
| **Test suite contamination** — New tests interfere with existing tests | Low | Medium | Follow existing test isolation patterns; ensure Calculator instantiation per test; no shared state |

### Domain-Specific Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Division by zero not caught** — User can crash app with zero divisor | High if not implemented | High | Implement explicit check: `if (divisor == 0)` before computation; return error or throw exception per pattern |
| **Incorrect sign handling** — Negative number division produces wrong sign | Low | Medium | Implement comprehensive test cases for all sign combinations; rely on .NET operator behavior |
| **Special value handling** — Division involving NaN, Infinity, or extremely large/small numbers | Low | Low | Document as acceptable per `double` type behavior; add edge case tests if patterns exist |

### Security Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Denial of service via input** — Malicious input causes hang or crash | Very Low | Very Low | Console app has no network exposure; input validation already exists per README; no additional concerns |
| **Information disclosure** — Error messages reveal system internals | Very Low | Very Low | Use user-friendly error messages; no stack traces in normal operation (console apps show exceptions by default, acceptable for this context) |

### Integration Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Build system failure** — Project doesn't compile after changes | Low | Medium | Test with `dotnet build` before committing; ensure .NET 6.0+ SDK availability |
| **Test execution failure** — Tests don't run or report incorrectly | Low | Medium | Test with `dotnet test` before committing; verify all new tests appear in output |

### Critical Implementation Unknowns

The following require code inspection before Proposal generation:

1. **Error handling mechanism in Calculator.cs** — Does it throw exceptions or return error codes/special values?
2. **Actual menu structure in Program.cs** — What is the current numbering scheme and control flow?
3. **Existing test naming convention** — What pattern do current tests follow?
4. **Input validation location** — Where does number parsing happen and how are parse failures handled?

These unknowns are **blockers for accurate proposal generation** and must be resolved by examining the actual source code of Calculator.cs, Program.cs, and CalculatorTests.cs.