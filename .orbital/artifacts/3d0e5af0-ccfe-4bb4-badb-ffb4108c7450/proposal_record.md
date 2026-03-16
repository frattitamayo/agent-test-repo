# Proposal Record: Addition Functionality for Calculator

## Interpreted Intent

This orbit establishes the foundational arithmetic capability for a C# console calculator application by implementing addition of two numbers. The core deliverable is a working console application that:

1. Prompts the user to enter two numeric values
2. Validates input and handles errors gracefully with re-prompting
3. Performs addition using the `double` data type
4. Displays the result in a clear, formatted manner
5. Establishes reusable patterns for input handling, operation execution, and output formatting that will be replicated in future arithmetic operations (subtraction, multiplication, division)

**Critical Architectural Requirement:** This is not merely about making addition work — it is about establishing the **architectural foundation** for all subsequent calculator operations. The patterns, method signatures, and separation of concerns implemented in this orbit will be directly replicated across the remaining trajectory.

**Repository Context Challenge:** The target repository currently contains Node.js property search code with no C# project structure. This proposal addresses the repository mismatch by creating a dedicated `/calculator` subdirectory to house the C# console application, preserving existing repository content while clearly delineating project boundaries.

## Implementation Plan

### Phase 1: Repository Structure Setup

**Objective:** Establish C# project structure within the repository while preserving existing Node.js content.

**Files to Create:**

| File Path | Purpose | Content Summary |
|-----------|---------|-----------------|
| `calculator/Calculator.csproj` | C# project definition | .NET 6.0 console application project file with explicit target framework |
| `calculator/Program.cs` | Application entry point | Main method with REPL loop, menu display, and orchestration of input/operation/output flow |
| `calculator/Operations.cs` | Arithmetic operation logic | Static class containing pure arithmetic functions starting with `Add` method |
| `calculator/InputHandler.cs` | Input validation and parsing | Static class with reusable `GetNumberInput` method for validated console input |
| `calculator/README.md` | Calculator-specific documentation | Build, run, and usage instructions for the calculator application |

**Files to Modify:**

| File Path | Modification | Rationale |
|-----------|--------------|-----------|
| `README.md` (root) | Add section documenting calculator subdirectory | Clarify multi-project repository structure |

**Directory Structure (Post-Implementation):**
```
/
├── .orbital/
├── backend/               # Existing Node.js API (unchanged)
├── calculator/            # New C# console application
│   ├── Calculator.csproj
│   ├── Program.cs
│   ├── Operations.cs
│   ├── InputHandler.cs
│   └── README.md
└── README.md              # Updated to document structure
```

### Phase 2: Core Implementation

#### File 1: `calculator/Calculator.csproj`

**Purpose:** Define .NET project metadata and target framework.

**Implementation Details:**
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net6.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
</Project>
```

**Key Decisions:**
- Target .NET 6.0 for LTS support and broad platform compatibility
- Enable nullable reference types for safer code
- Enable implicit usings to reduce boilerplate

#### File 2: `calculator/InputHandler.cs`

**Purpose:** Encapsulate input validation logic for reuse across all operations.

**Implementation Details:**
```csharp
namespace Calculator;

public static class InputHandler
{
    /// <summary>
    /// Prompts the user for numeric input with validation and retry logic.
    /// Handles empty input, whitespace, invalid formats, and scientific notation.
    /// </summary>
    /// <param name="prompt">The prompt message to display to the user</param>
    /// <returns>A validated double value</returns>
    public static double GetNumberInput(string prompt)
    {
        while (true)
        {
            Console.Write(prompt);
            string? input = Console.ReadLine();
            
            // Handle null or empty input
            if (string.IsNullOrWhiteSpace(input))
            {
                Console.WriteLine("Error: Input cannot be empty. Please enter a number.");
                continue;
            }
            
            // Attempt to parse with support for scientific notation
            if (double.TryParse(input.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double result))
            {
                return result;
            }
            
            Console.WriteLine($"Error: '{input}' is not a valid number. Please try again.");
        }
    }
}
```

**Pattern Rationale:**
- Static class with static method for stateless utility function
- Infinite loop with `continue` for re-prompting on invalid input (meets "Target" acceptance criterion)
- Explicit handling of null/whitespace (meets "Exceptional" acceptance criterion)
- `NumberStyles.Float` supports scientific notation (meets "Exceptional" acceptance criterion)
- `CultureInfo.InvariantCulture` prevents locale-specific parsing issues (e.g., comma vs. period decimal separators)

#### File 3: `calculator/Operations.cs`

**Purpose:** Pure arithmetic functions with no I/O coupling.

**Implementation Details:**
```csharp
namespace Calculator;

/// <summary>
/// Contains pure arithmetic operation methods for the calculator.
/// All methods are static, deterministic, and free of side effects.
/// </summary>
public static class Operations
{
    /// <summary>
    /// Adds two numbers and returns the result.
    /// Supports integers, decimals, negative numbers, and scientific notation.
    /// </summary>
    /// <param name="a">First operand</param>
    /// <param name="b">Second operand</param>
    /// <returns>Sum of a and b</returns>
    /// <remarks>
    /// Note: Floating-point arithmetic may produce precision anomalies 
    /// (e.g., 0.1 + 0.2 = 0.30000000000000004) due to binary representation.
    /// This is expected behavior, not a bug.
    /// </remarks>
    public static double Add(double a, double b)
    {
        return a + b;
    }
    
    // Future operations will follow this signature pattern:
    // public static double Subtract(double a, double b) => a - b;
    // public static double Multiply(double a, double b) => a * b;
    // public static double Divide(double a, double b) => a / b;
}
```

**Pattern Rationale:**
- Pure function with no side effects (testable, predictable)
- XML documentation comments for IDE intellisense support
- Explicit documentation of floating-point precision behavior (addresses Risk #4 from Context Package)
- Method signature pattern (`static double OperationName(double a, double b)`) designed for consistency across all future operations

#### File 4: `calculator/Program.cs`

**Purpose:** Application orchestration and REPL loop.

**Implementation Details:**
```csharp
using System.Globalization;

namespace Calculator;

class Program
{
    static void Main(string[] args)
    {
        Console.WriteLine("=================================");
        Console.WriteLine("    Simple Calculator (v1.0)    ");
        Console.WriteLine("=================================");
        Console.WriteLine();
        
        while (true)
        {
            DisplayMenu();
            string? choice = Console.ReadLine()?.Trim().ToLower();
            
            if (string.IsNullOrEmpty(choice))
            {
                Console.WriteLine("Please select an option.
");
                continue;
            }
            
            switch (choice)
            {
                case "1":
                case "add":
                    PerformAddition();
                    break;
                
                case "exit":
                case "quit":
                case "q":
                    Console.WriteLine("Thank you for using Calculator. Goodbye!");
                    return;
                
                default:
                    Console.WriteLine($"Invalid option: '{choice}'. Please try again.
");
                    break;
            }
        }
    }
    
    static void DisplayMenu()
    {
        Console.WriteLine("Available Operations:");
        Console.WriteLine("  1. Addition");
        Console.WriteLine();
        Console.WriteLine("Enter your choice (or 'exit' to quit): ");
    }
    
    static void PerformAddition()
    {
        Console.WriteLine("
--- Addition ---");
        
        double num1 = InputHandler.GetNumberInput("Enter first number: ");
        double num2 = InputHandler.GetNumberInput("Enter second number: ");
        
        double result = Operations.Add(num1, num2);
        
        Console.WriteLine($"
Result: {num1} + {num2} = {result}");
        Console.WriteLine();
    }
}
```

**Pattern Rationale:**
- REPL (Read-Eval-Print-Loop) structure allows continuous operation without restarting application
- Menu-driven interface makes available operations visible to users
- Multiple exit commands (`exit`, `quit`, `q`) for user convenience (addresses Risk #7 from Context Package)
- `PerformAddition` method is extracted for clarity and future parallelism with `PerformSubtraction`, etc.
- Result display format shows the full equation (`5 + 3 = 8`) for transparency (meets "Target" UX acceptance criterion)

#### File 5: `calculator/README.md`

**Purpose:** Dedicated documentation for calculator application.

**Implementation Details:**
```markdown
# Calculator Console Application

A simple C# console calculator that performs basic arithmetic operations.

## Requirements

- .NET 6.0 SDK or later

## Build

From the `calculator` directory:

```bash
dotnet build
```

## Run

```bash
dotnet run
```

## Usage

1. Select an operation by entering the number (e.g., `1` for addition)
2. Enter the first number when prompted
3. Enter the second number when prompted
4. View the result
5. Select another operation or type `exit` to quit

## Supported Input Formats

- Integers: `42`, `-17`
- Decimals: `3.14`, `-0.5`
- Scientific notation: `1.5e10`, `2.3e-5`

## Current Operations

- Addition

## Future Operations (Planned)

- Subtraction
- Multiplication
- Division
```

**Rationale:** Self-contained documentation ensures the calculator can be understood and run independently from the parent repository's Node.js content.

#### File 6: Root `README.md` (Modification)

**Change:** Add calculator section to existing README.

**Implementation Details:**
Append the following section to the existing `README.md`:

```markdown
## Calculator

A C# console calculator application is located in the `/calculator` subdirectory.

See [calculator/README.md](calculator/README.md) for build and usage instructions.
```

**Rationale:** Minimal change that preserves existing documentation while making the new calculator project discoverable.

### Phase 3: Validation and Testing

**Manual Testing Checklist:**

1. **Build Verification:**
   ```bash
   cd calculator
   dotnet build
   ```
   Expected: Clean build with no errors or warnings

2. **Execution Test:**
   ```bash
   dotnet run
   ```
   Expected: Menu displays, application waits for input

3. **Happy Path (Positive Integers):**
   - Input: `1` (select addition)
   - Input: `5`
   - Input: `3`
   - Expected Output: `Result: 5 + 3 = 8`

4. **Decimal Support:**
   - Input: `1`
   - Input: `2.5`
   - Input: `3.7`
   - Expected Output: `Result: 2.5 + 3.7 = 6.2`

5. **Negative Numbers:**
   - Input: `1`
   - Input: `-10`
   - Input: `7`
   - Expected Output: `Result: -10 + 7 = -3`

6. **Scientific Notation:**
   - Input: `1`
   - Input: `1.5e2` (150)
   - Input: `2e1` (20)
   - Expected Output: `Result: 150 + 20 = 170`

7. **Invalid Input Handling:**
   - Input: `1`
   - Input: `abc`
   - Expected: Error message, re-prompt
   - Input: `5`
   - Input: `3`
   - Expected: Successful calculation

8. **Empty Input Handling:**
   - Input: `1`
   - Input: `` (press Enter without typing)
   - Expected: Error message about empty input, re-prompt

9. **Exit Flow:**
   - Input: `exit`
   - Expected: Goodbye message, application terminates cleanly

10. **Invalid Menu Choice:**
    - Input: `99`
    - Expected: Invalid option message, menu redisplays

**Acceptance Criteria Mapping:**

| Criterion | Test Coverage | Meets Tier |
|-----------|---------------|------------|
| Numeric Input Support | Tests 3-6 cover integers, decimals, negatives, scientific notation | Exceptional |
| Error Handling | Tests 7-8 validate graceful recovery with specific error messages | Exceptional |
| Result Accuracy | Tests 3-5 verify correct arithmetic | Target |
| User Experience | Tests 2, 9, 10 validate clear prompts and intuitive flow | Target |
| Code Quality | Separation of InputHandler, Operations, and Program classes | Target |

## Risk Surface

### Risk 1: Repository Confusion (HIGH Impact)

**Description:** The Context Package identified a critical mismatch between project description (C# calculator) and repository reality (Node.js property search API). Implementing C# code in a Node.js repository may confuse future developers or CI/CD pipelines.

**Mitigation Strategy:**
- **Isolation via Subdirectory:** Place all C# code in `/calculator` subdirectory with its own README
- **Clear Documentation:** Update root README to explicitly document multi-project structure
- **Independent Build:** Calculator has its own `.csproj` file and can be built/run independently with `dotnet` commands
- **Naming Clarity:** Calculator directory and files use unambiguous naming that cannot be confused with the backend API

**Residual Risk:** LOW — Subdirectory pattern is standard practice for monorepos. Clear documentation mitigates confusion.

**Human Review Required:** Confirm that multi-project repository structure aligns with project goals. If Calculator should be in a separate repository, this orbit should be deferred pending repository creation.

### Risk 2: Pattern Propagation (HIGH Impact)

**Description:** Poor architectural decisions in this orbit will be replicated across subtraction, multiplication, and division implementations, creating compounding technical debt.

**Mitigation Strategy:**
- **Clean Separation of Concerns:** Three distinct classes (InputHandler, Operations, Program) with clear responsibilities
- **Stateless Design:** All methods are static and stateless, avoiding hidden dependencies
- **Consistent Signatures:** `Operations.Add` establishes the `double OperationName(double a, double b)` pattern
- **Reusable Components:** `GetNumberInput` is designed for reuse by all future operations
- **XML Documentation:** Clear documentation of design intent and usage patterns

**Residual Risk:** MEDIUM — The proposed architecture is sound, but only human review can confirm it meets unstated organizational standards.

**Human Review Required:** Explicitly validate that the three-class architecture (InputHandler, Operations, Program) aligns with team conventions before marking orbit complete.

### Risk 3: Floating-Point Precision Expectations (MEDIUM Impact)

**Description:** Users may report "bugs" when they observe `0.1 + 0.2 = 0.30000000000000004` due to binary floating-point representation.

**Mitigation Strategy:**
- **Documentation:** `Operations.Add` includes XML comment explicitly documenting floating-point precision behavior
- **Type Choice:** `double` is appropriate for general arithmetic; if exact decimal precision is needed, this would require switching to `decimal` type (out of scope for this orbit)
- **Acceptance:** The Intent Document's "Exceptional" acceptance tier includes "handles floating-point precision edge cases appropriately" — documentation constitutes appropriate handling

**Residual Risk:** LOW — This is a known characteristic of IEEE 754 floating-point arithmetic, not a defect.

**Human Review Required:** None — behavior is documented and expected.

### Risk 4: Input Validation Edge Cases (MEDIUM Impact)

**Description:** Users may input edge cases not covered by basic `double.TryParse` logic.

**Mitigation Strategy:**
- **Whitespace Handling:** Input is trimmed before parsing
- **Empty Input:** Explicit null/whitespace check with specific error message
- **Scientific Notation:** `NumberStyles.Float` supports scientific notation (e.g., `1.5e10`)
- **Locale Independence:** `CultureInfo.InvariantCulture` prevents culture-specific parsing issues
- **Infinity Handling:** `double.TryParse` natively handles `Infinity` and `-Infinity` as valid parse results
- **NaN Handling:** `double.TryParse` will fail on "NaN" input, triggering re-prompt

**Edge Cases Covered:**
- ✅ Empty input
- ✅ Whitespace-only input
- ✅ Scientific notation
- ✅ Very large numbers (become Infinity)
- ✅ Invalid text

**Edge Cases NOT Covered (Accepted):**
- ❌ Thousands separators (e.g., "1,000" will fail to parse)
- ❌ Currency symbols (e.g., "$5.00" will fail to parse)
- ❌ Hexadecimal notation (e.g., "0xFF" will fail to parse)

**Residual Risk:** LOW — Thousands separators and currency symbols are out of scope for a basic calculator.

**Human Review Required:** Confirm that thousands separator support is not required. If needed, add `NumberStyles.AllowThousands` flag.

### Risk 5: Exit Strategy Ambiguity (LOW Impact)

**Description:** Users may not know how to exit the application.

**Mitigation Strategy:**
- **Multiple Exit Commands:** Accept `exit`, `quit`, and `q` as exit commands
- **Menu Visibility:** "or 'exit' to quit" is displayed in every menu prompt
- **Ctrl+C Support:** Standard console termination (Ctrl+C) works without additional handling
- **Clear Feedback:** Goodbye message confirms successful exit

**Residual Risk:** NEGLIGIBLE — Exit mechanism is standard and well-documented.

**Human Review Required:** None.

### Risk 6: .NET Version Availability (MEDIUM Impact)

**Description:** Target environment may not have .NET 6.0 installed.

**Mitigation Strategy:**
- **LTS Version:** .NET 6.0 is a Long-Term Support release (supported until November 2024)
- **Explicit Documentation:** `calculator/README.md` explicitly states .NET 6.0 requirement
- **Upgrade Path:** If .NET 6.0 is unavailable, changing `<TargetFramework>net6.0</TargetFramework>` to `net7.0` or `net8.0` is trivial

**Residual Risk:** LOW — .NET 6.0 is widely available. If unavailable, the fix is a one-line project file change.

**Human Review Required:** Confirm .NET 6.0 is available in target environment. If not, specify alternative version.

### Risk 7: Console Encoding Issues (LOW Impact)

**Description:** Special characters in output (e.g., mathematical symbols) may not render on all terminals.

**Mitigation Strategy:**
- **ASCII-Only Output:** Current implementation uses only ASCII characters (`+`, `=`, `-`) that render on all consoles
- **No Unicode Dependency:** No unicode mathematical symbols (e.g., `×`, `÷`, `≈`) are used

**Residual Risk:** NEGLIGIBLE — Current implementation avoids encoding issues entirely.

**Human Review Required:** None.

## Scope Estimate

### Complexity Assessment

**Overall Complexity:** LOW

**Rationale:**
- Core addition logic is trivial (`a + b`)
- Input validation uses standard library methods (`double.TryParse`)
- No external dependencies, database interactions, or network calls
- Console I/O is straightforward with `System.Console` APIs

**Complexity Factors:**
- ✅ Simple arithmetic operation
- ✅ Standard library usage only
- ✅ No concurrency or threading
- ✅ No file I/O or persistence
- ⚠️ Foundational architecture establishment requires careful design
- ⚠️ Repository structure mismatch requires clarification

### Work Breakdown

| Phase | Tasks | Estimated Effort |
|-------|-------|------------------|
| **Repository Setup** | Create `/calculator` directory, initialize `.csproj` | 15 minutes |
| **Core Implementation** | Write InputHandler, Operations, Program classes | 45 minutes |
| **Documentation** | Write calculator README, update root README | 15 minutes |
| **Manual Testing** | Execute 10-point test checklist | 30 minutes |
| **Human Review** | Architectural validation, pattern approval | 30 minutes |
| **Refinement** | Address review feedback (if any) | 15 minutes |

**Total Estimated Effort:** 2.5 hours (single orbit)

### Orbit Count

**Estimated Orbits:** 1

**Rationale:**
- All deliverables (InputHandler, Operations, Program, documentation) fit within a single cohesive orbit
- No external dependencies or prerequisite orbits
- Scope is well-defined with clear acceptance criteria
- Implementation is straightforward with minimal unknowns

**Single Orbit Confidence:** HIGH

### Success Criteria for Orbit Completion

This orbit is complete when:

1. ✅ All five files are created and committed to repository
2. ✅ `dotnet build` succeeds with zero errors
3. ✅ `dotnet run` launches application successfully
4. ✅ All 10 manual test cases pass
5. ✅ Human reviewer confirms architectural patterns are appropriate for replication
6. ✅ Repository structure (multi-project vs. single-project) is clarified and documented

## Human Modifications

Pending human review.