# Context Package: Addition Functionality for Calculator

## Codebase References

### Current Repository State

The repository currently contains:

- **README.md** — Root-level documentation describing a Node.js property search sample application
- **backend/api/properties/search.js** — JavaScript API endpoint (unrelated to C# calculator project)
- **backend/database/queries/property-search.sql** — SQL query file (unrelated to C# calculator project)
- **.orbital/artifacts/** — ORBITAL artifact storage containing prior orbit documentation

### Critical Observation: Codebase Mismatch

The repository structure indicates this is currently a Node.js/JavaScript property search application, but the project entity describes a C# console calculator application. This represents one of two scenarios:

1. **Greenfield Development:** The C# calculator application does not yet exist in this repository and must be created from scratch
2. **Wrong Repository:** The calculator project exists in a different repository not currently visible

### Required File Structure (To Be Created)

For this orbit to succeed, the following C# project structure must be established:

```
Calculator/
├── Calculator.csproj              # C# project file
├── Program.cs                     # Console application entry point
├── Calculator.cs                  # Calculator class with operation methods
├── InputValidator.cs              # Input validation logic
└── Calculator.Tests/              # Unit test project (optional but recommended)
    ├── Calculator.Tests.csproj
    └── CalculatorTests.cs
```

### Files to Create or Modify

| File Path | Purpose | Status |
|-----------|---------|--------|
| Calculator/Calculator.csproj | .NET project configuration | Must create |
| Calculator/Program.cs | Main entry point, console I/O orchestration | Must create |
| Calculator/Calculator.cs | Core calculator class with Add() method | Must create |
| Calculator/InputValidator.cs | Input validation and parsing logic | Must create |
| Calculator.Tests/Calculator.Tests.csproj | Test project configuration | Recommended |
| Calculator.Tests/CalculatorTests.cs | Unit tests for addition operation | Recommended |
| README.md | Update with calculator instructions | Must modify |

## Architecture Context

### Application Architecture

This is a **console application architecture** with three logical layers:

1. **Presentation Layer (Program.cs)**
   - Console I/O handling
   - User prompts and output formatting
   - Application lifecycle management (start, loop/exit)

2. **Business Logic Layer (Calculator.cs)**
   - Pure calculation methods (Add, future operations)
   - No I/O dependencies
   - Returns calculated values or throws exceptions

3. **Validation Layer (InputValidator.cs)**
   - Input parsing from string to double
   - Input validation rules
   - Error detection and messaging

### Data Flow

```
User Input (Console)
    ↓
Program.cs (reads string input)
    ↓
InputValidator.TryParse(string) → (bool success, double value, string errorMessage)
    ↓
[If valid] → Calculator.Add(double, double) → double result
    ↓
Program.cs (writes result to Console)
```

### Technology Constraints

- **Runtime:** .NET 6.0 or later (LTS version recommended)
- **Language:** C# 10.0 or later
- **I/O:** System.Console for all user interaction
- **Number Type:** double for floating-point arithmetic per Intent constraints
- **Error Handling:** Exception-based for calculation errors, return-based for validation errors

### Deployment Model

- Single executable console application
- No external dependencies beyond .NET runtime
- No configuration files required for Orbit 1
- Runs locally on developer machine or CI environment

### Infrastructure Requirements

- .NET SDK installed (verified via `dotnet --version`)
- No database, no web server, no external services
- File system access only for loading the executable

## Pattern Library

### Established Patterns (From Intent Requirements)

Since this is Orbit 1 with no existing C# codebase visible, patterns must be established rather than followed. The following patterns align with C# community standards and the Intent's architectural constraints:

#### 1. Separation of Concerns Pattern

**Principle:** Each class has a single, well-defined responsibility.

```csharp
// CORRECT: Calculator only performs calculations
public class Calculator
{
    public double Add(double a, double b) => a + b;
}

// INCORRECT: Calculator mixing I/O and calculation
public class Calculator
{
    public void PerformAddition()
    {
        Console.WriteLine("Enter first number:");
        // ... NO - this violates separation
    }
}
```

#### 2. Fail-Fast Validation Pattern

**Principle:** Validate input before attempting calculation. Return validation results rather than throwing exceptions for user input errors.

```csharp
// CORRECT: Validation returns result object
public class InputValidator
{
    public static ValidationResult TryParseDouble(string input, out double result)
    {
        // Validation logic
    }
}

// INCORRECT: Throwing exceptions for expected invalid input
public static double ParseDouble(string input)
{
    throw new FormatException(); // Too aggressive for user input
}
```

#### 3. Pure Function Pattern for Calculations

**Principle:** Calculation methods have no side effects, depend only on parameters, return deterministic results.

```csharp
// CORRECT: Pure function
public double Add(double a, double b) => a + b;

// INCORRECT: Side effects or state mutation
private double lastResult;
public double Add(double a, double b)
{
    lastResult = a + b; // State mutation - avoid for Orbit 1
    return lastResult;
}
```

#### 4. Explicit Error Message Pattern

**Principle:** Error messages specify what went wrong and provide guidance.

```csharp
// CORRECT: Specific, actionable message
"Invalid input for first number. Please enter a numeric value (e.g., 42 or 3.14)."

// INCORRECT: Generic message
"Error"
"Invalid input"
```

### Naming Conventions

- **Classes:** PascalCase, noun-based (Calculator, InputValidator)
- **Methods:** PascalCase, verb-based (Add, TryParseDouble)
- **Variables:** camelCase (firstNumber, isValid)
- **Constants:** PascalCase (MaxValue, MinValue if needed)
- **Namespaces:** Match project name (Calculator, Calculator.Tests)

### Project Organization Standards

- One class per file
- File name matches class name (Calculator.cs contains Calculator class)
- Test files named [ClassUnderTest]Tests.cs
- Root namespace matches project name

## Prior Orbit References

### Prior Orbit Analysis

**Status:** No prior orbits exist for the Calculator project.

This is Orbit 1 in the Calculator trajectory. The .orbital/artifacts/ directory contains artifacts from other projects or test runs, but none relate to C# calculator functionality.

### Relevant Observations from Artifact History

Examining the artifact directory structure reveals:
- Multiple prior orbits have completed full ORBITAL cycles (intent → context → proposal → verification)
- Artifact naming follows UUID-based identification
- This pattern suggests the ORBITAL process is mature and should be followed precisely

### Lessons for This Orbit

Since no calculator-specific history exists:
- **No legacy code to work around** — clean slate for establishing patterns
- **No existing tests to maintain** — opportunity to establish test-first or test-alongside approach
- **No prior architectural decisions to honor** — full freedom within Intent constraints
- **No technical debt** — architecture can be optimal from the start

### Future Orbit Foundation

This orbit establishes:
- **Core architecture pattern** that subtraction, multiplication, and division will follow
- **Input validation approach** that future operations will reuse
- **Testing strategy** that future operations will replicate
- **Console I/O patterns** that future operations will extend

## Risk Assessment

### Risk 1: Repository Mismatch

**Description:** The repository currently contains a Node.js property search application, not a C# calculator application.

**Impact:** High — Cannot implement C# code in a JavaScript repository without restructuring.

**Likelihood:** Medium — Depends on whether this is intentional (greenfield) or a configuration error.

**Mitigation:**
- Verify with stakeholder that this repository is correct target
- If correct: Create C# project structure in a new subdirectory or at root level
- If incorrect: Redirect to correct repository before proceeding
- Recommended approach: Create `Calculator/` subdirectory to avoid conflicts with existing Node.js code

### Risk 2: .NET SDK Availability

**Description:** Implementation requires .NET SDK to build and run C# console application.

**Impact:** High — Cannot compile or execute without SDK.

**Likelihood:** Low — Standard development environment includes .NET SDK.

**Mitigation:**
- Verification Protocol must include SDK version check (`dotnet --version`)
- Document minimum required version (.NET 6.0+)
- CI/CD pipeline must have .NET SDK installed if automated verification is used

### Risk 3: Floating-Point Precision Ambiguity

**Description:** The Intent specifies double-precision floating-point, which has inherent precision limitations (e.g., 0.1 + 0.2 ≠ 0.3 in binary floating-point).

**Impact:** Medium — Could cause confusion if users expect exact decimal arithmetic.

**Likelihood:** High — This is a known characteristic of binary floating-point.

**Mitigation:**
- Accept this as expected behavior for Orbit 1 (per Intent: "standard .NET double-precision")
- Document precision behavior in code comments
- Future orbit could introduce decimal type if exact decimal arithmetic becomes a requirement
- Verification Protocol should test with values known to expose floating-point behavior (0.1 + 0.2)

### Risk 4: Input Validation Edge Cases

**Description:** The Intent requires handling of edge cases like double.MaxValue, double.MinValue, infinity, NaN, overflow.

**Impact:** Medium — Application could crash or produce incorrect results for extreme inputs.

**Likelihood:** Low — Users unlikely to enter extreme values, but automated tests might.

**Mitigation:**
- InputValidator must check for double.TryParse success
- Calculator.Add should allow overflow to infinity (standard .NET behavior)
- Verification Protocol must include edge case tests
- Error messages should guide users toward valid range

### Risk 5: Architectural Over-Engineering

**Description:** Creating too many abstractions or extensibility mechanisms for a simple addition operation.

**Impact:** Low — Code becomes harder to understand without providing value.

**Likelihood:** Medium — Natural tendency to future-proof.

**Mitigation:**
- Follow YAGNI (You Aren't Gonna Need It) principle
- Implement only what Intent requires for Orbit 1
- Create clean extension points (e.g., separate methods) but don't build full operation framework yet
- Trust that refactoring in future orbits is acceptable

### Risk 6: Test Coverage Gap

**Description:** The Intent specifies testing as a spectrum (manual → automated → comprehensive), but doesn't mandate automated tests.

**Impact:** Medium — Without tests, regressions in future orbits are harder to detect.

**Likelihood:** Medium — Depends on implementation approach.

**Mitigation:**
- Strongly recommend creating Calculator.Tests project even if not mandated
- At minimum, implement unit tests for Calculator.Add with standard test cases
- Verification Protocol should include manual test script if automated tests are skipped
- Future orbits will benefit from test infrastructure established now

### Risk 7: Console Loop vs. Single Operation Ambiguity

**Description:** Intent states "multiple addition operations in sequence (if loop is implemented)" — unclear if loop is required or optional.

**Impact:** Low — User experience differs slightly, but core functionality identical.

**Likelihood:** Medium — Intent language is permissive.

**Mitigation:**
- Proposal Record must clarify: implement simple loop for better UX
- Loop should allow user to exit gracefully (e.g., entering "exit" or blank input)
- Single-operation-then-exit is minimum acceptable, loop is target per Intent's acceptance boundaries

### Risk 8: README Confusion

**Description:** Existing README.md describes Node.js property search app, creating confusion about what this repository contains.

**Impact:** Low — Documentation mismatch, but doesn't block implementation.

**Likelihood:** High — Current README is unrelated to calculator.

**Mitigation:**
- Update README.md to document calculator application
- Option 1: Replace README content entirely if calculator is primary project
- Option 2: Add calculator section if both projects coexist in repository
- Proposal Record must specify README update approach