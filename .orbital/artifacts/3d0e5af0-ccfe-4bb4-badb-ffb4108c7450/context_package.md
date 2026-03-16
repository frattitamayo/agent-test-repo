# Context Package: Addition Functionality for Calculator

## Codebase References

### Current Repository State

**Critical Finding:** The repository structure indicates a **mismatch between project description and actual codebase**.

- **Project Description Claims:** C# console calculator application
- **Repository Reality:** Node.js backend with property search API

**Actual Repository Contents:**
- `README.md` — Documents a Node.js property search API (not a C# calculator)
- `backend/api/properties/search.js` — JavaScript API endpoint for property search
- `backend/database/queries/property-search.sql` — SQL query for property data
- `.orbital/artifacts/` — ORBITAL methodology artifacts from previous orbits

**Missing Expected Files:**
- No C# project file (`.csproj`)
- No C# source files (`.cs`)
- No `Program.cs` or equivalent entry point
- No evidence of .NET project structure

### Required File Creation

To implement the addition functionality as described in the Intent Document, the following files must be created from scratch:

| File Path | Purpose | Status |
|-----------|---------|--------|
| `Calculator.csproj` | C# project definition | Does not exist |
| `Program.cs` | Console application entry point | Does not exist |
| `Calculator.cs` or `Operations.cs` | Addition operation logic | Does not exist |

### Repository Root Structure Recommendation

Given the Intent to build a C# calculator and the existing Node.js content, two paths are possible:

1. **Separate C# Project:** Create a `/calculator` subdirectory to house the C# console application alongside the existing backend
2. **Replace Existing Content:** Archive or remove the Node.js backend and restructure the repository as a C# solution

**Recommendation:** Option 1 (separate subdirectory) preserves existing work and clearly delineates the calculator project.

## Architecture Context

### Current System Architecture (Actual)

The repository currently implements a **Node.js property search API** with the following characteristics:

- **Runtime:** Node.js with Express.js (implied by API structure)
- **Data Layer:** SQL-based property database queries
- **API Pattern:** RESTful endpoint at `/api/properties/search`
- **Deployment Model:** Standalone server on port 3000

**This architecture is irrelevant to the Intent Document's C# calculator requirement.**

### Target System Architecture (Intent-Driven)

The Intent Document requires a **C# console application** with these architectural characteristics:

- **Runtime:** .NET SDK (version unspecified)
- **Application Type:** Console application (System.Console namespace)
- **Execution Model:** Synchronous, single-user, REPL-style interaction loop
- **Data Flow:**
  1. User prompt → Console input
  2. Input validation and parsing
  3. Arithmetic operation execution
  4. Result formatting and output to console
  5. Loop or exit

### Foundational Design Decisions

Per the Intent Document constraint that this orbit must "establish patterns that can be consistently replicated for other arithmetic operations," the architecture must support:

- **Operation Abstraction:** Addition logic should be encapsulated in a way that subtraction, multiplication, and division can follow the same signature and invocation pattern
- **Separation of Concerns:**
  - **Input Layer:** Console I/O and input validation (handles prompts, parsing, error recovery)
  - **Business Logic:** Pure arithmetic operations (no I/O coupling)
  - **Output Layer:** Result formatting and display
- **Error Handling Strategy:** Graceful degradation with user-friendly error messages and recovery flow

### Infrastructure Constraints

- **No External Dependencies:** The Intent specifies console-only interaction with no web API, database, or external service integration
- **Standard Library Only:** Should rely on .NET Base Class Library without third-party NuGet packages for core functionality
- **Cross-Platform Consideration:** .NET console applications run on Windows, macOS, and Linux; no platform-specific APIs should be used

## Pattern Library

### Established Patterns (None Applicable)

**Finding:** The existing repository contains JavaScript/Node.js patterns that do not translate to C# console application development. No C# patterns exist in the current codebase.

### Required Patterns for C# Console Calculator

Since this is the foundational orbit, the following patterns must be established:

#### 1. Console Input Pattern

**Recommended Approach:**
```csharp
// Reusable input method with validation and retry
public static double GetNumberInput(string prompt)
{
    while (true)
    {
        Console.Write(prompt);
        string input = Console.ReadLine();
        
        if (double.TryParse(input, out double result))
        {
            return result;
        }
        
        Console.WriteLine("Invalid input. Please enter a valid number.");
    }
}
```

**Rationale:** Establishes a consistent input validation pattern that all operations can reuse. Handles the Intent's requirement for graceful error recovery and re-prompting.

#### 2. Operation Method Signature Pattern

**Recommended Approach:**
```csharp
// Pure function for arithmetic operations
public static double Add(double a, double b)
{
    return a + b;
}
```

**Rationale:** Simple, testable, and extensible. Future operations (Subtract, Multiply, Divide) follow identical signature pattern.

#### 3. Main Application Loop Pattern

**Recommended Approach:**
```csharp
// REPL pattern for calculator
while (true)
{
    DisplayMenu();
    string choice = Console.ReadLine();
    
    if (choice == "1") // Addition
    {
        double num1 = GetNumberInput("Enter first number: ");
        double num2 = GetNumberInput("Enter second number: ");
        double result = Add(num1, num2);
        Console.WriteLine($"Result: {result}");
    }
    else if (choice == "exit")
    {
        break;
    }
}
```

**Rationale:** Provides structure for adding multiple operations without architectural changes.

#### 4. Naming Conventions

- **Method Names:** PascalCase, verb-first for operations (`Add`, `GetNumberInput`)
- **Variable Names:** camelCase, descriptive (`num1`, `num2`, `result`)
- **Class Names:** PascalCase, noun-based (`Calculator`, `Operations`)
- **File Names:** Match primary class name (`Calculator.cs`, `Program.cs`)

### Anti-Patterns to Avoid

- **Mixing I/O with Logic:** Do not embed `Console.WriteLine` inside arithmetic operation methods
- **Hard-Coded Values:** Avoid magic numbers or fixed prompts scattered throughout code
- **Exception-Based Control Flow:** Use `TryParse` instead of catching exceptions for invalid input
- **Global State:** Avoid static fields that persist calculation state between operations

## Prior Orbit References

### Orbit Artifact Analysis

The repository contains `.orbital/artifacts/` from at least six previous orbits:

| Orbit ID | Artifacts Present | Relevant to Calculator Intent |
|----------|-------------------|-------------------------------|
| `000dd429-4ac4-4901-875f-b285b5259e3c` | Full set (intent, context, proposal, verification) | Unknown — content not provided |
| `0dcc80ab-c006-4aac-86b3-9179b34ff76c` | Full set | Unknown — content not provided |
| `371de144-3ee1-4fba-b827-847507291483` | Intent and context only | Unknown — content not provided |
| `488537e5-c49d-453d-a65f-def5a94ec3d9` | Full set | Unknown — content not provided |
| `53f4382a-b1c0-4a9b-85f2-1a18a042ffc9` | Full set | Unknown — content not provided |
| `90860333-1417-488f-8019-aba89cf04be4` | Full set | Unknown — content not provided |

**Critical Gap:** Without access to the content of these prior orbit artifacts, it is impossible to determine:
- Whether any previous orbit attempted C# calculator functionality
- What lessons learned or patterns were established
- Whether any of these orbits relate to the current trajectory

**Recommendation:** Review artifact contents of all prior orbits in the Calculator trajectory before implementation to ensure consistency and avoid duplicated effort.

### Lessons from Repository State

**Key Insight:** The significant divergence between project description (C# calculator) and repository reality (Node.js API) suggests one of the following scenarios:

1. **Wrong Repository:** The agent-test-repo may not be the correct repository for the Calculator project
2. **Project Pivot:** The project description is outdated and the repository has moved to a different domain
3. **Multi-Project Repository:** The repository is intended to house multiple unrelated projects

**Action Required:** Human validation is needed to confirm the correct implementation path before proceeding with code generation.

## Risk Assessment

### 1. Repository Scope Confusion

**Risk:** Implementing C# calculator code in a repository that contains unrelated Node.js property search code creates confusion about repository purpose and maintainability.

**Impact:** HIGH — Future developers may not understand the repository's scope or organization.

**Mitigation:**
- Clarify repository purpose with human stakeholder before implementation
- If multi-project repository is intended, create clear subdirectory structure (`/calculator`, `/property-search`)
- Update root `README.md` to document repository organization

### 2. .NET Version Ambiguity

**Risk:** No .NET version is specified in the Intent Document or project description. Different .NET versions have different console APIs and capabilities.

**Impact:** MEDIUM — Code may not compile or run in the target environment.

**Mitigation:**
- Default to .NET 6.0 or later (LTS with broad compatibility)
- Explicitly specify target framework in `.csproj` file
- Document .NET version requirement in implementation

### 3. Pattern Establishment Pressure

**Risk:** The Intent Document emphasizes that this orbit "establishes patterns" for future operations. Poor architectural choices will propagate to all subsequent arithmetic operations.

**Impact:** HIGH — Technical debt that compounds with each new operation.

**Mitigation:**
- Prioritize clean separation of concerns over clever optimizations
- Extract reusable components (input handling, output formatting) into dedicated methods
- Request human review specifically on architectural patterns before marking orbit complete

### 4. Floating-Point Precision

**Risk:** The Intent's "Exceptional" acceptance criterion mentions handling "floating-point precision edge cases." Standard `double` arithmetic can produce unexpected results (e.g., 0.1 + 0.2 ≠ 0.3).

**Impact:** LOW for addition — This is a known limitation of binary floating-point representation, not a bug.

**Mitigation:**
- Document floating-point behavior in code comments
- If precision is critical, consider `decimal` type instead of `double` for financial or exact decimal calculations
- Do not attempt to "fix" inherent floating-point behavior unless explicitly required

### 5. Input Validation Edge Cases

**Risk:** The Intent requires handling "non-numeric input gracefully," but edge cases exist:
- Empty input (user presses Enter without typing)
- Whitespace-only input
- Numbers in scientific notation (e.g., "1.5e10")
- Numbers with thousands separators (e.g., "1,000")
- Very large numbers that exceed `double` range (overflow to infinity)

**Impact:** MEDIUM — Users may encounter unexpected behavior or error messages.

**Mitigation:**
- Use `double.TryParse` with `NumberStyles.Float` to handle scientific notation
- Trim whitespace before parsing
- Provide specific error messages for empty input vs. invalid format
- Accept `double.PositiveInfinity` and `double.NegativeInfinity` as valid results (explicitly document behavior)

### 6. User Experience Consistency

**Risk:** Without a defined UX pattern, prompts and output formatting may be inconsistent across operations.

**Impact:** LOW — Functional but unprofessional user experience.

**Mitigation:**
- Establish standard prompt format: `"Enter [ordinal] number: "`
- Establish standard result format: `"Result: [value]"` or `"[num1] + [num2] = [result]"`
- Document UX conventions in code comments or separate style guide

### 7. Exit Strategy

**Risk:** The Intent Document does not specify how users exit the calculator application.

**Impact:** LOW — Users may not know how to quit the application.

**Mitigation:**
- Implement explicit exit command (e.g., type "exit" or "quit")
- Display available options in menu/prompt
- Support standard console termination (Ctrl+C) without error messages