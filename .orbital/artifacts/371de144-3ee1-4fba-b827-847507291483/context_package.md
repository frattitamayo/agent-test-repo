# Context Package: Addition Operation for Calculator Console App

## Codebase References

### Current Repository State
**Repository:** frattitamayo/agent-test-repo

**Critical Observation:** The repository currently contains a Node.js property search backend structure, NOT a C# calculator console application. The following files exist:
- `README.md`
- `backend/api/properties/search.js`
- `backend/database/queries/property-search.sql`

**Implication:** This orbit will likely establish the initial C# console application structure. Expected files to be created:
- `Program.cs` or `Calculator.cs` — Main entry point for the console application
- `Operations/Addition.cs` or similar — Addition operation logic (if separated)
- `Tests/AdditionTests.cs` — Unit tests for addition functionality

### .NET Project Structure (Expected)
Once initialized, the C# console project should follow standard .NET conventions:
- Project file: `Calculator.csproj` or similar
- Source directory: Flat structure or organized under `src/`
- Test directory: Separate test project or `tests/` folder
- Entry point: `Program.cs` containing `Main()` method

## Architecture Context

### System Overview
This is a **console-based calculator application** with no persistent state, external services, or database dependencies. The architecture is intentionally minimal:

**Execution Model:**
1. User launches console application
2. Application prompts for first operand
3. User enters numeric value
4. Application prompts for second operand
5. User enters numeric value
6. Application performs addition and displays result
7. Application terminates or loops for additional operations

**Data Flow:**
```
Console Input → Input Validation → Numeric Parsing → Addition Operation → Result Display → Console Output
```

### Architectural Constraints
- **No GUI:** Strictly console I/O via `Console.ReadLine()` and `Console.WriteLine()`
- **Single-threaded:** Synchronous operation model; no async/await required for addition
- **Stateless:** No session management or calculation history (at this tier)
- **In-Memory Only:** All operations complete in memory; no file I/O or persistence

### Design Pattern Considerations
For a foundational operation, consider separating concerns:
- **Input/Output Layer:** Console interaction logic
- **Validation Layer:** Input parsing and error detection
- **Operation Layer:** Pure addition logic (`decimal Add(decimal a, decimal b)`)
- **Error Handling:** Try-catch boundaries around parsing and arithmetic operations

This separation enables testability (can unit test addition logic without console I/O) and establishes reusable pattern for subtraction, multiplication, and division operations.

### Type Selection
**Recommended:** Use `decimal` type for operands and results
- **Rationale:** Provides 28-29 significant digits of precision, avoids floating-point arithmetic quirks
- **Alternative:** `double` (acceptable but note floating-point precision limits in acceptance tests)
- **Avoid:** `int` or `long` (insufficient for decimal/fractional input requirement)

## Pattern Library

### Current State
**No Established Patterns:** This is Orbit 2 and the first functional implementation. No prior code patterns exist in the calculator application domain.

### Patterns to Establish (Guidance for Implementation)

#### Input Validation Pattern
```csharp
// Recommended: Clear separation of concerns
bool TryParseInput(string input, out decimal value)
{
    return decimal.TryParse(input, out value);
}
```
- Use `TryParse` over `Parse` to avoid exception-based flow control
- Return boolean success indicator; output parsed value via `out` parameter

#### Error Messaging Pattern
Establish consistent, actionable error messages:
- **Format:** `"Error: [Description]. Please [Action]."`
- **Example:** `"Error: Invalid input detected. Please enter a numeric value."`
- Avoid technical jargon (don't expose stack traces to end users)

#### Console Prompting Pattern
```csharp
Console.Write("Enter first number: ");  // Use Write (no newline) for inline input
string input = Console.ReadLine();
```
- Use `Console.Write()` for prompts (cursor remains on same line)
- Use `Console.WriteLine()` for results and messages (moves to new line)

#### Unit Test Pattern
If establishing test infrastructure:
- Use xUnit, NUnit, or MSTest framework
- Test naming: `MethodName_Scenario_ExpectedBehavior` (e.g., `Add_TwoPositiveIntegers_ReturnsCorrectSum`)
- Arrange-Act-Assert structure
- Table-driven tests for multiple scenarios where applicable

### Naming Conventions (C# Standard)
- **Methods:** PascalCase (`Add`, `ValidateInput`)
- **Variables/Parameters:** camelCase (`firstNumber`, `inputValue`)
- **Constants:** PascalCase or UPPER_SNAKE_CASE
- **Classes:** PascalCase, singular noun (`Calculator`, `AdditionOperation`)

## Prior Orbit References

### Orbit 1 (Assumed)
Based on the trajectory name "Calculator" and this being Orbit 2, Orbit 1 likely involved:
- Repository initialization
- Project setup/scaffolding
- README creation
- No functional code delivered yet

**Implication:** This orbit establishes the **first functional code** and **first arithmetic operation**. Design decisions here become the template for future operations.

### No Prior Implementation Orbits
No prior orbits have delivered addition, subtraction, multiplication, or division functionality. This is the foundational operation orbit.

### Lessons from Current Repo State
The repository currently contains a Node.js backend (property search), which suggests:
- This may be a shared repository for multiple projects, OR
- The C# calculator project is being added to an existing repo, OR
- The repo will be restructured to separate concerns

**Recommendation:** If adding C# project to existing Node.js repo, organize under separate top-level directory (e.g., `calculator/` or `csharp-calculator/`) to avoid confusion.

## Risk Assessment

### Risk 1: Type Overflow
**Scenario:** User inputs extremely large numbers that exceed numeric type limits (e.g., > `Decimal.MaxValue`)
**Impact:** Application crash or incorrect results
**Mitigation:**
- Wrap arithmetic in try-catch for `OverflowException`
- Display error message: "Error: Numbers too large to calculate. Please use smaller values."
- Consider: If using `decimal`, limits are ±7.9 x 10^28; document this threshold

**Likelihood:** Low (requires intentional abuse)
**Severity:** Medium (application crash is poor UX)

### Risk 2: Floating-Point Precision Issues
**Scenario:** If using `double` type, operations like `0.1 + 0.2` may yield `0.30000000000000004` due to binary floating-point representation
**Impact:** User perceives incorrect results; trust in calculator undermined
**Mitigation:**
- **Preferred:** Use `decimal` type for financial/precise arithmetic
- **If using double:** Round results to reasonable precision (e.g., 10 decimal places) for display
- Document precision guarantees in code comments

**Likelihood:** High if using `double`, None if using `decimal`
**Severity:** High (core functionality incorrectness)

### Risk 3: Inadequate Input Validation
**Scenario:** User enters non-numeric input, special characters, or empty strings; application crashes or behaves unpredictably
**Impact:** Poor user experience, potential crash, confusion
**Mitigation:**
- Use `TryParse` pattern to detect invalid input before arithmetic
- Implement input retry loop (allow user to re-enter on error)
- Test boundary cases: empty string, whitespace, null, special chars, very long strings

**Likelihood:** High (users will test boundaries)
**Severity:** Medium (non-functional but degrades trust)

### Risk 4: Pattern Divergence in Future Operations
**Scenario:** Addition implementation establishes poor patterns (e.g., tightly coupled I/O and logic, inadequate separation of concerns) that future operations replicate
**Impact:** Technical debt accumulates, refactoring required before Orbit 5+
**Mitigation:**
- **Tier 2 review focus:** Architecture and pattern establishment, not just functional correctness
- Separate operation logic from I/O (testable pure functions)
- Establish consistent error handling approach
- Document design rationale for reviewer

**Likelihood:** Medium (first implementation sets precedent)
**Severity:** High (affects maintainability of entire project)

### Risk 5: Missing Test Infrastructure
**Scenario:** No unit tests delivered with addition logic; technical debt grows as operations accumulate
**Impact:** Regression risk in future orbits, manual testing burden, confidence degradation
**Mitigation:**
- Require at least minimal unit test coverage (2-3 test cases: positive, negative, edge case)
- Establish test project/folder structure now
- Use Tier 2 review to verify test quality

**Likelihood:** Medium (tests often deferred under time pressure)
**Severity:** Medium (accumulates over time)

### Risk 6: Console Loop Behavior Undefined
**Scenario:** Intent document does not specify whether calculator should:
- Perform one operation and exit
- Loop for multiple operations
- Prompt user to continue or quit
**Impact:** Implementation may not match user expectations; reviewer uncertainty
**Mitigation:**
- **Simplest scope:** Single operation then exit (matches "users can add two numbers" singular framing)
- If implementing loop: Prompt "Perform another calculation? (y/n)" after result
- Clarify in implementation comments or request explicit guidance from reviewer

**Likelihood:** Low (scope is clear: single addition operation)
**Severity:** Low (scope creep, not correctness issue)

### Security Considerations
**No direct security risks** for this tier of functionality:
- No external input sources (network, files)
- No authentication/authorization concerns
- No data persistence or sensitive information handling
- Console application runs in user's local context

**Future consideration:** If calculator evolves to accept input from external sources (file, API), input validation becomes security-critical.