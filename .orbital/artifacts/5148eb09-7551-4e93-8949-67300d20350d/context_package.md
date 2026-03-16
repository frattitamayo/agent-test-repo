# Context Package: Addition Functionality for Calculator

## Codebase References

### Current Repository State

The repository at `frattitamayo/agent-test-repo` currently contains:

**Existing Structure:**
```
README.md
backend/api/properties/search.js
backend/database/queries/property-search.sql
.orbital/artifacts/[multiple artifact directories]
```

**Critical Observation:** The repository currently contains a Node.js backend structure (`backend/api/properties/search.js`) with property search functionality. However, the Calculator project described in the entity context (C# console application) does not yet have any source code files present in the repository structure.

### Expected Codebase Location

Based on C# console application conventions, the Calculator project files should be created at:

- **Primary Entry Point:** `Calculator/Program.cs` or `src/Calculator/Program.cs` or root-level `Program.cs`
- **Project File:** `Calculator/Calculator.csproj` or `Calculator.csproj`
- **Optional Structure:** `Calculator/Operations/` directory for operation method classes

### Files to Create

| File Path | Purpose | Intent Alignment |
|-----------|---------|------------------|
| `Program.cs` or `Calculator/Program.cs` | Console application entry point with Main method | Implements console interaction flow and addition operation invocation |
| `Calculator.csproj` | .NET project configuration | Defines target framework (.NET 6+ or .NET Framework 4.8) and compilation settings |
| `Operations/Addition.cs` (optional) | Dedicated addition logic class | Implements testable addition method as required by acceptance criteria |

### Files to Preserve

The existing `backend/` directory structure (Node.js property search API) is unrelated to the Calculator project and must not be modified or removed. This suggests the repository may host multiple unrelated projects or is being repurposed for the Calculator trajectory.

## Architecture Context

### Application Architecture

**Pattern:** Single-executable console application with synchronous execution flow

**Expected Data Flow:**
1. Application starts → Display welcome/instruction message
2. Prompt user for first number → Read console input → Validate
3. Prompt user for second number → Read console input → Validate
4. Invoke addition operation method
5. Display formatted result
6. Optional: Loop for additional calculations or exit

**Service Boundaries:**
- **No service boundaries** — This is a standalone console application with no network communication, database access, or inter-process communication
- All functionality executes within a single process lifecycle
- Standard input/output streams are the only external interfaces

### Infrastructure Constraints

**Runtime Environment:**
- Must execute on any system with .NET Runtime installed (.NET 6+ recommended, .NET Framework 4.8 as minimum fallback)
- No web server, database server, or container orchestration required
- Execution via `dotnet run` or compiled `.exe` invocation

**Memory Model:**
- Stack-based execution for method calls (addition operation)
- Minimal heap allocation — only for string formatting and console buffer management
- No persistent state between executions

**Concurrency Model:**
- Single-threaded synchronous execution
- No async/await patterns required
- No thread-safety concerns for this orbit

### Integration Points

**None.** This orbit introduces the first functional code for the Calculator project. There are no existing integration points, APIs, or shared libraries to interface with.

## Pattern Library

### Established Patterns

**Repository Pattern Observation:**
The existing Node.js backend uses:
- Modular file organization (`backend/api/properties/`, `backend/database/queries/`)
- Separation of concerns (API routes separate from database queries)

**Recommended C# Console Application Patterns:**

#### Input Validation Pattern
```csharp
// Standard .NET pattern for parsing numeric input
if (double.TryParse(input, out double number))
{
    // Valid number
}
else
{
    // Invalid input - display error and retry
}
```

#### Method Organization Pattern
```csharp
// Separation of concerns: Main handles I/O, methods handle logic
static double Add(double a, double b)
{
    return a + b;
}
```

#### Error Handling Pattern
```csharp
// Graceful validation without throwing exceptions for user input errors
// Reserve exceptions for unexpected system failures
```

### Naming Conventions

Based on C# and .NET conventions (not established in this repository yet, but standard practice):

- **Namespace:** `Calculator` or `CalculatorApp`
- **Class Names:** PascalCase (`Program`, `Addition`)
- **Method Names:** PascalCase (`Add`, `GetNumberFromUser`, `DisplayResult`)
- **Variable Names:** camelCase (`firstNumber`, `secondNumber`, `sum`)
- **Constants:** PascalCase or UPPER_SNAKE_CASE depending on team preference

### Component Standards

**Console Output Standards:**
- Clear prompts with input format examples: `"Enter the first number: "`
- Formatted results with operation display: `"5 + 3 = 8"`
- Error messages that specify the problem: `"Invalid input. Please enter a numeric value."`
- Consistent spacing and readability

**Code Organization Standards:**
- Main method should be concise — delegate logic to helper methods
- Each method should have a single, clear responsibility
- Input validation should occur before business logic execution
- Magic numbers should be avoided (use named constants if needed)

## Prior Orbit References

### Orbit History

**This is Orbit 1** — No prior orbits exist for the Calculator trajectory.

### Trajectory Context

The Calculator trajectory is in its inception phase. This orbit establishes:
- The foundational project structure (csproj file, Program.cs)
- The input/output interaction pattern for console operations
- The architectural pattern for implementing arithmetic operations
- The error handling strategy for invalid user input

**Future Orbit Implications:**
Subsequent orbits for subtraction, multiplication, and division will likely:
- Reuse the input validation pattern established here
- Follow the same method organization structure
- Extend from the console interaction flow created in this orbit
- Potentially refactor toward an operation interface or base class if the pattern proves consistent

### Lessons from Repository Structure

The existing Node.js backend demonstrates modular organization (`backend/api/`, `backend/database/`). While the Calculator project is unrelated, this suggests the team values:
- Clear separation of concerns
- Descriptive directory naming
- Logical file organization

The Calculator project should adopt similar organizational clarity, even at a smaller scale.

## Risk Assessment

### High-Risk Areas

#### 1. Project Structure Ambiguity

**Risk:** The repository currently contains Node.js backend code but no C# project files. Creating the Calculator project without clarifying the intended directory structure could lead to conflicts or organizational confusion.

**Impact:** Medium — Incorrect file placement could require rework and confuse future contributors

**Mitigation:**
- Create a dedicated `Calculator/` or `src/Calculator/` directory to isolate C# project files
- Alternatively, use root-level files if this repository will be repurposed exclusively for the Calculator project
- Document the structure decision in the Proposal Record for human review

#### 2. Numeric Type Selection

**Risk:** Choosing between `double`, `decimal`, `float`, or `int` for addition operations affects precision, range, and performance. The Intent Document specifies "integers and decimals" without mandating a specific type.

**Impact:** Medium — Wrong type selection could cause precision loss (financial calculations) or overflow issues

**Mitigation:**
- Use `double` as the target type per Intent acceptance criteria (double precision)
- `double` provides sufficient range (±5.0 × 10^−324 to ±1.7 × 10^308) and precision for general calculator use
- Avoid `decimal` unless financial precision is explicitly required (not specified in Intent)
- Avoid `float` due to lower precision than `double`

#### 3. Input Validation Bypass

**Risk:** Console input validation using `double.TryParse` could allow malformed input that parses unexpectedly (e.g., scientific notation, culture-specific decimal separators).

**Impact:** Low — Unlikely to cause crashes, but could confuse users with unexpected behavior

**Mitigation:**
- Use invariant culture for parsing: `double.TryParse(input, NumberStyles.Any, CultureInfo.InvariantCulture, out double number)`
- Provide clear input format examples in prompts
- Test with edge cases: empty strings, whitespace, special characters, very large numbers

#### 4. Overflow Handling Gap

**Risk:** Addition of two very large `double` values could result in `double.PositiveInfinity` or `double.NegativeInfinity` without explicit detection.

**Impact:** Low — Rare in normal use, but violates Intent requirement to "detect overflow and display error message"

**Mitigation:**
- Check result for `double.IsInfinity()` after addition operation
- Display clear error message if overflow detected
- Suggest valid input ranges to user

### Medium-Risk Areas

#### 5. Console Application Loop Logic

**Risk:** The Intent Document does not specify whether the calculator should support multiple consecutive operations or exit after one calculation. Implementing the wrong flow requires rework.

**Impact:** Low — Easy to modify, but wastes effort if incorrect assumption is made

**Mitigation:**
- Implement a simple loop that asks "Perform another calculation? (y/n)" after displaying result
- Aligns with Intent acceptance criteria: "Application can execute at least 10 consecutive addition operations without restart"
- Present this design decision explicitly in Proposal Record for review

#### 6. Error Recovery Strategy

**Risk:** If input validation fails, the application could either (a) re-prompt indefinitely, (b) re-prompt with attempt limit, or (c) exit immediately. The Intent specifies "user can retry" but not the retry mechanics.

**Impact:** Low — Affects user experience but not functional correctness

**Mitigation:**
- Implement unlimited retry with clear error messages (most user-friendly)
- Provide exit instruction: "Enter 'q' to quit" in prompts
- Document the retry strategy in Proposal Record

### Low-Risk Areas

#### 7. Performance Overhead

**Risk:** The Intent specifies sub-1ms addition operation performance. Console I/O operations (ReadLine, WriteLine) will far exceed this, potentially creating confusion about what is being measured.

**Impact:** Very Low — Addition arithmetic will always complete in nanoseconds; I/O latency is unavoidable and expected

**Mitigation:**
- Measure only the addition operation itself (stopwatch around `a + b` expression) if performance verification is required
- Clarify in Verification Protocol that the 1ms constraint applies to arithmetic, not I/O
- This performance requirement is trivially satisfied and unlikely to be a real concern

#### 8. Code Compilation Warnings

**Risk:** Unused variables, missing XML documentation, or nullable reference warnings could appear depending on C# language version and project settings.

**Impact:** Very Low — Does not affect runtime behavior, but violates Intent acceptance criteria: "compiles without warnings"

**Mitigation:**
- Use C# 10+ with nullable reference types disabled initially (add `<Nullable>disable</Nullable>` to csproj)
- Ensure all variables are used or explicitly ignored
- Run `dotnet build` with `-warnaserror` flag during verification to catch all warnings

### Security Considerations

**Console Input Injection:** While console applications have limited injection attack surface compared to web applications, malicious input could theoretically:
- Cause unexpected parsing behavior (mitigated by TryParse validation)
- Trigger resource exhaustion via very long input strings (mitigated by ReadLine behavior and memory constraints)

**No Elevated Risk:** The Intent correctly identifies that input validation is required. The proposed `double.TryParse` approach with proper error handling addresses this concern adequately. No file system access, network calls, or external process invocation occurs in this orbit, minimizing security surface area.