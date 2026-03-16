# Context Package: Addition Functionality for Calculator

## Codebase References

### Current Repository State

The repository currently contains:

- **README.md** — Root-level documentation describing a property search API sample (Node.js/JavaScript)
- **backend/api/properties/search.js** — JavaScript API endpoint (not relevant to C# calculator)
- **backend/database/queries/property-search.sql** — SQL query file (not relevant to C# calculator)
- **.orbital/artifacts/** — ORBITAL artifact storage containing previous orbit documentation

### Missing C# Project Structure

**Critical Finding**: The repository does not currently contain any C# console application files. The described project (Calculator in C#) and the actual repository contents (Node.js property search API) are misaligned.

### Required File Structure

For this orbit to execute, the following C# project structure must be established:

```
Calculator/
├── Calculator.csproj          # C# project file defining SDK version and dependencies
├── Program.cs                 # Entry point containing Main() method
├── Calculator.cs              # (Optional) Separate class for calculator operations
└── README.md                  # Calculator-specific documentation
```

**Path Assumptions**: Given the repository name `agent-test-repo`, the C# calculator project should likely be placed at the repository root or within a dedicated subdirectory (e.g., `calculator/` or `src/`).

### Files to Create

| File Path | Purpose | References in Intent |
|-----------|---------|---------------------|
| `Program.cs` or `Calculator/Program.cs` | Console application entry point with Main() method, user input/output handling | Console interface constraint, input prompts requirement |
| `Calculator.csproj` or similar | Project definition file specifying .NET SDK version, output type (Exe) | .NET Runtime dependency |
| `.gitignore` (if not present) | Exclude bin/, obj/, and IDE-specific files | Standard C# practice |

### Files to Reference

None of the existing repository files are relevant to C# calculator implementation. The JavaScript and SQL files serve a different project purpose.

## Architecture Context

### Application Architecture

**Type**: Standalone Console Application  
**Pattern**: Procedural console I/O with direct arithmetic operations  
**Deployment**: Local execution via `dotnet run` or compiled executable

### Data Flow

```
User Input (Console) 
    → Input Validation 
    → Type Conversion (string → numeric)
    → Addition Operation
    → Result Formatting
    → Console Output
```

### No External System Integration

This is a greenfield, self-contained console application with:
- No database layer
- No API endpoints
- No external service calls
- No persistent state between executions
- No configuration files required

### .NET Framework Selection

**Decision Required**: The Intent Document specifies ".NET SDK/Runtime compatible with C# console applications" but does not specify a version. Recommended options:

| Framework | Rationale |
|-----------|-----------|
| .NET 8.0 (LTS) | Latest long-term support release, modern C# features, cross-platform |
| .NET 6.0 (LTS) | Mature LTS version, widely adopted |
| .NET Framework 4.8 | Windows-only, legacy option (not recommended for new projects) |

**Recommendation**: Use .NET 8.0 for modern language features, performance, and long-term support unless project constraints dictate otherwise.

### Console Application Structure

Standard C# console applications use:
- `Console.WriteLine()` for output prompts and results
- `Console.ReadLine()` for string input capture
- `double.TryParse()` or `decimal.TryParse()` for safe numeric conversion
- Top-level statements (C# 9+) or traditional `static void Main(string[] args)` entry point

## Pattern Library

### Established Patterns

**Critical Finding**: No C# patterns exist in the current repository. This orbit will establish the foundational patterns for all calculator operations.

### C# Console Application Best Practices

Given this is a greenfield implementation, the following industry-standard patterns should be adopted:

#### Input Validation Pattern

```csharp
// Recommended pattern for safe numeric input
string input = Console.ReadLine();
if (double.TryParse(input, out double number))
{
    // Use 'number' safely
}
else
{
    // Handle invalid input
}
```

**Rationale**: `TryParse` prevents exceptions from invalid input and aligns with the Intent's requirement to "handle gracefully without application crash."

#### Numeric Type Selection

| Type | Use Case | Precision | Range |
|------|----------|-----------|-------|
| `double` | General-purpose decimal arithmetic | ~15-17 digits | ±5.0 × 10^−324 to ±1.7 × 10^308 |
| `decimal` | Financial calculations, exact decimal representation | 28-29 digits | ±1.0 × 10^−28 to ±7.9 × 10^28 |
| `int` | Integer-only operations | Exact | -2,147,483,648 to 2,147,483,647 |

**Recommendation**: Use `double` for this calculator to handle the Intent's requirement of "mixed integer and decimal inputs" with standard floating-point precision. The Intent explicitly states "no custom precision requirements."

#### Error Messaging Pattern

```csharp
Console.WriteLine("Error: Invalid input. Please enter a valid number.");
```

Clear, actionable error messages that don't expose stack traces to console users.

#### Naming Conventions

- PascalCase for class names (`Calculator`)
- PascalCase for method names (`Add`, `GetUserInput`)
- camelCase for local variables (`firstNumber`, `result`)
- Descriptive names over abbreviations (`userInput` not `usrInpt`)

### Project File Structure Pattern

**Minimal .csproj for Console App (.NET 8.0)**:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
```

## Prior Orbit References

### Historical Context

**Finding**: The `.orbital/artifacts/` directory contains multiple prior orbit attempts with UUIDs:
- `000dd429-4ac4-4901-875f-b285b5259e3c` (complete 4-phase orbit)
- `0dcc80ab-c006-4aac-86b3-9179b34ff76c` (complete 4-phase orbit)
- `371de144-3ee1-4fba-b827-847507291483` (intent and context only)
- `53f4382a-b1c0-4a9b-85f2-1a18a042ffc9` (complete 4-phase orbit)
- `a74a8326-2d29-40ef-90ad-8cf6afce0a2a` (intent only)
- `c784f284-f94a-4057-9d09-8582647ecd9a` (intent and context only)

These artifacts are not accessible in the current context but indicate:
1. Multiple orbital attempts have been executed on this repository
2. Some orbits completed verification, others stopped at earlier phases
3. The repository may have been used for ORBITAL methodology testing or training

**Relevance to Current Orbit**: None of these prior orbits appear to relate to C# calculator functionality based on the repository's current state (Node.js property search). This is effectively the first orbit for calculator implementation.

### Lessons from Prior Work

Without access to the content of previous artifacts, no specific lessons can be extracted. However, the presence of incomplete orbits (stopping at intent or context) suggests:
- Careful attention to phase completion criteria is important
- Repository state misalignment (like the current JavaScript vs. C# discrepancy) may have caused prior orbit issues

### No Existing Calculator Implementation

**Confirmed**: There is no existing C# calculator code to reference, modify, or extend. This is a from-scratch implementation establishing all patterns.

## Risk Assessment

### Repository State Mismatch (HIGH RISK)

**Risk**: The repository contains JavaScript/Node.js code for a property search API, but the project metadata describes a C# calculator console application.

**Impact**: 
- Unclear where to place C# files
- Potential confusion about which project is being developed
- Risk of overwriting or conflicting with existing Node.js work

**Mitigation**:
1. Create a dedicated `calculator/` subdirectory for C# project
2. Update root README.md to document both projects if they should coexist
3. Alternatively, create a separate branch for calculator development
4. Clarify with project stakeholders whether the JavaScript content should be retained or removed

**Verification**: Before writing any code, confirm the intended repository structure with the orbit requester.

### Floating-Point Precision (MEDIUM RISK)

**Risk**: Using `double` for decimal arithmetic introduces standard floating-point precision limitations (e.g., 0.1 + 0.2 = 0.30000000000000004).

**Impact**: 
- May produce results that appear incorrect to users expecting exact decimal math
- Intent Document acknowledges this: "beyond floating-point tolerance"
- Users adding currency values (e.g., $10.25 + $5.30) may see unexpected decimals

**Mitigation**:
1. Accept this as documented behavior (Intent explicitly allows floating-point tolerance)
2. Document in code comments that this is standard floating-point behavior
3. For future orbits, consider adding a decimal-precision mode if financial calculations become a requirement

**Verification**: Test with known floating-point edge cases (0.1 + 0.2, 0.3 - 0.1) and confirm results fall within acceptable tolerance.

### Input Buffer Overflow (LOW RISK)

**Risk**: Extremely long input strings could theoretically cause memory issues.

**Impact**: Console crashes or hangs on malicious or accidental very long input.

**Mitigation**:
1. `Console.ReadLine()` in .NET has built-in safety limits
2. `TryParse` will gracefully fail on invalid input regardless of length
3. No additional validation needed for this risk

**Verification**: Test with input strings of 1000+ characters to confirm graceful failure.

### No Exception Handling for Overflow (MEDIUM RISK)

**Risk**: Adding very large numbers (near `double.MaxValue`) could produce `Infinity` or overflow behavior.

**Impact**: 
- Result displays as "Infinity" rather than a numeric value
- May confuse users expecting an error message
- Intent Document mentions "very large numbers without overflow" as a "Should Have"

**Mitigation**:
1. Check if result is `double.IsInfinity()` or `double.IsNaN()` after addition
2. Display user-friendly error: "Result exceeds calculator limits"
3. Document the practical numeric limits in user prompts if needed

**Verification**: Test with `double.MaxValue - 1 + double.MaxValue - 1` to trigger overflow.

### Pattern Lock-In (HIGH RISK - Strategic)

**Risk**: This is the first arithmetic operation, establishing patterns for input handling, validation, and output that will be replicated in subtract, multiply, and divide operations.

**Impact**: 
- Poor patterns here propagate to all future calculator operations
- Refactoring later requires changing all four operations
- Technical debt multiplies across the entire calculator

**Mitigation**:
1. Design for reusability: consider extracting input validation and output formatting into reusable methods
2. Code review before merge to validate pattern quality
3. Document pattern decisions explicitly for future orbit implementers
4. This is why Intent Document assigned Tier 2 (Supervised) trust level

**Verification**: Human review of code structure and patterns before accepting the orbit.

### No .NET SDK Specified (MEDIUM RISK)

**Risk**: Implementation may use a .NET version incompatible with the development or deployment environment.

**Impact**: 
- Code may not compile on target machines
- Modern C# features (top-level statements, pattern matching) may not be available or may break compatibility

**Mitigation**:
1. Clarify .NET version before implementation begins
2. Default to .NET 8.0 LTS if no constraints exist
3. Document SDK version in README.md and .csproj

**Verification**: Confirm SDK availability in deployment environment before orbit completion.

### No Testing Framework Specified (LOW RISK - Process)

**Risk**: Intent Document does not specify unit testing requirements, but Tier 2 trust level suggests testing is expected.

**Impact**: 
- Unclear whether xUnit, NUnit, or MSTest should be used
- Manual verification only vs. automated test suite
- Future orbits may establish conflicting test patterns

**Mitigation**:
1. Defer testing framework setup to Proposal Record
2. Suggest xUnit as modern .NET standard unless constraints dictate otherwise
3. Verification Protocol will define required test coverage

**Verification**: Testing approach will be clarified in subsequent orbit phases (Proposal and Verification).