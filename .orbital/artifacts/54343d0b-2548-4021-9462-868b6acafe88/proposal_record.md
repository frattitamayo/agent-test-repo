# Proposal Record: Addition and Subtraction Operations

## Interpreted Intent

The Calculator console application currently has multiplication functionality (orbit 634a82e2) and division is referenced in documentation, but the foundational arithmetic operations of addition and subtraction are missing. This orbit implements both operations as menu options "1" and "2" respectively, allowing users to add or subtract two numbers with full support for positive, negative, zero, and decimal operands.

Addition combines two numbers (a + b) and subtraction finds the difference (a - b). Both operations are mathematically simple with no error states — every combination of `double` values produces a valid result within IEEE 754 floating-point arithmetic. This makes them simpler to implement than division (which requires zero-divisor handling) while still requiring careful attention to UX consistency and test coverage.

The user's regeneration feedback ("i want addition and subratcion") confirms the intent is specifically for these two basic arithmetic operations, not division or other advanced functionality. The implementation must follow the established patterns from orbit 634a82e2 (multiplication) to maintain architectural consistency.

## Implementation Plan

### Phase 1: Core Logic Implementation

**File:** `Calculator.cs`

Add two methods following the established pattern from the existing `Multiply` method:

```csharp
public double Add(double a, double b)
{
    return a + b;
}

public double Subtract(double a, double b)
{
    return a - b;
}
```

**Rationale:** 
- These are the simplest possible implementations because addition and subtraction have no invalid input states
- No error handling or validation required at this layer (input validation occurs in `Program.cs`)
- Direct operator application matches the `Multiply` pattern from orbit 634a82e2

**Method Placement:** Add these methods at the beginning of the `Calculator` class, before `Multiply`, to maintain logical operation ordering (Add, Subtract, Multiply, Divide).

### Phase 2: Console UI Integration

**File:** `Program.cs`

**Change 1 - Menu Display:** Add addition and subtraction options to the menu enumeration

```csharp
Console.WriteLine("1. Add");
Console.WriteLine("2. Subtract");
Console.WriteLine("3. Multiply");
Console.WriteLine("4. Divide");
Console.WriteLine("5. Exit");
```

Insert these lines in the existing menu display section, ensuring options are numbered 1-5 sequentially.

**Change 2 - Addition Operation Handler:** Add case handler for addition

```csharp
case "1":
    Console.Write("Enter first number: ");
    if (double.TryParse(Console.ReadLine(), out double addNum1))
    {
        Console.Write("Enter second number: ");
        if (double.TryParse(Console.ReadLine(), out double addNum2))
        {
            double addResult = calculator.Add(addNum1, addNum2);
            Console.WriteLine($"Result of addition: {addResult}");
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

**Change 3 - Subtraction Operation Handler:** Add case handler for subtraction

```csharp
case "2":
    Console.Write("Enter first number: ");
    if (double.TryParse(Console.ReadLine(), out double subNum1))
    {
        Console.Write("Enter second number: ");
        if (double.TryParse(Console.ReadLine(), out double subNum2))
        {
            double subResult = calculator.Subtract(subNum1, subNum2);
            Console.WriteLine($"Result of subtraction: {subResult}");
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

**Rationale:** This pattern exactly mirrors the multiplication case structure while using operation-specific variable names (`addNum1`, `subNum1`) to avoid naming conflicts and improve code clarity. No try-catch blocks are needed because addition and subtraction do not throw exceptions.

**Location:** Insert case "1" and case "2" handlers before the existing case "3" (multiply) handler in the switch statement.

### Phase 3: Test Implementation

**File:** `CalculatorTests.cs`

Implement comprehensive test coverage for both operations, targeting the "Target" acceptance boundary level:

#### Addition Tests

**Test 1 - Basic Addition (Minimum Boundary):**
```csharp
[Fact]
public void Add_TwoPositiveIntegers_ReturnsCorrectSum()
{
    var calculator = new Calculator();
    double result = calculator.Add(5, 3);
    Assert.Equal(8.0, result);
}
```

**Test 2 - Mixed Sign Operations (Target Boundary):**
```csharp
[Theory]
[InlineData(5, 3, 8)]           // positive + positive
[InlineData(-5, -3, -8)]        // negative + negative
[InlineData(5, -3, 2)]          // positive + negative
[InlineData(-5, 3, -2)]         // negative + positive
[InlineData(0, 5, 5)]           // zero + positive
[InlineData(5, 0, 5)]           // positive + zero
[InlineData(0, 0, 0)]           // zero + zero
public void Add_VariousInputs_ReturnsCorrectSum(double a, double b, double expected)
{
    var calculator = new Calculator();
    double result = calculator.Add(a, b);
    Assert.Equal(expected, result);
}
```

**Test 3 - Decimal Operands (Target Boundary):**
```csharp
[Fact]
public void Add_DecimalOperands_ReturnsCorrectSum()
{
    var calculator = new Calculator();
    double result = calculator.Add(2.5, 3.7);
    Assert.Equal(6.2, result);
}
```

**Test 4 - Negative Decimals:**
```csharp
[Fact]
public void Add_NegativeDecimals_ReturnsCorrectSum()
{
    var calculator = new Calculator();
    double result = calculator.Add(-2.5, -1.5);
    Assert.Equal(-4.0, result);
}
```

#### Subtraction Tests

**Test 5 - Basic Subtraction (Minimum Boundary):**
```csharp
[Fact]
public void Subtract_TwoPositiveIntegers_ReturnsCorrectDifference()
{
    var calculator = new Calculator();
    double result = calculator.Subtract(10, 4);
    Assert.Equal(6.0, result);
}
```

**Test 6 - Mixed Sign Operations (Target Boundary):**
```csharp
[Theory]
[InlineData(10, 4, 6)]          // positive - positive
[InlineData(-10, -4, -6)]       // negative - negative
[InlineData(10, -4, 14)]        // positive - negative (becomes addition)
[InlineData(-10, 4, -14)]       // negative - positive
[InlineData(0, 5, -5)]          // zero - positive
[InlineData(5, 0, 5)]           // positive - zero
[InlineData(0, 0, 0)]           // zero - zero
public void Subtract_VariousInputs_ReturnsCorrectDifference(double a, double b, double expected)
{
    var calculator = new Calculator();
    double result = calculator.Subtract(a, b);
    Assert.Equal(expected, result);
}
```

**Test 7 - Decimal Operands (Target Boundary):**
```csharp
[Fact]
public void Subtract_DecimalOperands_ReturnsCorrectDifference()
{
    var calculator = new Calculator();
    double result = calculator.Subtract(7.5, 2.3);
    Assert.Equal(5.2, result);
}
```

**Test 8 - Result Becomes Negative:**
```csharp
[Fact]
public void Subtract_SmallerFromLarger_ReturnsNegative()
{
    var calculator = new Calculator();
    double result = calculator.Subtract(3, 10);
    Assert.Equal(-7.0, result);
}
```

**Location:** Add all test methods in `CalculatorTests.cs` after the existing test class declaration. Group addition tests together, then subtraction tests, maintaining alphabetical ordering of method names within each group.

### Phase 4: Verification

**Pre-Merge Checklist:**

1. **Build Verification:**
   - Run `dotnet build Calculator.csproj` to verify no compilation errors
   - Confirm all methods compile without warnings

2. **Automated Test Verification:**
   - Run `dotnet test CalculatorTests.csproj` to verify all tests pass
   - Confirm no test regressions in existing multiplication/division tests

3. **Manual Integration Testing:**
   - Run `dotnet run --project Calculator.csproj` and verify:
     - Option "1. Add" appears in menu
     - Option "2. Subtract" appears in menu
     - Addition of 5 + 3 produces "Result of addition: 8"
     - Subtraction of 10 - 4 produces "Result of subtraction: 6"
     - Negative numbers work correctly (e.g., -5 + 3 = -2)
     - Decimal numbers work correctly (e.g., 2.5 + 1.5 = 4)
     - Invalid input produces "Error: Invalid number format. Please try again."
     - Application returns to menu after each operation
     - All five menu options (Add, Subtract, Multiply, Divide, Exit) function correctly

4. **Documentation Verification:**
   - Confirm README.md already documents these operations correctly (per current README content)
   - No documentation changes required

### Dependency Order

1. **First:** Implement `Calculator.cs` methods (`Add`, `Subtract`) — enables compilation of all downstream code
2. **Second:** Implement `CalculatorTests.cs` tests — enables automated verification of logic correctness
3. **Third:** Implement `Program.cs` UI integration (menu + case handlers) — enables end-to-end manual testing
4. **Fourth:** Execute verification checklist — confirms orbit completion

## Risk Surface

### Risk 1: Floating-Point Precision Edge Cases

**Description:** Operations like `0.1 + 0.2` produce `0.30000000000000004` due to IEEE 754 binary representation limitations, not the expected `0.3`.

**Likelihood:** Medium (common in decimal arithmetic)  
**Impact:** Low (expected behavior, not a bug)

**Mitigation:**
- Accept standard `double` precision behavior per Intent Document constraints
- Tests use direct equality assertions for simple integer results
- For decimal tests, use exact expected values from C# floating-point arithmetic (e.g., test `0.1 + 0.2` against `0.30000000000000004`, not `0.3`)
- Document this behavior if it becomes a user concern in future orbits

### Risk 2: Menu Option Positioning

**Description:** If existing code already has operations at positions "1" and "2", this creates a conflict requiring renumbering.

**Likelihood:** Low (README shows positions 1-2 as Add/Subtract)  
**Impact:** Medium (requires refactoring existing menu structure)

**Mitigation:**
- Verification checklist includes inspection of current `Program.cs` menu structure before implementation
- README.md already documents correct numbering (1=Add, 2=Subtract, 3=Multiply, 4=Divide, 5=Exit)
- If conflict exists, adjust existing cases before adding new ones

### Risk 3: Variable Naming Conflicts

**Description:** Using generic variable names like `num1`, `num2` in multiple case blocks could cause confusion or compiler errors if scoping is incorrect.

**Likelihood:** Low (each case block has its own scope)  
**Impact:** Low (compilation error, easy to detect)

**Mitigation:**
- Use operation-specific variable names (`addNum1`, `addNum2`, `subNum1`, `subNum2`)
- Each case block is self-contained with unique variable names
- Compiler will catch any scope violations during build phase

### Risk 4: Test Coverage Incompleteness

**Description:** Tests might miss edge cases like zero operands, negative results, or decimal precision scenarios.

**Likelihood:** Low (implementation plan includes comprehensive test matrix)  
**Impact:** Medium (silent bugs in production)

**Mitigation:**
- Test matrix explicitly covers all target-level acceptance boundaries:
  - Positive, negative, zero operands
  - Decimal operands
  - Mixed sign operations
  - Results that change sign (e.g., 3 - 10 = -7)
- Total of 8 test methods with 14 distinct test scenarios via `[InlineData]`

### Risk 5: Breaking Existing Operations

**Description:** Modifications to `Program.cs` could inadvertently break existing multiply or divide case handlers.

**Likelihood:** Very Low (adding new cases, not modifying existing ones)  
**Impact:** High (regression in working functionality)

**Mitigation:**
- New case handlers are inserted before existing cases, not modifying them
- Full test suite execution before merge catches any regressions
- Manual testing of all 5 menu options confirms no breaking changes

### Risk 6: Input Validation Consistency

**Description:** Error messages or input validation behavior might differ from existing operations.

**Likelihood:** Low (implementation follows exact pattern)  
**Impact:** Low (cosmetic UX inconsistency)

**Mitigation:**
- Use exact error message text from Context Package: "Error: Invalid number format. Please try again."
- Input validation uses same `double.TryParse` pattern as existing operations
- Manual testing verifies consistent error message display

### Risk 7: README Documentation Accuracy

**Description:** Current README might document features that don't exist or need updates after implementation.

**Likelihood:** Very Low (README already lists Add and Subtract)  
**Impact:** Low (documentation drift)

**Mitigation:**
- README.md already correctly documents addition and subtraction operations
- Verification checklist includes README accuracy check
- No changes anticipated, but verify example usage still matches implementation

## Scope Estimate

### Complexity Assessment: Very Low

**Rationale:**
- Two methods with single-line implementations (simplest possible code)
- No error handling or edge case logic required
- Follows established pattern from orbit 634a82e2 with no architectural changes
- UI integration is straightforward duplication of existing case handler pattern
- Test implementation is standard xUnit with no complex setup

### Work Breakdown

| Phase | Estimated Lines of Code | Risk Level |
|-------|------------------------|------------|
| Core Logic (`Calculator.cs`) | ~8 lines (2 methods × 4 lines each) | Very Low |
| UI Integration (`Program.cs`) | ~40 lines (2 case handlers × 20 lines each) | Very Low |
| Test Implementation (`CalculatorTests.cs`) | ~120 lines (8 test methods with inline data) | Very Low |
| **Total** | **~168 lines** | **Very Low** |

### Orbit Count: 1

This implementation can be completed in a single orbit because:
- All changes are localized to three existing files
- No new files, dependencies, or configuration changes required
- No complex error handling or architectural decisions needed
- Pattern is fully established by prior orbit 634a82e2
- Verification is straightforward with automated tests and simple manual checks

### Time Estimate

- **Implementation:** 20-30 minutes (coding both operations and tests)
- **Test Execution:** 5 minutes (automated test suite)
- **Manual Verification:** 10-15 minutes (console smoke testing all 5 menu options)
- **Code Review:** 15-20 minutes (human review at Tier 2)
- **Total:** ~50-70 minutes end-to-end

### Acceptance Boundary Targeting

This proposal targets the **Target** level across all acceptance boundary categories:

| Boundary | Target Level Achievement |
|----------|--------------------------|
| Functional Correctness | ✓ All numeric input types (positive, negative, zero, decimal) |
| Error Handling | ✓ Specific feedback for invalid numeric input via `TryParse` |
| Test Coverage | ✓ Negative numbers, decimals, zero operands, mixed sign operations |
| Integration Quality | ✓ Output formatting matches existing operations; seamless menu integration |

**Stretch goals explicitly excluded:**
- Boundary testing for `double.MaxValue` / `double.MinValue` edge cases
- Scientific notation input handling
- Overflow/underflow detection

The target level is appropriate because:
- Addition and subtraction are foundational operations requiring solid coverage
- Stretch goals provide diminishing returns (floating-point limits rarely encountered in calculator usage)
- Target level meets all user-facing acceptance criteria from Intent Document

### Implementation Sequence

1. **Calculator.cs** (5 minutes) — Add two simple methods
2. **CalculatorTests.cs** (15 minutes) — Implement 8 test methods with comprehensive coverage
3. **Program.cs** (10 minutes) — Add menu display updates and two case handlers
4. **Build & Test** (5 minutes) — Verify compilation and automated tests
5. **Manual Testing** (15 minutes) — Exercise all menu options and edge cases
6. **Human Review** (20 minutes) — Code review and approval

Total active development time: ~45 minutes  
Total elapsed time with review: ~70 minutes

## Human Modifications

Pending human review.