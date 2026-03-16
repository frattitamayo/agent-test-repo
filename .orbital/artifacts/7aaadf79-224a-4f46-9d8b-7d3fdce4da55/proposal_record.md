# Proposal Record: Addition Operation for Calculator

## Interpreted Intent

This orbit establishes the foundational C# console calculator application with addition functionality as the first arithmetic operation. The implementation must create the entire project structure from scratch, as the repository currently contains only unrelated Node.js property search code.

**Core Requirements:**
- Build a C# console application that prompts users for two numeric values, adds them, and displays the result in the format "Result: [num1] + [num2] = [sum]"
- Validate numeric input with the error message "Invalid input: please enter a numeric value" for non-numeric entries
- Support the full range and precision of C# `double` type (±1.7E+308, 15 significant digits)
- Complete addition operations within 100ms with <1KB memory allocation
- Provide an operation selection menu (even though only addition is implemented initially)
- Establish architectural patterns that future operations (subtraction, multiplication, division) will follow

**Critical Distinction:** This is not merely implementing an addition method — it is architecting the entire calculator application framework, making the pattern choices that will impact all subsequent orbits in the trajectory.

## Implementation Plan

### Phase 1: Project Initialization

**File:** `Calculator.csproj` (new file at repository root)

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net6.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
```

**Purpose:** Define the project as a .NET 6.0 console executable with modern C# features enabled.

**Technical Details:**
- `<OutputType>Exe</OutputType>` creates a console application
- `<TargetFramework>net6.0</TargetFramework>` uses .NET 6 LTS (cross-platform, stable)
- `<ImplicitUsings>enable</ImplicitUsings>` auto-includes common namespaces like `System`
- `<Nullable>enable</Nullable>` enforces null safety at compile time

### Phase 2: Core Application Structure

**File:** `Program.cs` (new file at repository root)

**Architecture Decision:** Implement method-based organization within a single file. All logic resides in `Program.cs` with static methods for:
- Main application loop
- Operation menu display
- Numeric input collection with validation
- Addition calculation
- Result display

**Implementation Structure:**

```csharp
// Top-level statements (C# 9.0+)
// Entry point without explicit Main method boilerplate

bool running = true;

while (running)
{
    DisplayMenu();
    string? choice = Console.ReadLine();
    
    switch (choice)
    {
        case "1":
            PerformAddition();
            break;
        case "2":
            Console.WriteLine("Exit selected.");
            running = false;
            break;
        default:
            Console.WriteLine("Invalid choice. Please select 1 or 2.");
            break;
    }
    
    if (running)
    {
        Console.WriteLine("
Press any key to continue...");
        Console.ReadKey();
        Console.Clear();
    }
}

static void DisplayMenu()
{
    Console.WriteLine("=== Calculator ===");
    Console.WriteLine("1. Addition");
    Console.WriteLine("2. Exit");
    Console.Write("
Select an operation: ");
}

static void PerformAddition()
{
    Console.WriteLine("
--- Addition ---");
    
    double firstNumber = GetNumericInput("Enter first number: ");
    double secondNumber = GetNumericInput("Enter second number: ");
    
    double result = firstNumber + secondNumber;
    
    // Check for overflow/underflow conditions
    if (double.IsInfinity(result))
    {
        Console.WriteLine($"
Result: {firstNumber} + {secondNumber} = Infinity (overflow)");
    }
    else if (double.IsNaN(result))
    {
        Console.WriteLine($"
Result: {firstNumber} + {secondNumber} = NaN (undefined)");
    }
    else
    {
        Console.WriteLine($"
Result: {firstNumber} + {secondNumber} = {result}");
    }
}

static double GetNumericInput(string prompt)
{
    while (true)
    {
        Console.Write(prompt);
        string? input = Console.ReadLine();
        
        if (double.TryParse(input, out double number))
        {
            return number;
        }
        
        Console.WriteLine("Invalid input: please enter a numeric value");
    }
}
```

**Method Breakdown:**

| Method | Responsibility | Input | Output | Rationale |
|--------|---------------|-------|--------|-----------|
| `DisplayMenu()` | Show operation choices | None | Console output | Centralized menu display; easy to extend with new operations |
| `PerformAddition()` | Orchestrate addition flow | None | Console output | Single entry point for addition operation; handles full workflow |
| `GetNumericInput(string)` | Validate and parse numeric input | Prompt text | `double` value | Reusable validation logic; infinite retry until valid input |

**Control Flow:**
1. Application enters infinite loop (`while (running)`)
2. Display menu and await user choice
3. Switch on choice: "1" triggers addition, "2" exits, others show error
4. After operation, pause for user acknowledgment
5. Clear screen and redisplay menu

### Phase 3: README Update

**File:** `README.md` (modify existing file)

Replace entire content with:

```markdown
# Calculator

A console-based calculator application written in C# supporting basic arithmetic operations.

## Current Features

- **Addition:** Add two numbers together

## Planned Features

- Subtraction
- Multiplication
- Division

## Requirements

- .NET 6.0 SDK or higher

## Building the Project

From the repository root:

```bash
dotnet build
```

## Running the Calculator

```bash
dotnet run
```

## Usage

1. Select an operation from the menu (currently only addition available)
2. Enter the first number when prompted
3. Enter the second number when prompted
4. View the result
5. Press any key to return to the menu

## Supported Input

- Integers: `5`, `-42`, `0`
- Decimals: `3.14`, `-0.5`, `2.718281828`
- Scientific notation: `1.5e10`, `-3.2e-5`
- Range: ±1.7E+308 (double precision)

## Error Handling

- Non-numeric input prompts re-entry with message: "Invalid input: please enter a numeric value"
- Overflow results display as "Infinity"
- Invalid operations display as "NaN"
```

**Purpose:** Provide clear instructions for building and running the calculator. Documents current capabilities and planned trajectory.

### Phase 4: Legacy File Cleanup

**Decision:** Do NOT delete `backend/` directory or existing Node.js files in this orbit.

**Rationale:**
- Unclear if other systems depend on these files
- Deletion is a destructive operation outside the scope of "add calculator functionality"
- Future orbit can address repository cleanup after calculator foundation is established
- Coexistence of unrelated files is acceptable during initial development

### Implementation Order

1. Create `Calculator.csproj` (defines project structure)
2. Create `Program.cs` (implements functionality)
3. Update `README.md` (documents usage)
4. Commit all three changes together as atomic unit

### Dependency Chain

- `Program.cs` depends on `Calculator.csproj` (project must exist to compile code)
- `README.md` has no dependencies (documentation only)
- No external package dependencies required

### Build and Execution Commands

**Build:**
```bash
dotnet build Calculator.csproj
```

**Run:**
```bash
dotnet run --project Calculator.csproj
```

Or from repository root after build:
```bash
dotnet Calculator.dll
```

## Risk Surface

### Implementation Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **User enters Ctrl+C during input prompt** | Low | Acceptable behavior; CLR handles gracefully with process termination |
| **Very large numbers cause scientific notation in output** | Low | Accept .NET default formatting; future orbit can add custom formatting |
| **Infinite retry loop if validation logic broken** | Medium | Validation logic is minimal (`double.TryParse`); human review will catch errors |
| **Menu choice validation incomplete** | Low | Default case in switch statement catches invalid choices with error message |

### Edge Case Coverage

**Numeric Input Edge Cases:**

| Input | Expected Behavior | Validation |
|-------|------------------|------------|
| `"abc"` | Retry with error message | `double.TryParse` returns false |
| `""` (empty) | Retry with error message | `double.TryParse` returns false |
| `"1.2.3"` | Retry with error message | `double.TryParse` returns false |
| `"∞"` | Retry with error message | `double.TryParse` returns false |
| `"1e308"` | Accepted as valid | Within double range |
| `"1e309"` | Parsed as `Infinity` | Overflow handled with infinity check |

**Arithmetic Edge Cases:**

| Operation | Result | Handling |
|-----------|--------|----------|
| `1e308 + 1e308` | `Infinity` | `double.IsInfinity()` check displays overflow message |
| `5 + 0` | `5` | Normal operation |
| `-3 + 7` | `4` | Normal operation |
| `0.1 + 0.2` | `0.30000000000000004` | IEEE 754 floating-point behavior; acceptable per Intent |
| `-1e308 + (-1e308)` | `-Infinity` | `double.IsInfinity()` check displays overflow message |

### Performance Validation

**Response Time Analysis:**
- `Console.ReadLine()`: 0-5ms (I/O bound, user input time excluded)
- `double.TryParse()`: <0.1ms (native CLR parsing)
- Addition operation: <0.001ms (single CPU instruction)
- `Console.WriteLine()`: 0-5ms (I/O bound)
- **Total:** <11ms well under 100ms constraint

**Memory Allocation Analysis:**
- `double` primitives: 16 bytes (2 inputs, 1 result) — stack allocated
- String formatting for output: ~100 bytes heap allocation
- Menu strings: ~200 bytes (constant, one-time allocation)
- **Total:** ~316 bytes, well under 1KB constraint

### Security Considerations

**Assessment:** Minimal attack surface for console application with no external I/O.

**Potential Vectors:**
- **Input Buffer Overflow:** Not possible — .NET `Console.ReadLine()` returns managed string
- **Code Injection:** Not possible — no dynamic code execution or eval
- **Resource Exhaustion:** User can spam input, but impact limited to local process
- **Data Exfiltration:** No data storage or network communication

**Conclusion:** No security mitigations required beyond standard .NET CLR protections.

### Extensibility Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Adding 3 more operations requires 3 more switch cases** | Low | Acceptable technical debt for 4 total operations |
| **No abstraction for operation pattern** | Medium | Document pattern clearly; refactor threshold at 5+ operations |
| **Tight coupling of UI and logic** | Medium | Separate `PerformAddition()` (UI flow) from addition arithmetic (implicit); good enough for MVP |

**Refactor Trigger:** If calculator expands beyond 4 basic operations, recommend interface-based operation pattern:
```csharp
interface IOperation { string Name { get; } double Execute(double a, double b); }
```

## Scope Estimate

### Complexity Assessment

**Overall Complexity:** Low

- **File Count:** 2 new files + 1 modification
- **Lines of Code:** ~80 lines of C# (including whitespace/comments)
- **New Concepts:** None — standard console I/O and arithmetic
- **External Dependencies:** Zero
- **Testing Surface:** Manual testing only (no unit test framework in scope)

### Work Breakdown

| Phase | Effort | Description |
|-------|--------|-------------|
| **Project File Creation** | 5 minutes | Copy/paste `.csproj` template |
| **Program.cs Implementation** | 30 minutes | Write menu, validation, addition logic |
| **Code Review** | 10 minutes | Verify against Intent acceptance criteria |
| **README Update** | 10 minutes | Document build and usage instructions |
| **Build and Test** | 10 minutes | Compile, run, test edge cases |
| **Commit and Documentation** | 5 minutes | Git commit with descriptive message |

**Total Estimated Effort:** 70 minutes (1.2 hours)

### Orbit Count

**This Implementation:** 1 orbit (current)

**Rationale:** All work fits within single cohesive unit:
- Project initialization and addition implementation are inseparable
- Cannot meaningfully test addition without project structure
- Splitting into 2 orbits (structure + addition) adds overhead without value

### Success Criteria Mapping

| Intent Acceptance Criterion | Implementation Artifact | Verification Method |
|------------------------------|------------------------|---------------------|
| Add two numbers correctly | `PerformAddition()` method with `+` operator | Manual test cases |
| Support double precision range | `double` type usage | Type system guarantee |
| Validate numeric input | `GetNumericInput()` with `double.TryParse` | Invalid input testing |
| Display error message | `Console.WriteLine` in validation loop | Manual observation |
| Format output correctly | String interpolation in result display | Manual observation |
| Provide operation menu | `DisplayMenu()` method | Manual observation |
| Complete within 100ms | Native arithmetic + console I/O | Performance test (optional) |
| Allocate <1KB memory | Primitive stack allocation | Memory profiler (optional) |

## Human Modifications

Pending human review.