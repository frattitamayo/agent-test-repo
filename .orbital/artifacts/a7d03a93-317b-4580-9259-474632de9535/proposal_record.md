# Proposal Record: Addition Operation for Calculator

## Interpreted Intent

The goal is to create a functional C# console calculator application with addition capability as the foundational operation. Users will interact via command-line prompts to enter two numbers, and the calculator will display the sum in a formatted output string. The implementation must establish architectural patterns that enable future expansion to subtraction, multiplication, and division without refactoring the addition code.

This is a greenfield implementation — no calculator code currently exists in the repository. The solution must prioritize:

1. **Accuracy**: Use `decimal` type to avoid floating-point precision errors
2. **Resilience**: Handle invalid input and overflow gracefully without crashing
3. **Extensibility**: Create an interface-based architecture that scales to additional operations
4. **Simplicity**: Console-only interface with clear prompts and error messages

The addition operation itself is straightforward arithmetic, but this orbit's true value is establishing the code structure, error handling patterns, and user interaction flow that subsequent operations will replicate.

## Implementation Plan

### Phase 1: Project Structure Setup

**Create: `Calculator.csproj`**
- Target framework: .NET 6.0 (LTS version with broad compatibility)
- Output type: Console application
- Enable nullable reference types for null safety
- Root namespace: `Calculator`

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net6.0</TargetFramework>
    <Nullable>enable</Nullable>
    <RootNamespace>Calculator</RootNamespace>
  </PropertyGroup>
</Project>
```

**Create: Directory structure**
```
Calculator/
├── Calculator.csproj
├── Program.cs
├── Core/
│   └── CalculatorEngine.cs
├── Operations/
│   ├── IOperation.cs
│   └── Addition.cs
└── Utils/
    └── InputValidator.cs
```

### Phase 2: Core Abstractions

**Create: `Operations/IOperation.cs`**

Define the operation contract that all arithmetic operations will implement:

```csharp
namespace Calculator.Operations
{
    /// <summary>
    /// Defines the contract for calculator arithmetic operations
    /// </summary>
    public interface IOperation
    {
        /// <summary>
        /// Human-readable name of the operation
        /// </summary>
        string Name { get; }
        
        /// <summary>
        /// Symbol representing the operation (e.g., "+", "-")
        /// </summary>
        string Symbol { get; }
        
        /// <summary>
        /// Executes the operation on two operands
        /// </summary>
        /// <param name="operand1">First operand</param>
        /// <param name="operand2">Second operand</param>
        /// <returns>Result of the operation</returns>
        /// <exception cref="OverflowException">When result exceeds decimal range</exception>
        decimal Execute(decimal operand1, decimal operand2);
    }
}
```

**Create: `Utils/InputValidator.cs`**

Centralize input parsing and validation logic:

```csharp
namespace Calculator.Utils
{
    public static class InputValidator
    {
        /// <summary>
        /// Attempts to parse user input into a decimal number
        /// </summary>
        /// <param name="input">Raw string input from console</param>
        /// <param name="value">Parsed decimal value if successful</param>
        /// <param name="errorMessage">Detailed error message if parsing fails</param>
        /// <returns>True if parsing succeeded, false otherwise</returns>
        public static bool TryParseDecimal(string? input, out decimal value, out string errorMessage)
        {
            value = 0;
            errorMessage = string.Empty;
            
            // Handle null or whitespace-only input
            if (string.IsNullOrWhiteSpace(input))
            {
                errorMessage = "Input cannot be empty. Please enter a numeric value.";
                return false;
            }
            
            // Trim and attempt parse
            string trimmedInput = input.Trim();
            if (decimal.TryParse(trimmedInput, out value))
            {
                return true;
            }
            
            errorMessage = $"Invalid input: '{trimmedInput}' is not a valid number. Please enter a numeric value.";
            return false;
        }
    }
}
```

### Phase 3: Addition Operation Implementation

**Create: `Operations/Addition.cs`**

Implement the addition operation with overflow protection:

```csharp
namespace Calculator.Operations
{
    /// <summary>
    /// Performs addition of two decimal numbers
    /// </summary>
    public class Addition : IOperation
    {
        public string Name => "Addition";
        public string Symbol => "+";
        
        public decimal Execute(decimal operand1, decimal operand2)
        {
            try
            {
                // Use checked context to detect overflow
                return checked(operand1 + operand2);
            }
            catch (OverflowException)
            {
                throw new OverflowException(
                    "Calculation error: Result exceeds maximum supported value.");
            }
        }
    }
}
```

### Phase 4: Calculator Engine

**Create: `Core/CalculatorEngine.cs`**

Orchestrate the calculation flow with user interaction:

```csharp
using Calculator.Operations;
using Calculator.Utils;

namespace Calculator.Core
{
    /// <summary>
    /// Orchestrates calculator operations and user interaction
    /// </summary>
    public class CalculatorEngine
    {
        private readonly IOperation _operation;
        
        public CalculatorEngine(IOperation operation)
        {
            _operation = operation;
        }
        
        /// <summary>
        /// Executes a single calculation with user input prompts
        /// </summary>
        /// <returns>True if calculation completed successfully, false if user wants to exit</returns>
        public bool RunCalculation()
        {
            Console.WriteLine($"
Calculator - {_operation.Name}");
            Console.WriteLine(new string('-', 40));
            
            // Get first operand
            decimal operand1 = GetOperandFromUser("Enter first number: ");
            
            // Get second operand
            decimal operand2 = GetOperandFromUser("Enter second number: ");
            
            // Perform calculation with error handling
            try
            {
                decimal result = _operation.Execute(operand1, operand2);
                Console.WriteLine($"
Result: {operand1} {_operation.Symbol} {operand2} = {result}");
                return true;
            }
            catch (OverflowException ex)
            {
                Console.WriteLine($"
Error: {ex.Message}");
                return true; // Continue running despite error
            }
        }
        
        private decimal GetOperandFromUser(string prompt)
        {
            while (true)
            {
                Console.Write(prompt);
                string? input = Console.ReadLine();
                
                if (InputValidator.TryParseDecimal(input, out decimal value, out string errorMessage))
                {
                    return value;
                }
                
                Console.WriteLine($"Error: {errorMessage}");
                Console.WriteLine("Please try again.
");
            }
        }
    }
}
```

### Phase 5: Application Entry Point

**Create: `Program.cs`**

Main entry point with application loop:

```csharp
using Calculator.Core;
using Calculator.Operations;

namespace Calculator
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("===========================================");
            Console.WriteLine("       Welcome to Calculator v1.0");
            Console.WriteLine("===========================================");
            
            // Initialize calculator with addition operation
            var additionOperation = new Addition();
            var calculator = new CalculatorEngine(additionOperation);
            
            bool continueRunning = true;
            
            while (continueRunning)
            {
                // Run calculation
                calculator.RunCalculation();
                
                // Prompt for continuation
                Console.WriteLine("
" + new string('-', 40));
                Console.Write("Press 'Q' to quit or any other key to continue: ");
                
                var key = Console.ReadKey();
                Console.WriteLine(); // New line after key press
                
                if (key.Key == ConsoleKey.Q)
                {
                    continueRunning = false;
                }
            }
            
            Console.WriteLine("
Thank you for using Calculator!");
        }
    }
}
```

### Phase 6: Documentation Update

**Modify: `README.md`**

Replace property search documentation with calculator instructions:

```markdown
# Calculator Console Application

A simple C# console calculator supporting basic arithmetic operations.

## Current Features

- Addition of two decimal numbers
- Overflow detection and error handling
- Input validation with clear error messages

## Requirements

- .NET 6.0 SDK or higher

## Building the Application

From the repository root:

```bash
cd Calculator
dotnet build
```

## Running the Application

```bash
cd Calculator
dotnet run
```

## Usage

1. The application will prompt for two numbers
2. Enter each number and press Enter
3. The result will be displayed
4. Press any key to perform another addition, or 'Q' to quit

## Supported Input Formats

- Integers: `42`, `-17`, `0`
- Decimals: `3.14159`, `-0.5`, `100.00`
- Large numbers within decimal range: Up to 28-29 significant digits

## Architecture

- `Program.cs` - Application entry point and main loop
- `Core/CalculatorEngine.cs` - Orchestrates operations and I/O
- `Operations/IOperation.cs` - Interface for arithmetic operations
- `Operations/Addition.cs` - Addition implementation
- `Utils/InputValidator.cs` - Input parsing and validation

## Future Enhancements

- Subtraction, multiplication, and division operations
- Operation selection menu
- Calculation history
```

### Execution Order

1. Create project file (`Calculator.csproj`)
2. Create directory structure (`Core/`, `Operations/`, `Utils/`)
3. Implement interface (`IOperation.cs`)
4. Implement utilities (`InputValidator.cs`)
5. Implement addition operation (`Addition.cs`)
6. Implement calculator engine (`CalculatorEngine.cs`)
7. Implement entry point (`Program.cs`)
8. Update documentation (`README.md`)
9. Build and test

### Dependencies

- .NET 6.0 SDK (external, must be installed on development machine)
- No NuGet packages required — uses only .NET BCL types

## Risk Surface

### Risk 1: Decimal Overflow Not Caught

**Description:** The `checked` keyword in `Addition.Execute()` detects overflow at compile time for constants, but may not catch all runtime overflow scenarios.

**Mitigation:**
- Explicitly wrap addition in try-catch for `OverflowException`
- Test with edge cases: `decimal.MaxValue + 1`, `decimal.MinValue - 1`
- Verification protocol must include overflow test cases

**Likelihood:** Low (decimal range is vast: ±7.9×10²⁸)  
**Impact:** Medium (crashes application if unhandled)

### Risk 2: Input Validation Bypass

**Description:** `InputValidator.TryParseDecimal()` uses default `decimal.TryParse()` behavior, which may accept inputs not intended (e.g., hexadecimal with `0x` prefix if `NumberStyles` isn't restricted).

**Mitigation:**
- Explicitly specify `NumberStyles.Number` in `decimal.TryParse()` call
- Add unit tests for edge cases: "0x10", "1e5", "∞", "NaN"
- Document supported input formats in README

**Likelihood:** Low (default TryParse is generally safe)  
**Impact:** Low (unexpected parse success, but result still valid decimal)

### Risk 3: Console Encoding Issues

**Description:** Console may not display decimal results correctly if user's console encoding doesn't support decimal separator or negative sign characters.

**Mitigation:**
- Use standard ASCII characters (period for decimal, hyphen for negative)
- Avoid Unicode symbols in output formatting
- Test on Windows CMD, PowerShell, and Linux/Mac terminals

**Likelihood:** Very Low (ASCII decimal notation is universal)  
**Impact:** Low (display issue only, calculation remains correct)

### Risk 4: Infinite Loop on Console Input Failure

**Description:** `GetOperandFromUser()` loops until valid input is received. If `Console.ReadLine()` returns null repeatedly (e.g., stdin closed), this creates infinite loop.

**Mitigation:**
- Check for null return from `Console.ReadLine()` and treat as exit signal
- Add maximum retry count (optional, but adds complexity)
- Document that Ctrl+C always works as emergency exit

**Likelihood:** Very Low (stdin closure is rare in normal usage)  
**Impact:** Medium (application hangs)

### Risk 5: Pattern Misalignment with Future Operations

**Description:** Addition implementation may establish patterns that are suboptimal for division (divide-by-zero) or other operations with distinct error cases.

**Mitigation:**
- Keep operation logic minimal — only arithmetic and overflow checking
- Move all validation to `InputValidator` or operation-specific validators
- Human review (Tier 2) validates extensibility before subsequent orbits

**Likelihood:** Medium (first implementation often needs refinement)  
**Impact:** Low (requires minor refactoring, no data loss risk)

### Risk 6: README Replacement Disrupts Other Work

**Description:** Current README documents property search functionality. Complete replacement may confuse developers working on that feature.

**Mitigation:**
- Inspect `backend/` directory more closely — if active, keep README generic and link to separate docs
- For this proposal: Assume property search is legacy/deprecated based on greenfield calculator project
- Add note at top of README: "This repository is being repurposed for calculator development"

**Likelihood:** Low (project description indicates calculator is primary purpose)  
**Impact:** Low (documentation confusion, not code impact)

## Scope Estimate

### Complexity Assessment: Low-Medium

- **Implementation Complexity:** Low — straightforward C# console app with basic arithmetic
- **Architectural Complexity:** Medium — establishing extensible patterns for future operations
- **Testing Complexity:** Low — deterministic pure functions with clear inputs/outputs

### Orbit Breakdown

**Current Orbit (Orbit 1): Addition Operation**
- 5 new files (4 code files + 1 project file)
- 1 modified file (README.md)
- Estimated 200-250 lines of code (including comments and whitespace)
- Development time: 2-3 hours for implementation + testing
- Review time: 1 hour for Tier 2 architectural validation

### Work Phases

| Phase | Deliverable | Estimated Time |
|-------|-------------|----------------|
| Setup | Project file and directory structure | 15 minutes |
| Abstractions | `IOperation` interface and `InputValidator` | 30 minutes |
| Core Logic | `Addition` implementation and `CalculatorEngine` | 45 minutes |
| Integration | `Program.cs` and application loop | 30 minutes |
| Documentation | README update | 15 minutes |
| Manual Testing | Smoke tests and edge cases | 30 minutes |
| **Total** | **Complete addition feature** | **~2.5 hours** |

### Future Orbit Estimates

Assuming this orbit's architecture is validated:

- **Orbit 2 (Subtraction):** 30 minutes — single new operation class following established pattern
- **Orbit 3 (Multiplication):** 30 minutes — single new operation class
- **Orbit 4 (Division):** 45 minutes — includes divide-by-zero handling
- **Orbit 5 (Operation Menu):** 1 hour — refactor `Program.cs` to support operation selection

### Success Criteria for Scope Validation

- All 5 files compile without errors
- Application runs and completes at least one successful addition
- Invalid input prompts for re-entry without crashing
- Overflow on extreme inputs displays error message
- README accurately describes build and run process

## Human Modifications

Pending human review.