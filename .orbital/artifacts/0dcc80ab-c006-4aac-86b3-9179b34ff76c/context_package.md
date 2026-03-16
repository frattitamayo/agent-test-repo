# Context Package: Addition Functionality for Console Calculator

## Codebase References

### Current Repository State

The repository `frattitamayo/agent-test-repo` currently contains:

- **README.md** — Repository documentation describing a Node.js property search API (unrelated to the C# calculator project)
- **backend/api/properties/search.js** — Node.js API endpoint (unrelated to calculator)
- **backend/database/queries/property-search.sql** — SQL query file (unrelated to calculator)
- **.orbital/artifacts/** — ORBITAL system metadata and prior orbit artifacts

### Critical Finding: No C# Project Structure Exists

The repository does not contain any C# project files, source code, or .NET configuration. The following files are **missing and must be created**:

- **Calculator.csproj** or similar — .NET project file defining the console application
- **Program.cs** — Entry point for the C# console application
- **Calculator.cs** or similar — Class containing addition logic (if separating concerns)
- **.gitignore** — Standard .NET gitignore to exclude bin/, obj/, and IDE files

### Required File Paths (To Be Created)

Based on standard C# console application structure:

```
/
├── Calculator.csproj          # .NET project configuration
├── Program.cs                 # Application entry point
├── .gitignore                 # .NET-specific ignores
└── README.md                  # Update to reflect C# calculator project
```

Alternative structure with separation of concerns:

```
/
├── Calculator.csproj
├── Program.cs                 # Entry point, UI/console interaction
├── Calculator.cs              # Core calculator logic class
├── .gitignore
└── README.md
```

## Architecture Context

### System Architecture

**Type:** Standalone console application  
**Runtime:** .NET (version TBD, recommend .NET 6+ for long-term support)  
**Execution Model:** Synchronous, single-threaded console I/O  
**State Management:** Stateless per-operation (no persistent state between runs)

### Data Flow

1. **User Input** → Console.ReadLine() captures raw string input
2. **Input Validation** → Parse and validate numeric input using `double.TryParse()`
3. **Computation** → Perform addition operation on validated numeric values
4. **Output Display** → Format and write result to console using Console.WriteLine()
5. **Error Handling** → Catch invalid input, display error message, optionally retry

### Service Boundaries

This is an **isolated, self-contained application** with no external service dependencies:

- No database connections
- No network I/O
- No file system operations (beyond standard console I/O)
- No third-party libraries required (pure .NET BCL)

### Infrastructure Constraints

- **Execution Environment:** Local machine with .NET runtime installed
- **Deployment Model:** Compiled executable or `dotnet run` from source
- **Resource Limits:** Minimal — console applications have negligible memory/CPU footprint
- **Platform Support:** Cross-platform (Windows, macOS, Linux) if using .NET Core/.NET 5+

### Design Patterns Applicable

Given this is a greenfield console application for Orbit 1:

- **Procedural Entry Point Pattern:** Simple `Main()` method with linear flow for MVP
- **Input Validation Pattern:** Use `TryParse()` with explicit error handling rather than exceptions for invalid input
- **Separation of Concerns (Optional):** Extract calculator logic into a separate class if anticipating multiple operations (subtraction, multiplication, division in future orbits)

## Pattern Library

### Established Patterns

**Note:** Since this is Orbit 1 and no C# code exists yet, this section defines **recommended patterns to establish** rather than existing patterns to follow.

### Console I/O Conventions (To Be Established)

```csharp
// Input prompt pattern
Console.Write("Enter first number: ");
string input = Console.ReadLine();

// Validation pattern
if (!double.TryParse(input, out double number))
{
    Console.WriteLine("Error: Please enter a valid number.");
    // Handle retry logic
}

// Output pattern
Console.WriteLine($"Result: {result}");
```

### Naming Conventions (To Be Established)

- **Project Name:** `Calculator` (matches project entity name)
- **Namespace:** `Calculator` or `CalculatorApp`
- **Class Names:** PascalCase (e.g., `Calculator`, `Program`)
- **Method Names:** PascalCase (e.g., `Add`, `GetUserInput`, `ValidateNumericInput`)
- **Local Variables:** camelCase (e.g., `firstNumber`, `secondNumber`, `result`)

### Error Handling Standards (To Be Established)

- Use `TryParse()` for input validation rather than catching `FormatException`
- Display user-friendly error messages without technical jargon
- Avoid throwing exceptions for expected user errors (invalid input is expected, not exceptional)
- Reserve exceptions for truly unexpected scenarios (e.g., `OutOfMemoryException`)

### Testing Patterns (To Be Established)

For Tier 2 (Supervised) trust level, establish:

- **Unit Tests:** Test addition logic with positive, negative, zero, decimal, and boundary values
- **Input Validation Tests:** Test invalid inputs (empty string, non-numeric, special characters)
- **Integration Tests:** End-to-end console interaction tests if feasible with test harness

## Prior Orbit References

### Orbit History

**This is Orbit 1** — No prior orbits exist in the Calculator trajectory.

### Relevant Artifacts in Repository

The `.orbital/artifacts/` directory contains artifacts from unrelated intents:

- **0dcc80ab-c006-4aac-86b3-9179b34ff76c/** — Artifacts for an unrelated intent
- **a74a8326-2d29-40ef-90ad-8cf6afce0a2a/** — Artifacts for an unrelated intent

These artifacts reference property search functionality (Node.js/SQL) and are **not relevant** to the C# calculator implementation.

### Lessons for Future Orbits

Since this is the foundational orbit:

- **Code Structure Established Here Will Be Template for Future Operations:** The pattern for input handling, validation, and output display should be reusable for subtraction, multiplication, and division
- **Test Coverage Standards Set Here Apply Forward:** The testing rigor established in Orbit 1 sets expectations for subsequent orbits
- **Error Handling Philosophy Begins Here:** Consistent user experience for invalid input should carry through all operations

## Risk Assessment

### Risk 1: Project Structure Scaffold Failure

**Severity:** High  
**Probability:** Low  
**Description:** Creating the initial .NET project structure (.csproj, Program.cs) incorrectly could block all subsequent work.

**Mitigations:**
- Use `dotnet new console` command to generate standard project template
- Validate project file against .NET SDK documentation
- Ensure project compiles before implementing addition logic

### Risk 2: Input Validation Edge Cases

**Severity:** Medium  
**Probability:** Medium  
**Description:** Inadequate handling of edge cases (extremely large numbers, scientific notation, localization issues with decimal separators) could cause runtime crashes or incorrect results.

**Mitigations:**
- Use `double.TryParse()` with `NumberStyles.Any` and `CultureInfo.InvariantCulture` for consistent parsing
- Test boundary values near `double.MaxValue` and `double.MinValue`
- Explicitly test zero, negative numbers, and decimal values
- Document behavior for overflow scenarios (return infinity vs. error message)

### Risk 3: User Experience Regression for Invalid Input

**Severity:** Low  
**Probability:** Medium  
**Description:** Poor error messages or unexpected application termination when users enter invalid input degrades usability.

**Mitigations:**
- Implement retry loop allowing users to correct invalid input without restarting
- Provide specific error messages ("Please enter a valid number" rather than generic "Error")
- Test with non-technical users if possible

### Risk 4: Inconsistent Patterns for Future Operations

**Severity:** Medium  
**Probability:** Medium  
**Description:** Since this is Orbit 1, patterns established here (code structure, input flow, error handling) become the foundation. Inconsistent or suboptimal patterns will require refactoring across all operations later.

**Mitigations:**
- Design with extensibility in mind (e.g., separate calculator logic from console UI if planning 4 operations)
- Document architectural decisions in code comments
- Review code structure against acceptance criteria for "foundation for future work" rationale in Intent Document

### Risk 5: .NET Version Compatibility

**Severity:** Low  
**Probability:** Low  
**Description:** Choosing an outdated or unsupported .NET version could create maintenance burden or deployment issues.

**Mitigations:**
- Use .NET 6 or later (LTS versions with long-term support)
- Document required .NET version in README.md
- Validate runtime availability in target deployment environment

### Risk 6: Repository Confusion (Unrelated Existing Content)

**Severity:** Low  
**Probability:** Low  
**Description:** The repository currently contains Node.js property search code. Mixing unrelated projects could cause confusion or deployment errors.

**Mitigations:**
- Update README.md to clearly describe the C# calculator project
- Consider organizing in subdirectory (e.g., `/calculator/`) if property search code remains
- Ensure .gitignore covers both Node.js and .NET artifacts to avoid binary pollution