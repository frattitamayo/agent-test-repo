# Context Package: Addition Operation for Calculator

## Codebase References

### Current Repository State

The repository currently contains no C# calculator code. The existing structure includes:

- `README.md` — Repository documentation (currently describes a Node.js property search API, not calculator functionality)
- `backend/api/properties/search.js` — Unrelated Node.js API endpoint
- `backend/database/queries/property-search.sql` — Unrelated SQL query
- `.orbital/artifacts/` — ORBITAL methodology artifacts from previous unrelated work

### Required New Files

Since this is a greenfield C# console application, the following files must be created:

- `Calculator.csproj` — C# project file defining target framework, dependencies, and build configuration
- `Program.cs` — Console application entry point with Main method
- `Operations/Addition.cs` — Addition operation implementation (following expected pattern for extensibility)
- `Core/Calculator.cs` — Calculator orchestration class that coordinates operations and I/O
- `Utils/InputValidator.cs` — Input parsing and validation logic

### Files to Modify

- `README.md` — Must be updated to replace property search documentation with calculator setup and usage instructions

## Architecture Context

### Application Structure

This is the foundational orbit for a new C# console application. The architecture must support future expansion to subtraction, multiplication, and division operations without requiring refactoring of the addition implementation.

**Recommended Layered Structure:**

```
Calculator/
├── Program.cs                 # Entry point, console loop
├── Core/
│   └── Calculator.cs         # Orchestrator: operation selection, result formatting
├── Operations/
│   ├── IOperation.cs         # Interface defining operation contract
│   └── Addition.cs           # Addition implementation
└── Utils/
    └── InputValidator.cs     # Parse and validate numeric input
```

### Data Flow

1. `Program.cs` initializes console application and displays operation menu
2. User selects addition operation
3. `Calculator.cs` prompts for two numbers via console
4. `InputValidator.cs` parses input strings to numeric types
5. `Addition.cs` performs calculation with overflow checking
6. `Calculator.cs` formats and displays result to console
7. Application loops or exits based on user input

### Technology Constraints

- **Target Framework:** .NET 6.0 or higher (LTS version recommended for new projects)
- **Numeric Type:** Use `decimal` type as primary numeric type for calculator operations to avoid floating-point precision issues noted in Intent Document acceptance criteria
- **Error Handling:** Use try-catch blocks around numeric parsing and arithmetic operations, with specific exception types for overflow vs. format errors

### Design Principles

- **Single Responsibility:** Each operation class handles only its arithmetic logic
- **Open/Closed:** New operations should be addable without modifying existing operation classes
- **Dependency Inversion:** Calculator class depends on operation interface, not concrete implementations
- **Fail-Safe:** Invalid input or overflow errors do not terminate the application

## Pattern Library

### Patterns to Establish (First Orbit)

Since this is the first calculator functionality, this orbit establishes patterns that subsequent operations must follow:

#### Operation Interface Pattern

```csharp
public interface IOperation
{
    string Name { get; }
    decimal Execute(decimal operand1, decimal operand2);
    bool ValidateInputs(decimal operand1, decimal operand2);
}
```

All arithmetic operations (addition, subtraction, multiplication, division) will implement this interface.

#### Input Validation Pattern

- Use `decimal.TryParse()` for input parsing to avoid exceptions on invalid input
- Trim whitespace before parsing
- Return validation result with specific error messages rather than throwing exceptions
- Empty or null input treated as validation failure

#### Console I/O Pattern

```
Calculator - Addition
Enter first number: [input]
Enter second number: [input]
Result: [num1] + [num2] = [result]

Press any key to continue...
```

#### Error Message Format

- **Invalid Input:** "Invalid input: '[input]' is not a valid number. Please enter a numeric value."
- **Overflow:** "Calculation error: Result exceeds maximum supported value."
- **Validation Failure:** Include specific constraint that was violated (e.g., "Input must be a number between -79,228,162,514,264,337,593,543,950,335 and 79,228,162,514,264,337,593,543,950,335")

#### Naming Conventions

- **Namespaces:** `Calculator`, `Calculator.Operations`, `Calculator.Utils`, `Calculator.Core`
- **Classes:** PascalCase, descriptive nouns (e.g., `Addition`, `InputValidator`)
- **Methods:** PascalCase, verb phrases (e.g., `Execute`, `ValidateInput`)
- **Variables:** camelCase (e.g., `operand1`, `result`)

### C# Conventions

- Use explicit access modifiers (`public`, `private`, `internal`)
- Implement `IDisposable` if managing resources (not applicable for this orbit)
- Use nullable reference types if targeting .NET 6.0+
- XML documentation comments for public APIs

## Prior Orbit References

### No Prior Calculator Orbits

This is Orbit 1 of the Calculator trajectory. No prior calculator implementation exists to reference.

### ORBITAL Methodology Usage

The repository contains `.orbital/artifacts/` folders from previous unrelated work (property search functionality). These demonstrate:

- ORBITAL artifact generation has been used successfully in this repository
- The team is familiar with the Intent → Context → Proposal → Verification workflow
- Artifact storage conventions are already established

However, the content of those artifacts (Node.js/SQL property search) provides no technical guidance for C# calculator implementation.

### Greenfield Status

**Key Implications:**
- No existing code to preserve or refactor
- No legacy patterns to conform to
- Complete freedom in architectural decisions within Intent constraints
- Higher importance on establishing clean, extensible patterns since this sets the foundation

## Risk Assessment

### Risk: Numeric Type Selection

**Description:** Choosing the wrong numeric type (int, double, float, decimal) could cause precision issues or constrain future calculator features.

**Probability:** Medium  
**Impact:** High (would require refactoring all operations)

**Mitigation:**
- Use `decimal` type as specified in Intent Document to meet 2+ decimal place accuracy requirement
- Document type choice in code comments for future maintainers
- Verify decimal range (-79,228,162,514,264,337,593,543,950,335 to 79,228,162,514,264,337,593,543,950,335) is acceptable for calculator use case

### Risk: Poor Extensibility Architecture

**Description:** Since this is the first operation, a poorly designed structure will make adding subtraction/multiplication/division difficult or require refactoring.

**Probability:** High (common in greenfield projects)  
**Impact:** Medium (increases cost of future orbits)

**Mitigation:**
- Implement `IOperation` interface from the start, even with only one implementation
- Use dependency injection pattern or factory pattern for operation selection
- Keep operation logic isolated from I/O and orchestration logic
- Require Tier 2 human review to validate extensibility before subsequent operations begin

### Risk: Input Validation Gaps

**Description:** Console input is inherently uncontrolled. Edge cases (null, whitespace, special characters, scientific notation) could crash the application or produce incorrect results.

**Probability:** Medium  
**Impact:** Medium (poor user experience, potential crashes)

**Mitigation:**
- Comprehensive unit tests for `InputValidator` covering all edge cases identified in Intent
- Use `decimal.TryParse()` with appropriate `NumberStyles` flags
- Explicit whitespace trimming before parsing
- Test with inputs like: "", " ", "null", "1e10", "1.234.567", "abc", "∞"

### Risk: Overflow Handling Inconsistency

**Description:** C# decimal addition can throw `OverflowException` if result exceeds decimal range. If not caught, application crashes.

**Probability:** Low (requires extremely large inputs)  
**Impact:** High (violates "application remains running" requirement)

**Mitigation:**
- Wrap all arithmetic operations in try-catch for `OverflowException`
- Display error message per Intent specification and return to input prompt
- Consider validating input magnitude before performing operation (optional defense-in-depth)

### Risk: README Overwrite

**Description:** README.md currently documents property search functionality. Replacing it entirely could confuse developers who worked on that code.

**Probability:** Low  
**Impact:** Low (documentation only)

**Mitigation:**
- Verify with team that property search code is deprecated or moved to different repository
- If property search is still active, create separate `CALCULATOR.md` instead of overwriting README
- Preserve any repository-wide information (contribution guidelines, license) if present

### Risk: .NET Version Unavailability

**Description:** Development or CI environment may not have the target .NET version installed.

**Probability:** Low  
**Impact:** Medium (blocks development)

**Mitigation:**
- Specify .NET version explicitly in `.csproj` file
- Document required .NET version in README
- Use widely available LTS version (.NET 6.0 or .NET 8.0) rather than preview releases
- Verify environment capabilities before implementation begins

### Risk: No User Exit Mechanism

**Description:** Console application runs addition once then exits, or loops infinitely with no exit option.

**Probability:** Medium  
**Impact:** Low (usability issue)

**Mitigation:**
- Implement simple menu: "Press 'Q' to quit or any other key to perform another addition"
- Ensure Ctrl+C works as emergency exit
- Document exit mechanism in console prompts