# Context Package: Addition Functionality for Calculator

## Codebase References

**Current Repository State:**

The repository at `frattitamayo/agent-test-repo` currently contains Node.js backend code for a property search API, which is inconsistent with the Calculator C# console application described in the project metadata. This represents a critical context gap.

**Expected C# Project Structure (Not Present):**

The following files are expected to exist for a C# console calculator but are not visible in the current repository structure:

- `Calculator.csproj` or `Calculator.sln` — Project/solution file for C# compilation
- `Program.cs` — Main entry point for the console application
- `Calculator.cs` or similar — Core calculator logic class
- `Properties/AssemblyInfo.cs` — Assembly metadata (if using .NET Framework)

**Current Repository Contents:**

- `README.md` — Describes a Node.js property search API (mismatched with project description)
- `backend/api/properties/search.js` — Node.js API endpoint (not relevant to C# calculator)
- `backend/database/queries/property-search.sql` — SQL query file (not relevant to calculator)
- `.orbital/artifacts/` — ORBITAL methodology artifacts from prior orbits

**Critical Finding:**

The repository structure indicates this may be a template repository or the C# calculator project has not yet been initialized. The implementation phase will need to either:
1. Create the initial C# project structure from scratch, or
2. Identify the correct repository location if this is not the target codebase

## Architecture Context

**Application Type:**

Console application built with C# targeting .NET Framework or .NET Core/5+. The architecture should follow a simple layered pattern appropriate for a calculator utility.

**Recommended Structure:**

```
Calculator/
├── Calculator.csproj          # Project file
├── Program.cs                 # Entry point, user interaction loop
├── CalculatorEngine.cs        # Core arithmetic operations class
└── InputValidator.cs          # Input parsing and validation (optional)
```

**Execution Flow:**

1. **Entry Point** (`Program.cs`) — Initializes the application, displays menu, captures user input
2. **Operation Selection** — User selects addition operation from available choices
3. **Input Collection** — Prompts for two numeric values
4. **Validation** — Ensures inputs are valid numbers before processing
5. **Calculation** — Invokes addition method from calculator engine
6. **Output Display** — Shows formatted result to console
7. **Loop/Exit** — Returns to menu or exits based on user choice

**Data Flow:**

- Input: Console `Console.ReadLine()` → String
- Parsing: String → `double` or `decimal` via `double.TryParse()` or `decimal.TryParse()`
- Calculation: Two numeric operands → Addition method → Numeric result
- Output: Result → `Console.WriteLine()` → Formatted string display

**Type Selection Considerations:**

- `double`: Suitable for general-purpose arithmetic, IEEE 754 floating-point, ~15-17 decimal digit precision
- `decimal`: Suitable for financial calculations, 128-bit precision, 28-29 significant decimal digits
- `int`: Not recommended as primary type due to inability to handle decimal inputs per acceptance boundaries

**Recommended Choice:** `double` for this calculator context, as it balances precision with performance and is standard for scientific calculator applications. The 10 decimal place precision requirement in the intent is well within `double` capabilities.

## Pattern Library

**C# Naming Conventions:**

Since no existing C# code is present in the repository, standard Microsoft C# conventions should be followed:

- **Classes:** PascalCase (e.g., `CalculatorEngine`, `InputValidator`)
- **Methods:** PascalCase (e.g., `Add`, `ValidateNumericInput`)
- **Parameters:** camelCase (e.g., `firstNumber`, `secondNumber`)
- **Local Variables:** camelCase (e.g., `userInput`, `result`)
- **Constants:** PascalCase or UPPER_SNAKE_CASE (e.g., `MaxDecimalPlaces` or `MAX_DECIMAL_PLACES`)

**Console Application Patterns:**

```csharp
// Standard input pattern with validation
public static bool TryGetNumericInput(string prompt, out double value)
{
    Console.Write(prompt);
    string input = Console.ReadLine();
    return double.TryParse(input, out value);
}

// Operation method pattern
public double Add(double firstNumber, double secondNumber)
{
    return firstNumber + secondNumber;
}

// Main loop pattern
while (true)
{
    // Display menu
    // Get operation choice
    // Execute operation
    // Display result
    // Check for exit condition
}
```

**Error Handling Pattern:**

Use `TryParse` methods rather than exception-based parsing to avoid performance overhead and maintain clean control flow:

```csharp
if (!double.TryParse(input, out double value))
{
    Console.WriteLine("Error: Please enter a valid number.");
    continue; // Return to input prompt
}
```

**Testing Pattern:**

Methods should be testable through unit tests. Separate calculation logic from I/O:

```csharp
// Testable - pure function
public double Add(double a, double b) => a + b;

// Not directly testable - contains I/O
public void RunAdditionOperation()
{
    Console.WriteLine("Enter first number:");
    // ... mixed logic and I/O
}
```

## Prior Orbit References

**Orbit History:**

This is **Orbit 1** in the Calculator trajectory, making it the foundational implementation with no prior calculator-specific orbits to reference.

**Existing Artifacts:**

The `.orbital/artifacts/` directory contains artifacts from previous orbits in other trajectories:
- `0dcc80ab-c006-4aac-86b3-9179b34ff76c/` — Complete orbit (intent, context, proposal, verification)
- `371de144-3ee1-4fba-b827-847507291483/` — Partial orbit (intent, context)
- `a74a8326-2d29-40ef-90ad-8cf6afce0a2a/` — Intent only
- `c784f284-f94a-4057-9d09-8582647ecd9a/` — Intent and context

These prior orbits appear unrelated to the calculator domain based on the current repository contents (Node.js property search API). However, they demonstrate the ORBITAL methodology workflow and artifact structure.

**Lessons for Foundation Pattern:**

As the first arithmetic operation, this implementation will establish:
- Numeric type choice (int/double/decimal) that subsequent operations must match
- Method signature pattern (parameters, return type, naming)
- Error handling approach (exceptions vs. return codes vs. TryParse pattern)
- Class structure (static methods vs. instance methods, single class vs. multiple classes)
- Console output formatting conventions

Any architectural decisions made here will constrain future operations (subtraction, multiplication, division) to maintain consistency.

## Risk Assessment

### Risk 1: Repository State Mismatch

**Description:** The repository contains Node.js code but the project metadata describes a C# calculator.

**Impact:** High — Implementation cannot proceed without clarifying the correct target repository or initializing C# project structure.

**Likelihood:** Confirmed — Observable in repository structure.

**Mitigation:**
- Verify with human reviewer whether this is the correct repository
- If correct, initialize C# project structure as first implementation step
- Document the initialization process for audit trail

### Risk 2: Numeric Type Selection

**Description:** Choosing between `double`, `decimal`, or `float` affects precision, performance, and overflow behavior for all future operations.

**Impact:** Medium — Wrong choice could require refactoring all arithmetic operations later.

**Likelihood:** Medium — First-time implementation without established pattern.

**Mitigation:**
- Use `double` as standard calculator type (balances precision and performance)
- Document rationale in code comments
- Ensure acceptance criteria tests cover edge cases (very large numbers, very small decimals)
- Reserve `decimal` for financial calculator variant if needed later

### Risk 3: Overflow Handling

**Description:** Adding extremely large numbers (approaching `double.MaxValue`) can produce `double.PositiveInfinity` rather than throwing an exception.

**Impact:** Low — Edge case unlikely in typical calculator usage.

**Likelihood:** Low — Requires intentional entry of numbers like 1.7E+308.

**Mitigation:**
- Check for `double.IsInfinity()` after calculation
- Display user-friendly error message if overflow detected
- Document this behavior in code comments
- Include overflow test case in verification protocol

### Risk 4: Floating-Point Precision Loss

**Description:** Binary floating-point representation can introduce rounding errors (e.g., 0.1 + 0.2 = 0.30000000000000004).

**Impact:** Low — Visible only in edge cases with many decimal places.

**Likelihood:** Medium — Common with floating-point arithmetic.

**Mitigation:**
- Format output with reasonable decimal places (e.g., `ToString("F10")`)
- Accept this as inherent floating-point behavior
- Document limitation if precision becomes critical for users
- Consider `decimal` type in future if financial accuracy is required

### Risk 5: Pattern Rigidity

**Description:** The architecture chosen for addition will constrain how subsequent operations (subtract, multiply, divide) must be implemented.

**Impact:** Medium — Inflexible initial design could require refactoring.

**Likelihood:** Medium — First implementation without full feature context.

**Mitigation:**
- Use instance methods on a `CalculatorEngine` class rather than static methods
- Design for extensibility with clear method naming (`Add`, `Subtract`, etc.)
- Keep calculation logic separate from input/output handling
- Review architecture in human supervision gate before finalizing pattern

### Risk 6: Input Validation Gaps

**Description:** Console input can include unexpected formats (whitespace, scientific notation, culture-specific number formats).

**Impact:** Low — Results in user-facing error, not system failure.

**Likelihood:** Medium — Users may enter unexpected formats.

**Mitigation:**
- Use `double.TryParse()` with `NumberStyles.Any` to handle various formats
- Trim whitespace from input before parsing
- Provide clear error messages guiding users to correct format
- Test with various input formats in verification phase

### Risk 7: Testing Absence

**Description:** Console applications with intertwined I/O and logic are difficult to unit test.

**Impact:** Medium — Reduces confidence in correctness and makes regression testing manual.

**Likelihood:** High — Without deliberate separation of concerns.

**Mitigation:**
- Separate pure calculation methods (testable) from I/O methods (manual testing)
- Structure code to enable unit testing of `Add(double, double)` method
- Include unit test project in proposal if not already present in repository
- Document test approach in verification protocol