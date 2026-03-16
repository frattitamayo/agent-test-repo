# Context Package: Addition Functionality for Console Calculator

## Codebase References

**Current Repository State**

The repository currently contains no C# project files. The existing structure shows:

- `.orbital/artifacts/` — ORBITAL methodology artifacts for prior trajectory work
- `README.md` — Project documentation (currently describes a Node.js property search API, not the calculator)
- `backend/api/properties/search.js` — Node.js API endpoint (unrelated to calculator project)
- `backend/database/queries/property-search.sql` — SQL query file (unrelated to calculator project)

**Required New Files**

Since this is the first orbit establishing the calculator foundation, the following C# project structure must be created:

- **Project root** — `.csproj` file defining the C# console application project
- **Program.cs** or **Main.cs** — Entry point containing `Main()` method for console application startup
- **Calculator.cs** or **Operations.cs** — Class file containing isolated addition logic
- **Optional: Properties/AssemblyInfo.cs** — Assembly metadata (if using .NET Framework conventions)

**Expected File Locations**

Standard C# console application structure suggests:
```
/Calculator/
  Calculator.csproj
  Program.cs
  Calculator.cs (or Operations/AdditionOperation.cs)
```

**Files to Modify**

- `README.md` — Must be updated to reflect the Calculator project purpose, removing Node.js references and adding C# build/run instructions

## Architecture Context

**Application Type**

Console application with synchronous, single-threaded execution model. No web server, no database, no external service dependencies. The application lifecycle is:

1. Start → Display prompt
2. Accept user input (first operand)
3. Accept user input (second operand)
4. Execute calculation
5. Display result
6. Exit (or loop for subsequent operations)

**Separation of Concerns**

The Intent Document specifies clean separation between three layers:

1. **Input/Output Layer** — Console interaction in `Program.cs`
   - Prompt display using `Console.WriteLine()`
   - Input capture using `Console.ReadLine()`
   - Result formatting and display
   - Error message presentation

2. **Calculation Layer** — Pure logic in separate class/method
   - Receives two numeric parameters
   - Returns numeric result
   - No console interaction within calculation methods
   - Enables unit testing without mocking console I/O

3. **Validation Layer** — Input parsing and validation
   - Convert string input to numeric types
   - Handle `FormatException` for non-numeric input
   - Validate range boundaries for data type limits

**Data Flow**

```
User Input (string) 
  → Parse/Validate (string → double/decimal)
  → Calculate (double/decimal → double/decimal)
  → Format (double/decimal → string)
  → Display (string → console)
```

**Technology Stack Decisions**

- **Target Framework:** .NET 6.0 or .NET 8.0 recommended (modern LTS versions with cross-platform support)
- **Numeric Type:** Use `decimal` for calculator operations to avoid floating-point precision issues common with `double`
- **Project Type:** Console Application template (`dotnet new console`)
- **No external dependencies** — Standard library only (System namespace)

**Extensibility Considerations**

This orbit establishes patterns for future operations (subtraction, multiplication, division):

- Each operation should be a separate method with consistent signature: `decimal OperationName(decimal a, decimal b)`
- Future orbits may introduce an operation selector menu before input prompts
- Consider interface `IOperation` or base class `CalculatorOperation` if operation selection logic is added later

## Pattern Library

**Project Structure Patterns**

Since this repository contains no existing C# code, establish these conventions:

- **Root-level project** — Place `.csproj` and source files at repository root or in `/Calculator` subdirectory
- **Single file per class** — Each class in its own `.cs` file with matching filename (e.g., `Calculator.cs` for `Calculator` class)
- **Namespace convention** — Use project name as root namespace: `namespace Calculator`

**Naming Conventions (C# Standard)**

- **Classes:** PascalCase (e.g., `Calculator`, `AdditionOperation`)
- **Methods:** PascalCase (e.g., `Add`, `ValidateInput`)
- **Parameters:** camelCase (e.g., `firstOperand`, `secondOperand`)
- **Local variables:** camelCase (e.g., `result`, `userInput`)
- **Constants:** PascalCase or UPPER_SNAKE_CASE (e.g., `MaxValue` or `MAX_VALUE`)

**Method Signature Pattern**

For calculation methods:
```csharp
public decimal Add(decimal firstOperand, decimal secondOperand)
{
    return firstOperand + secondOperand;
}
```

- Public access for testability
- Descriptive parameter names (not `a`, `b`, `x`, `y`)
- Return calculated value directly
- No side effects (console output, state mutation)

**Error Handling Pattern**

For input validation:
```csharp
if (!decimal.TryParse(input, out decimal value))
{
    Console.WriteLine("Invalid input. Please enter a numeric value.");
    // Handle retry logic or exit
}
```

- Use `TryParse` instead of `Parse` with exception handling for expected invalid input
- Provide clear, actionable error messages
- Do not crash on invalid input — guide user to correct behavior

**Console Interaction Pattern**

```csharp
Console.Write("Enter first number: ");
string input = Console.ReadLine();
```

- Use `Console.Write()` for prompts (no newline, input appears on same line)
- Use `Console.WriteLine()` for results and messages
- Use `Console.ReadLine()` for all input capture

## Prior Orbit References

**No Prior Calculator Orbits**

This is orbit #1 in the Calculator trajectory. The repository contains artifacts from unrelated prior work:

- `.orbital/artifacts/000dd429-4ac4-4901-875f-b285b5259e3c/` — Unknown prior orbit
- `.orbital/artifacts/0dcc80ab-c006-4aac-86b3-9179b34ff76c/` — Unknown prior orbit
- `.orbital/artifacts/371de144-3ee1-4fba-b827-847507291483/` — Incomplete orbit (no Proposal or Verification)
- `.orbital/artifacts/a74a8326-2d29-40ef-90ad-8cf6afce0a2a/` — Intent-only orbit
- `.orbital/artifacts/c784f284-f94a-4057-9d09-8582647ecd9a/` — Intent and Context only

These artifacts are not relevant to the calculator implementation but demonstrate the ORBITAL methodology is established in this repository.

**Learnings from Repository State**

The README currently describes a Node.js project, indicating:

1. The repository has been repurposed or the calculator is a new project in an existing repo
2. Documentation must be updated to reflect the current project
3. Unrelated files (`backend/api/properties/search.js`, `backend/database/queries/property-search.sql`) should be acknowledged but not modified

**Future Orbit Expectations**

Based on project description ("add, subtract, multiply and divide"), expect these subsequent orbits:

- Orbit #2: Subtraction functionality
- Orbit #3: Multiplication functionality
- Orbit #4: Division functionality (with divide-by-zero handling)
- Potential Orbit #5: Operation selection menu

Each should follow the architectural patterns established in this orbit.

## Risk Assessment

### Risk: Incorrect Project Initialization

**Description:** Creating C# project structure in wrong location or with incompatible .NET version.

**Likelihood:** Medium — No existing C# project structure to reference.

**Impact:** High — Prevents code execution, requires rework.

**Mitigation:**
- Use standard `dotnet new console` template for project creation
- Target .NET 6.0 or later (widely supported, cross-platform)
- Place project files at repository root for simplicity (matches flat structure of existing files)
- Verify project builds before implementing logic

### Risk: Data Type Selection Causes Precision Issues

**Description:** Using `double` instead of `decimal` introduces floating-point precision errors (e.g., 0.1 + 0.2 ≠ 0.3).

**Likelihood:** High if `double` is chosen — Floating-point arithmetic is inherently imprecise.

**Impact:** Medium — Violates acceptance criteria for functional correctness, especially for decimal addition.

**Mitigation:**
- Use `decimal` type for all calculator operations (128-bit precision, base-10 representation)
- Document this decision in code comments for future orbit implementers
- Accept that very large/small numbers may exceed `decimal` range (±7.9 × 10²⁸), but this is acceptable per Intent constraints

### Risk: Input Validation Gaps

**Description:** Not handling edge cases like empty strings, whitespace-only input, or overflow values.

**Likelihood:** Medium — Easy to overlook edge cases in first implementation.

**Impact:** Low-Medium — Application crash or poor user experience, but no data corruption risk.

**Mitigation:**
- Use `decimal.TryParse()` which handles most format errors gracefully
- Trim input strings before parsing: `input.Trim()`
- Test with boundary values (decimal.MaxValue, decimal.MinValue)
- Provide fallback for null input (should not occur with `Console.ReadLine()` but defensively handle)

### Risk: Poor Separation of Concerns

**Description:** Embedding console I/O logic inside calculation methods, preventing unit testing.

**Likelihood:** Medium — Common pattern for beginners or quick implementations.

**Impact:** High — Violates Intent constraint for testability, creates technical debt for future orbits.

**Mitigation:**
- Strictly enforce pattern: calculation methods receive parameters and return values only
- No `Console.ReadLine()` or `Console.WriteLine()` calls inside calculation class
- Code review must verify this separation before orbit completion

### Risk: Inconsistent Error Messages

**Description:** Error messages use technical jargon or don't guide user toward correct input format.

**Likelihood:** Low — Error handling is straightforward for this orbit.

**Impact:** Low — Poor user experience but functionally correct.

**Mitigation:**
- Use plain language: "Please enter a number" not "FormatException: Input string was not in a correct format"
- Provide examples in error messages: "Please enter a number (e.g., 5 or 3.14)"
- Test error messages with non-technical users if possible

### Risk: README Becomes Stale

**Description:** README.md still describes Node.js property search after calculator implementation.

**Likelihood:** High — README modification is not explicit in Intent scope.

**Impact:** Low — Documentation drift confuses future developers but doesn't affect functionality.

**Mitigation:**
- Include README update in Proposal Record as explicit deliverable
- Document how to build and run the C# console app
- Remove or archive references to unrelated Node.js code

### Risk: No Build/Test Infrastructure

**Description:** No way to verify code compiles without manual developer intervention.

**Likelihood:** High — First orbit typically doesn't include CI/CD setup.

**Impact:** Medium — Verification Protocol manual steps become bottleneck, no automated regression detection.

**Mitigation:**
- Accept manual verification for this orbit (Tier 2 supervised)
- Document build commands in README for human reviewer
- Flag need for CI/CD setup in future trajectory planning (not in this orbit scope)

### Risk: Naming Conflicts with Future Operations

**Description:** Choosing method names or class names that conflict with subsequent operations or standard library.

**Likelihood:** Low — Simple operation names unlikely to conflict.

**Impact:** Low — Requires refactoring in later orbits.

**Mitigation:**
- Use descriptive, specific names: `Add()` not `Calculate()`
- Avoid generic class names: `Calculator` is acceptable but `Program` or `Math` risk conflicts
- Reserve operation-specific names for their respective methods