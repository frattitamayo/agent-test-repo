# Addition and Subtraction Operations

## Desired Outcome

Users of the Calculator console application can select addition or subtraction operations from the menu, input two numbers for each operation, and receive accurate results. The calculator performs standard arithmetic addition (combining two numbers) and subtraction (finding the difference between two numbers) with full support for positive, negative, and decimal operands. Both operations integrate seamlessly into the existing calculator interface, following the same interaction patterns established by the multiplication operation.

## Constraints

### User Experience
- Addition must appear as option "1" in the operation menu
- Subtraction must appear as option "2" in the operation menu
- Input prompts must match the language and formatting of existing operations ("Enter first number:", "Enter second number:")
- Result display must follow the established format: "Result of addition: [value]" and "Result of subtraction: [value]"
- Error messages for invalid input must be clear, non-technical, and actionable

### Technical Boundaries
- Implementation must be in C# using .NET 6.0 or later
- Addition logic must reside in the `Calculator.cs` class as an `Add(double a, double b)` method
- Subtraction logic must reside in the `Calculator.cs` class as a `Subtract(double a, double b)` method
- No third-party dependencies beyond the standard .NET libraries
- No exception handling required for addition or subtraction (all `double` operations are mathematically valid)
- Floating-point precision is acceptable; no need for arbitrary-precision arithmetic

### Non-Goals
- This orbit does NOT include division or modulo operations
- This orbit does NOT implement chaining of operations (e.g., "add 3 numbers")
- This orbit does NOT require internationalization of decimal separators
- This orbit does NOT add batch processing or expression parsing capabilities
- This orbit does NOT include absolute value, negation, or other unary operations

## Acceptance Boundaries

### Functional Correctness
- **Minimum:** Addition and subtraction of positive integers produce correct results (e.g., 5 + 3 = 8, 10 - 4 = 6)
- **Target:** Both operations handle all numeric input types supported by C# `double`: positive, negative, zero, and decimal values
- **Stretch:** Operations accurately handle edge cases like very large numbers without overflow and maintain precision for scientific notation inputs

### Error Handling
- **Minimum:** Invalid numeric input (non-numeric strings) is rejected with a clear error message
- **Target:** Input validation provides specific feedback distinguishing between different input errors
- **Stretch:** Near-limit numeric values (approaching `double.MaxValue` or `double.MinValue`) are handled gracefully

### Test Coverage
- **Minimum:** Unit tests verify correct results for positive integer addition and subtraction
- **Target:** Unit tests cover negative numbers, decimal operands, zero operands, and mixed sign operations
- **Stretch:** Tests include boundary cases for floating-point limits and precision expectations

### Integration Quality
- **Minimum:** Addition and subtraction operations appear in the menu and execute without breaking existing operations
- **Target:** Console output formatting matches existing operations; users can execute multiple operations in succession
- **Stretch:** User can seamlessly switch between all calculator operations without any UX friction

## Trust Tier Assignment

**Assigned Tier:** Tier 2 (Supervised)

**Rationale:**
This orbit operates at Tier 2 because it introduces the foundational arithmetic operations into the calculator codebase. While addition and subtraction are mathematically straightforward operations with no error-prone edge cases (unlike division), this is the first time these specific operations are being implemented in this codebase, and they establish critical patterns for user interaction and code structure.

**Risk Factors Supporting Tier 2:**
- These are the first arithmetic operations being added to the calculator (multiplication already exists per orbit 634a82e2)
- The operations set the precedent for method signatures, naming conventions, and UI patterns that future operations will follow
- Menu numbering as options "1" and "2" affects the overall menu structure and user flow
- Integration into `Program.cs` establishes the operation dispatch pattern

**Mitigations Enabling Tier 2 (vs. Tier 3):**
- Addition and subtraction have no mathematical edge cases requiring complex error handling (all `double + double` and `double - double` operations are valid)
- The codebase is small and testable with clear unit test coverage expectations
- The console application has no external dependencies or data persistence
- Multiplication operation (orbit 634a82e2) already exists as a reference pattern
- Operations are well-defined with no ambiguous requirements

Autonomous execution (Tier 1) is not appropriate because this is establishing foundational patterns in the codebase. Human verification ensures the menu structure, output formatting, and interaction flow meet user expectations and align with the existing multiplication implementation.

## Dependencies

### Prior Orbits
- **Orbit 634a82e2** (Multiplication): This orbit established the pattern for implementing arithmetic operations in `Calculator.cs` and the test structure in `CalculatorTests.cs`. Addition and subtraction should follow the same architectural and testing patterns for consistency.

### Existing Codebase Elements
- **Calculator.cs**: Must be extended with `Add(double a, double b)` and `Subtract(double a, double b)` methods
- **Program.cs**: Menu system must include options "1. Add" and "2. Subtract" and handle the operation dispatch flow for both
- **CalculatorTests.cs**: Test suite must be extended with addition and subtraction test cases

### External Dependencies
- .NET 6.0 SDK or later runtime environment (already established by project configuration)
- No new external packages or libraries required

### Knowledge Dependencies
- Understanding of IEEE 754 floating-point arithmetic behavior in C# `double` type
- Familiarity with the existing console UI patterns established in `Program.cs`
- Awareness of the xUnit testing framework conventions used in `CalculatorTests.cs`

### Menu Structure Dependency
- The existing menu structure must have slots available for options "1" and "2"
- Per README.md, multiplication is option "3", division is option "4", and exit is option "5"
- This suggests options "1" and "2" are currently either unassigned or need to be replaced