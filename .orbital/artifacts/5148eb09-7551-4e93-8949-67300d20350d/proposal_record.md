# Proposal Record: Addition Functionality for Calculator

## Interpreted Intent

This orbit establishes the foundational Calculator console application in C# with addition operation capability. Users will launch the application, receive clear prompts to enter two numbers, and see the formatted sum displayed. The application will handle invalid input gracefully by re-prompting rather than crashing, and will support consecutive calculations in a single session.

The implementation must prioritize:

1. **Clean architecture foundation** — This is orbit 1, establishing patterns for future operations. Method organization, input validation, and error handling patterns defined here will be replicated in subtraction, multiplication, and division orbits.

2. **User clarity** — Console prompts must eliminate ambiguity about what input is expected and what operation is being performed. Error messages must guide users toward correct input format.

3. **Testability** — Addition logic must be isolated in a dedicated method, not embedded in Main, to enable future unit testing without console I/O coupling.

4. **Robustness** — The application must handle all input edge cases (empty strings, non-numeric text, overflow conditions, special characters) without crashing.

The desired outcome is achieved when a user can successfully add two numbers, see the formatted result, optionally perform additional calculations, and exit cleanly — all without encountering crashes or unclear error states.

## Implementation Plan

### Phase 1: Project Structure Creation

**Decision: Root-Level Project Structure**

Given the repository currently contains unrelated Node.js backend code and the Calculator project is described as a distinct console application, I propose creating the C# project at the repository root level with clear naming to avoid confusion:

**Files to Create:**

1. **`Calculator.csproj`** (Repository root)
   - .NET 6 target framework (modern, cross-platform, long-term support)
   - Console application output type
   - Nullable reference types disabled to avoid warnings in simple console app
   - C# 10 language version

2. **`Program.cs`** (Repository root)
   - Main entry point with namespace `Calculator`
   - Contains Main method and helper methods
   - Implements full addition operation flow

**Rationale:** Root-level placement keeps the C# project separate from the existing `backend/` Node.js structure. Using `Calculator.csproj` (not generic `ConsoleApp.csproj`) makes the project purpose explicit. This structure allows future expansion — additional orbits can add new `.cs` files alongside Program.cs if needed (e.g., `Operations.cs` for shared operation methods).

### Phase 2: Core Implementation

#### File: `Calculator.csproj`

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net6.0</TargetFramework>
    <Nullable>disable</Nullable>
    <LangVersion>10.0</LangVersion>
    <RootNamespace>Calculator</RootNamespace>
  </PropertyGroup>
</Project>
```

**Key Decisions:**
- `net6.0` provides balance between modern features and broad compatibility
- `Nullable>disable` prevents warnings about non-nullable reference types in simple console I/O
- `LangVersion>10.0` enables top-level statements if desired in future refactoring

#### File: `Program.cs`

**Architecture:**

```
Main() 
├─ DisplayWelcome()
├─ Loop: RunCalculation()
│   ├─ GetNumberFromUser(prompt) → double
│   │   └─ ValidateAndParse(input) → (bool success, double value)
│   ├─ Add(a, b) → double
│   ├─ ValidateResult(result) → bool
│   └─ DisplayResult(a, b, sum)
└─ Exit message
```

**Method Breakdown:**

| Method | Responsibility | Return Type | Intent Alignment |
|--------|---------------|-------------|------------------|
| `Main` | Application entry, orchestration loop | void | Top-level flow control |
| `GetNumberFromUser` | Prompt and retrieve validated numeric input | double | Constraint: "reject non-numeric input gracefully" |
| `ValidateAndParse` | Parse string to double with culture handling | (bool, double) | Constraint: "validate all user input" |
| `Add` | Perform addition arithmetic | double | Core business logic, testable method |
| `ValidateResult` | Check for infinity/overflow | bool | Acceptance: "detect overflow and display error message" |
| `DisplayResult` | Format and output result | void | Acceptance: "formatted with operator display" |
| `DisplayWelcome` | Initial instructions | void | User clarity |

**Full Implementation:**

```csharp
using System;
using System.Globalization;

namespace Calculator
{
    class Program
    {
        static void Main(string[] args)
        {
            DisplayWelcome();
            
            bool continueCalculating = true;
            while (continueCalculating)
            {
                RunAdditionCalculation();
                
                Console.WriteLine();
                Console.Write("Perform another addition? (y/n): ");
                string response = Console.ReadLine()?.Trim().ToLower();
                continueCalculating = (response == "y" || response == "yes");
            }
            
            Console.WriteLine("
Thank you for using Calculator. Goodbye!");
        }
        
        static void DisplayWelcome()
        {
            Console.WriteLine("=================================");
            Console.WriteLine("      Calculator - Addition      ");
            Console.WriteLine("=================================");
            Console.WriteLine();
        }
        
        static void RunAdditionCalculation()
        {
            double firstNumber = GetNumberFromUser("Enter the first number: ");
            double secondNumber = GetNumberFromUser("Enter the second number: ");
            
            double sum = Add(firstNumber, secondNumber);
            
            if (ValidateResult(sum))
            {
                DisplayResult(firstNumber, secondNumber, sum);
            }
            else
            {
                Console.WriteLine("Error: The result is too large to display (overflow detected).");
                Console.WriteLine("Please try smaller numbers.");
            }
        }
        
        static double GetNumberFromUser(string prompt)
        {
            while (true)
            {
                Console.Write(prompt);
                string input = Console.ReadLine();
                
                var (success, value) = ValidateAndParse(input);
                
                if (success)
                {
                    return value;
                }
                
                Console.WriteLine("Invalid input. Please enter a numeric value (e.g., 42 or 3.14).");
                Console.WriteLine();
            }
        }
        
        static (bool success, double value) ValidateAndParse(string input)
        {
            if (string.IsNullOrWhiteSpace(input))
            {
                return (false, 0);
            }
            
            bool parsed = double.TryParse(
                input, 
                NumberStyles.Any, 
                CultureInfo.InvariantCulture, 
                out double result
            );
            
            return (parsed, result);
        }
        
        static double Add(double a, double b)
        {
            return a + b;
        }
        
        static bool ValidateResult(double result)
        {
            return !double.IsInfinity(result) && !double.IsNaN(result);
        }
        
        static void DisplayResult(double a, double b, double sum)
        {
            Console.WriteLine();
            Console.WriteLine($"{a} + {b} = {sum}");
        }
    }
}
```

**Design Decisions:**

1. **Continuous Loop Pattern** — Implements "perform another calculation?" prompt after each result, satisfying the acceptance criterion of "10 consecutive operations without restart" while providing natural exit point.

2. **Infinite Retry on Invalid Input** — `GetNumberFromUser` loops indefinitely on validation failure with clear error guidance. Aligns with Intent constraint: "user can retry." No artificial retry limits that could frustrate users.

3. **Culture-Invariant Parsing** — Uses `CultureInfo.InvariantCulture` to prevent culture-specific decimal separator confusion (e.g., comma vs. period). Ensures consistent behavior across different system locales.

4. **Tuple Return for Validation** — `ValidateAndParse` returns `(bool success, double value)` tuple, enabling clean separation of validation logic from control flow. More maintainable than out parameters.

5. **Dedicated Add Method** — Addition logic isolated in `Add(double a, double b)` method, satisfying Intent requirement: "Addition logic is implemented in a dedicated, testable method (not inline in Main)." This method can be unit tested without console I/O mocking.

6. **Overflow Detection** — `ValidateResult` checks for `double.IsInfinity()` and `double.IsNaN()`, catching overflow conditions per Intent acceptance criteria. Provides specific error message with user guidance.

7. **Formatted Output** — `DisplayResult` outputs `"5 + 3 = 8"` format, meeting target acceptance criterion for "formatted with operator display."

### Phase 3: Documentation

**Update `README.md`** — Add Calculator project section:

```markdown
## Calculator Project

A console-based calculator application written in C#.

### Running the Calculator

1. Ensure .NET 6 SDK is installed
2. From the repository root, run:
   ```bash
   dotnet run --project Calculator.csproj
   ```
3. Follow the on-screen prompts to perform addition operations

### Current Features
- Addition of two numbers (integers and decimals)
- Input validation with error recovery
- Consecutive calculations in single session
```

This addition preserves existing Node.js backend documentation while adding Calculator instructions. It does not remove or modify the existing content, respecting the Context Package directive to "preserve existing backend/ structure."

### Phase 4: Verification Preparation

Create basic manual test cases document (optional, aids human review):

**`TESTING.md`** (Repository root)

```markdown
# Calculator Testing Guide

## Manual Test Cases for Addition

### Test Case 1: Basic Integer Addition
- Input: 5, 3
- Expected: "5 + 3 = 8"

### Test Case 2: Decimal Addition
- Input: 2.5, 3.7
- Expected: "2.5 + 3.7 = 6.2"

### Test Case 3: Negative Numbers
- Input: -5, 3
- Expected: "-5 + 3 = -2"

### Test Case 4: Invalid Input Recovery
- Input: "abc", then "5"
- Expected: Error message, re-prompt, then accept "5"

### Test Case 5: Overflow Detection
- Input: 1.7e308, 1.7e308
- Expected: Overflow error message

### Test Case 6: Consecutive Operations
- Perform 3 additions in sequence
- Expected: No crashes, clean loop flow
```

### Implementation Order

1. Create `Calculator.csproj` with project configuration
2. Create `Program.cs` with full implementation
3. Update `README.md` with Calculator instructions
4. Optionally create `TESTING.md` for manual verification guidance
5. Compile and execute initial smoke test: `dotnet run`
6. Execute manual test cases from `TESTING.md`

**Estimated Duration:** 1 orbit (this orbit) — all implementation occurs in a single cohesive unit of work.

## Risk Surface

### Critical Risks

#### Risk 1: Project File Placement Collision

**Description:** Creating root-level C# project files could conflict with existing repository structure expectations or CI/CD assumptions.

**Likelihood:** Low  
**Impact:** Medium (requires restructuring if incorrect)

**Mitigation:**
- Proposal explicitly documents the root-level placement decision for human review
- No modification to existing `backend/` directory — coexistence is maintained
- If human reviewer prefers different structure (e.g., `src/Calculator/`), the `.csproj` and `.cs` files can be relocated without code changes

**Residual Risk:** Human reviewer may require restructuring, but this is a quick fix (move files, update namespace if needed).

#### Risk 2: Double Precision Edge Cases

**Description:** `double` type has precision limitations. Adding very large and very small numbers can lose precision (e.g., `1e20 + 0.1` may not preserve `0.1`).

**Likelihood:** Low (uncommon input patterns)  
**Impact:** Low (cosmetic inaccuracy, not a crash)

**Mitigation:**
- This is an inherent limitation of IEEE 754 double-precision arithmetic
- Intent Document specifies "double precision" as target — precision trade-offs are accepted
- User documentation does not claim arbitrary precision
- If future orbits require higher precision (e.g., financial calculations), refactor to `decimal` type

**Residual Risk:** Users with extreme precision requirements may notice rounding artifacts. Acceptable for general calculator use case.

#### Risk 3: Culture-Specific Input Parsing

**Description:** Despite using `CultureInfo.InvariantCulture`, users may be confused if their system locale uses comma as decimal separator and they input "3,5" (which will fail validation).

**Likelihood:** Medium (depends on user locale)  
**Impact:** Low (error message guides retry)

**Mitigation:**
- Error message provides example: "e.g., 42 or 3.14" using period separator
- Invariant culture parsing is consistent — same behavior on all systems
- Users receive immediate feedback and can adjust input format

**Residual Risk:** Minor UX friction for users in comma-decimal locales. Could be addressed in future orbit by detecting system locale and adjusting examples, but not in scope for orbit 1.

### Moderate Risks

#### Risk 4: Infinite Loop on Non-Interactive Execution

**Description:** If the application is executed in a non-interactive context (e.g., piped input, automated script), `Console.ReadLine()` could return null repeatedly, causing infinite loop.

**Likelihood:** Very Low (console apps are typically interactive)  
**Impact:** Medium (application hangs)

**Mitigation:**
- Check for null return from `Console.ReadLine()` in `GetNumberFromUser`
- Exit gracefully if EOF detected (null return)
- Add null-coalescing to prevent NullReferenceException: `string input = Console.ReadLine() ?? string.Empty;`

**Updated Implementation Adjustment:**

```csharp
static double GetNumberFromUser(string prompt)
{
    while (true)
    {
        Console.Write(prompt);
        string input = Console.ReadLine();
        
        if (input == null)
        {
            Console.WriteLine("
End of input detected. Exiting.");
            Environment.Exit(0);
        }
        
        var (success, value) = ValidateAndParse(input);
        
        if (success)
        {
            return value;
        }
        
        Console.WriteLine("Invalid input. Please enter a numeric value (e.g., 42 or 3.14).");
        Console.WriteLine();
    }
}
```

**Residual Risk:** Minimal after adjustment.

#### Risk 5: Console Output Buffer Overflow

**Description:** If console output buffer is redirected to a file or pipe with limited capacity, excessive output could cause blocking or errors.

**Likelihood:** Very Low  
**Impact:** Low (rare execution context)

**Mitigation:**
- Application output is minimal (prompts, results, errors)
- No logging loops or verbose debug output
- Standard console buffer sizes are more than sufficient

**Residual Risk:** Negligible.

### Low Risks

#### Risk 6: Memory Constraint Violation

**Description:** Intent specifies 50MB memory footprint limit. Simple console app with no collections or large data structures should easily stay under this limit.

**Likelihood:** Very Low  
**Impact:** Low (would indicate implementation error)

**Mitigation:**
- No heap allocations beyond string formatting and console buffer
- Stack-only execution for arithmetic operations
- Can be verified with performance profiling tools if needed

**Residual Risk:** Effectively zero. Baseline .NET console app uses ~10-20MB.

#### Risk 7: Compilation Warnings

**Description:** C# compiler warnings (unused variables, nullability, etc.) could appear and violate Intent acceptance criteria.

**Likelihood:** Very Low (implementation is clean)  
**Impact:** Very Low (cosmetic issue)

**Mitigation:**
- `Nullable>disable` in csproj eliminates most common warnings in simple console apps
- All variables in proposed implementation are used
- No deprecated API calls
- Can run `dotnet build -warnaserror` during verification to enforce zero warnings

**Residual Risk:** Minimal.

### Security Considerations

**Console Input Injection:** The proposed implementation uses:
- `double.TryParse` which safely handles all string input without code execution risk
- No `eval()`, dynamic compilation, or reflection based on user input
- No file system access, network calls, or process execution
- No string interpolation of user input into commands

**Assessment:** Security risk is negligible. The attack surface is limited to causing parsing failures (already handled) or providing extreme numeric values (overflow detection catches this).

## Scope Estimate

### Complexity Assessment

**Overall Complexity:** Low

**Breakdown:**

| Component | Complexity | Rationale |
|-----------|-----------|-----------|
| Project setup | Trivial | Standard .NET console project, no custom configuration |
| Input validation | Low | Well-established TryParse pattern, straightforward error handling |
| Addition logic | Trivial | Single arithmetic operation |
| Output formatting | Trivial | String interpolation, no complex formatting rules |
| Loop/flow control | Low | Simple while loop with boolean flag |
| Error handling | Low | Overflow check and graceful retry logic |

**Technical Debt Risk:** Very Low — This implementation establishes clean patterns that future orbits can replicate. No shortcuts or hacks are introduced.

### Work Phases

**Single Orbit Implementation:**

This proposal completes in **1 orbit** (the current orbit) with the following phases executed sequentially:

1. **Setup Phase** (5 minutes estimated)
   - Create `Calculator.csproj`
   - Initial file structure

2. **Core Implementation Phase** (15 minutes estimated)
   - Implement `Program.cs` with all methods
   - Write welcome message and prompts

3. **Refinement Phase** (10 minutes estimated)
   - Add overflow detection
   - Refine error messages
   - Add null-check for non-interactive execution

4. **Documentation Phase** (5 minutes estimated)
   - Update `README.md`
   - Create optional `TESTING.md`

5. **Verification Phase** (10 minutes estimated)
   - Compile with `dotnet build`
   - Execute smoke test
   - Run manual test cases

**Total Estimated Effort:** 45 minutes of focused implementation time

**Orbit Count:** 1 (this orbit completes all addition functionality)

### Future Orbit Considerations

Subsequent orbits (subtraction, multiplication, division) will benefit from the patterns established here:

- **Orbit 2 (Subtraction):** Reuse `GetNumberFromUser`, add `Subtract` method, similar flow
- **Orbit 3 (Multiplication):** Reuse input patterns, add `Multiply` method
- **Orbit 4 (Division):** Reuse patterns, add `Divide` method with zero-division handling

**Estimated future orbit complexity:** Each ~30 minutes (faster due to pattern reuse)

### Scope Boundaries

**In Scope for This Orbit:**
- Addition operation only
- Console I/O with input validation
- Overflow detection and error handling
- Consecutive calculation loop
- Basic documentation

**Explicitly Out of Scope:**
- Other arithmetic operations (deferred to future orbits)
- Unit test framework (not required by Intent, can be added in future orbit)
- Calculation history/memory features
- Configuration files or settings
- GUI or web interface

## Human Modifications

Pending human review.