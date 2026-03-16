# Proposal Record: Addition Functionality for Console Calculator

## Interpreted Intent

This orbit establishes the foundational calculator implementation by creating a C# console application capable of performing addition operations on two numeric inputs. The implementation must demonstrate clean architectural separation between user interaction, input validation, and calculation logic to serve as a pattern for subsequent arithmetic operations (subtraction, multiplication, division).

The core requirement is **testable addition logic** isolated from console I/O, allowing unit tests to verify mathematical correctness without mocking user input. The application will prompt users for two numbers, validate input, perform addition using C#'s native arithmetic operators, and display results in a human-readable format.

This is not merely "build a calculator" — it is establishing **architectural conventions** for the entire Calculator trajectory. Decisions made here regarding project structure, naming patterns, error handling, and separation of concerns will be replicated in future orbits. The implementation must balance simplicity (it's just addition) with extensibility (future operations will follow this pattern).

Key clarifications:
- **No operation selection menu in this orbit** — the application performs addition only
- **Decimal precision is prioritized** — use `decimal` type to avoid floating-point errors
- **Graceful error handling is required** — invalid input should not crash the application
- **Documentation must be updated** — README currently describes unrelated Node.js project

## Implementation Plan

### Phase 1: Project Initialization

**Create C# Console Application Structure**

Location: Repository root (matching flat structure of existing files)

**Files to create:**
- `Calculator.csproj` — Project definition file
- `Program.cs` — Application entry point with console I/O
- `Calculator.cs` — Pure calculation logic
- `.gitignore` — Standard .NET exclusions (bin/, obj/, etc.)

**Project file structure (`Calculator.csproj`):**
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
```

Rationale for .NET 8.0:
- Latest LTS version (November 2023 release, supported until November 2026)
- Cross-platform compatibility (Windows, macOS, Linux)
- Modern C# 12 language features available
- Implicit usings reduce boilerplate (System namespace automatically available)

### Phase 2: Implement Calculation Logic

**File: `Calculator.cs`**

Create isolated calculation class with single responsibility: perform arithmetic operations.

```csharp
namespace Calculator
{
    public class Calculator
    {
        /// <summary>
        /// Adds two decimal numbers and returns their sum.
        /// </summary>
        /// <param name="firstOperand">The first number to add</param>
        /// <param name="secondOperand">The second number to add</param>
        /// <returns>The sum of firstOperand and secondOperand</returns>
        public decimal Add(decimal firstOperand, decimal secondOperand)
        {
            return firstOperand + secondOperand;
        }
    }
}
```

**Key design decisions:**

1. **Public class and method** — Enables unit testing from external test projects
2. **Decimal type** — Prevents floating-point precision errors (0.1 + 0.2 = 0.3 exactly)
3. **Descriptive parameter names** — `firstOperand`/`secondOperand` instead of `a`/`b` for clarity
4. **XML documentation comments** — Establishes documentation pattern for future methods
5. **No console interaction** — Pure function with no side effects
6. **Simple implementation** — Direct return of addition result, no unnecessary complexity

**Type selection justification:**

| Type | Range | Precision | Use Case |
|------|-------|-----------|----------|
| `int` | ±2.1 billion | Integer only | Too limited for calculator |
| `double` | ±1.7 × 10³⁰⁸ | 15-16 digits | Floating-point errors unacceptable |
| `decimal` | ±7.9 × 10²⁸ | 28-29 digits | **Chosen** — Base-10 precision for arithmetic |

### Phase 3: Implement User Interface

**File: `Program.cs`**

Console application entry point handling user interaction and orchestration.

```csharp
namespace Calculator
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("Calculator - Addition");
            Console.WriteLine("=====================
");

            var calculator = new Calculator();
            
            // Get first operand
            decimal firstNumber = GetNumberFromUser("Enter the first number: ");
            
            // Get second operand
            decimal secondNumber = GetNumberFromUser("Enter the second number: ");
            
            // Perform calculation
            decimal result = calculator.Add(firstNumber, secondNumber);
            
            // Display result
            Console.WriteLine($"
Result: {firstNumber} + {secondNumber} = {result}");
            
            Console.WriteLine("
Press any key to exit...");
            Console.ReadKey();
        }

        /// <summary>
        /// Prompts the user for numeric input and validates the response.
        /// Retries until valid input is provided.
        /// </summary>
        /// <param name="prompt">The message to display to the user</param>
        /// <returns>A valid decimal number entered by the user</returns>
        static decimal GetNumberFromUser(string prompt)
        {
            while (true)
            {
                Console.Write(prompt);
                string? input = Console.ReadLine();
                
                // Handle null input (shouldn't occur with ReadLine but defensive)
                if (input == null)
                {
                    Console.WriteLine("No input received. Please try again.
");
                    continue;
                }
                
                // Trim whitespace and attempt to parse
                if (decimal.TryParse(input.Trim(), out decimal number))
                {
                    return number;
                }
                
                // Invalid input - provide helpful error message
                Console.WriteLine("Invalid input. Please enter a valid number (e.g., 5 or 3.14).
");
            }
        }
    }
}
```

**Key design decisions:**

1. **Extraction method pattern** — `GetNumberFromUser()` handles validation logic separately from main flow
2. **Infinite retry loop** — User cannot proceed without valid input (no crash, no silent failure)
3. **TryParse validation** — Idiomatic C# pattern for safe type conversion without exceptions
4. **Trim whitespace** — Handles " 5 " as valid input (common user behavior)
5. **Contextual output** — Result shows full equation "5 + 3 = 8" not just "8"
6. **Pause before exit** — `Console.ReadKey()` prevents window from closing immediately in some environments
7. **Nullable annotations** — `string?` acknowledges that `ReadLine()` can theoretically return null

**Data flow:**
```
Main() 
  → GetNumberFromUser() → Console.Write() → Console.ReadLine() → TryParse() → return decimal
  → GetNumberFromUser() → [same process]
  → calculator.Add()
  → Console.WriteLine()
```

### Phase 4: Update Documentation

**File: `README.md`**

Replace existing Node.js content with calculator documentation.

```markdown
# Calculator

A simple console calculator application written in C# that performs basic arithmetic operations.

## Current Features

- **Addition**: Add two numbers with decimal precision

## Requirements

- .NET 8.0 SDK or later
- Any operating system supported by .NET (Windows, macOS, Linux)

## Building the Project

From the repository root:

```bash
dotnet build
```

## Running the Calculator

From the repository root:

```bash
dotnet run
```

The application will prompt you to enter two numbers and display their sum.

## Example Usage

```
Calculator - Addition
=====================

Enter the first number: 10.5
Enter the second number: 3.7

Result: 10.5 + 3.7 = 14.2

Press any key to exit...
```

## Project Structure

- `Calculator.csproj` - Project configuration file
- `Program.cs` - Console application entry point and user interaction
- `Calculator.cs` - Core calculation logic (testable without UI dependencies)

## Future Development

Planned features in upcoming orbits:
- Subtraction
- Multiplication
- Division
- Operation selection menu

## Architecture Notes

The calculator follows a separation of concerns pattern:
- **UI Layer** (`Program.cs`): Handles console input/output and user prompts
- **Logic Layer** (`Calculator.cs`): Pure calculation methods with no I/O dependencies

This separation enables unit testing of calculation logic without mocking console interactions.
```

**Changes from existing README:**
- Remove all Node.js references (`node backend/api/properties/search.js`)
- Remove property search documentation
- Add C# build and run instructions
- Document current addition-only functionality
- Set expectations for future trajectory orbits
- Explain architectural pattern for future developers

### Phase 5: Add .NET Standard Exclusions

**File: `.gitignore`**

Prevent committing build artifacts and IDE-specific files.

```gitignore
# Build results
bin/
obj/

# Visual Studio / Rider cache
.vs/
.idea/

# User-specific files
*.user
*.suo

# NuGet packages
packages/
*.nupkg

# Build logs
*.log
```

### Execution Order

1. **Initialize project** — Create `Calculator.csproj` first, verify `dotnet build` succeeds with empty project
2. **Implement logic** — Create `Calculator.cs`, add `Add()` method, verify compilation
3. **Implement UI** — Create `Program.cs`, test with manual input validation
4. **Update documentation** — Modify `README.md` to reflect new project purpose
5. **Add exclusions** — Create `.gitignore` to keep repository clean

### Verification Checkpoints

After each phase:
- **Phase 1**: `dotnet build` succeeds, creates executable
- **Phase 2**: `Calculator.cs` compiles, `Add()` method accessible from external code
- **Phase 3**: `dotnet run` launches application, prompts appear, calculations work
- **Phase 4**: README accurately describes how to build and run project
- **Phase 5**: `git status` shows no bin/obj directories

## Risk Surface

### Risk 1: Decimal Overflow on Large Inputs

**Scenario:** User enters numbers exceeding `decimal.MaxValue` (7.9 × 10²⁸)

**Likelihood:** Low — Requires intentionally entering 28+ digit numbers

**Impact:** Low — `TryParse` returns false, triggers validation error message

**Mitigation:**
- `decimal.TryParse()` handles overflow gracefully by returning false
- User receives same error message as non-numeric input: "Invalid input. Please enter a valid number"
- No application crash, user can retry with valid input
- Acceptance criteria permits this behavior ("handled gracefully")

**Test case:** Input "99999999999999999999999999999" (29 nines)

### Risk 2: Null Reference on ReadLine

**Scenario:** `Console.ReadLine()` returns null (theoretically possible in redirected input scenarios)

**Likelihood:** Very Low — Standard console execution never returns null

**Impact:** Low — Explicit null check prevents NullReferenceException

**Mitigation:**
- Explicit null check: `if (input == null)` before processing
- User receives "No input received" message and retry prompt
- Alternative: Use null-forgiving operator `input!` but defensive check is safer for foundational orbit

**Test case:** Manual testing insufficient; would require mocking console input stream

### Risk 3: Whitespace-Only Input

**Scenario:** User presses space key(s) then Enter

**Likelihood:** Medium — Common user error

**Impact:** Low — `.Trim()` converts to empty string, `TryParse` returns false

**Mitigation:**
- `input.Trim()` removes leading/trailing whitespace before parsing
- Empty string fails `TryParse`, triggers validation error message
- User experience: "   " treated same as "" or "abc" (invalid input)

**Test case:** Input "   " (three spaces)

### Risk 4: Localization Edge Cases

**Scenario:** User in locale using comma as decimal separator enters "3,14" expecting 3.14

**Likelihood:** Medium — Depends on user's system locale settings

**Impact:** Medium — Input rejected on some systems, accepted on others (inconsistent behavior)

**Current behavior:**
- `decimal.TryParse(input.Trim(), ...)` uses current culture by default
- On US system: "3.14" valid, "3,14" invalid
- On European system: "3,14" valid, "3.14" may be invalid (thousand separator)

**Mitigation for this orbit:**
- Accept current culture behavior (constraint: "No internationalization in this orbit")
- Document in README that application uses system locale settings
- Future orbit can add explicit culture parameter: `TryParse(input, NumberStyles.Any, CultureInfo.InvariantCulture, ...)`

**Test case:** Requires testing on multiple locale configurations (out of scope for Tier 2)

### Risk 5: Separation of Concerns Violation

**Scenario:** Future developer modifies `Calculator.Add()` to include console output

**Likelihood:** Low-Medium — Clear pattern established but no enforcement mechanism

**Impact:** High — Breaks testability constraint, creates technical debt

**Mitigation:**
- XML documentation comments emphasize pure function design
- Code review checklist must verify no `Console.*` calls in `Calculator.cs`
- Future orbit can add unit tests that would fail if I/O is added
- Consider adding architecture tests (ArchUnit.NET) in later trajectory

**Prevention:** Human reviewer must verify `Calculator.cs` contains no I/O operations

### Risk 6: README Confusion with Existing Files

**Scenario:** Developer follows old README instructions, attempts to run Node.js code

**Likelihood:** Medium — README currently contains Node.js instructions

**Impact:** Low — Commands will fail (no package.json), but confusion wastes time

**Mitigation:**
- Complete replacement of README content (not append)
- Remove all Node.js references in single commit
- Consider adding note: "Previously a Node.js sample, now C# calculator"
- Archive old backend/ directory in future orbit or add README note about legacy files

**Validation:** Human reviewer must confirm README contains only C# instructions

### Risk 7: Platform-Specific Build Issues

**Scenario:** .NET 8.0 SDK not installed on developer machine

**Likelihood:** Medium — Depends on development environment setup

**Impact:** High — Cannot build or run project

**Mitigation:**
- README includes explicit requirement: ".NET 8.0 SDK or later"
- Build error message from `dotnet` CLI is clear: "The current .NET SDK does not support targeting .NET 8.0"
- Verification Protocol must confirm build succeeds in verification environment
- Consider adding `.NET 6.0` as fallback target if compatibility issues arise

**Contingency:** If .NET 8.0 unavailable, modify `TargetFramework` to `net6.0` (LTS until November 2024)

## Scope Estimate

**Complexity Assessment:** Low

This orbit involves creating three small files (Calculator.csproj, Program.cs, Calculator.cs), modifying one file (README.md), and adding one configuration file (.gitignore). Total implementation is approximately 150 lines of code including comments and documentation.

**Work Breakdown:**

| Phase | Estimated Effort | Complexity |
|-------|-----------------|------------|
| Project initialization | 15 minutes | Trivial — standard template |
| Calculation logic implementation | 10 minutes | Trivial — single method |
| UI implementation | 30 minutes | Low — input validation requires testing |
| Documentation update | 15 minutes | Trivial — copy/edit existing structure |
| Manual verification | 20 minutes | Low — run through test cases |
| **Total** | **90 minutes** | **Low** |

**Orbit Count:** 1 orbit (this proposal)

**Assumptions:**
- .NET SDK is already installed on execution environment
- No build tooling issues (NuGet restore works correctly)
- Manual testing only (no unit test framework setup in this orbit)

**Dependencies:**
- No external dependencies beyond .NET SDK
- No coordination with other orbits (this is orbit #1)
- No waiting on external systems or approvals

**Confidence Level:** High

Addition is well-understood, C# console applications are standard patterns, and the architecture follows established best practices. The only uncertainty is environmental setup (SDK installation), which is verified early in Phase 1.

**Scalability to Future Orbits:**

Each subsequent arithmetic operation (subtraction, multiplication, division) will follow this pattern:
1. Add method to `Calculator.cs` (5 minutes each)
2. Modify `Program.cs` to call new method (10 minutes each)
3. Update README (5 minutes each)

Total per additional operation: ~20 minutes

Operation selection menu (potential Orbit #5) adds complexity:
- New method to display menu and capture selection (30 minutes)
- Switch statement or strategy pattern to route operations (20 minutes)
- Additional test cases for menu logic (20 minutes)

Estimated: 70 minutes for menu orbit

**Risk Buffer:** 

Add 30% time buffer for Tier 2 supervised review cycles:
- 90 minutes implementation + 27 minutes buffer = **120 minutes total**
- Includes time for addressing review feedback and retesting

## Human Modifications

Pending human review.