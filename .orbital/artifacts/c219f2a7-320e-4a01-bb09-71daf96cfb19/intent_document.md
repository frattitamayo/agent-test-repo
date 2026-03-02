# Intent Document — Calculator

**Generated:** 2024-07-12
**Source:** Project trajectory and intent description
**Intent Count:** 1

---

## INT-001: Subtraction Functionality

- **outcome:** The calculator successfully subtracts two numbers, providing the correct result.
- **constraints:** The calculator must handle integer and floating-point numbers. It must not perform any other mathematical operations besides subtraction. The calculator must not crash or produce incorrect results due to invalid input.
- **acceptance:** The subtraction function must pass unit tests with 100% coverage. The function must return the correct result for a set of predefined test cases, including edge cases (e.g., subtracting zero, subtracting a larger number from a smaller one). The function must handle invalid input gracefully, either by returning an error message or throwing an exception.
- **trust_tier:** 2 — supervised (involves core mathematical functionality, requires human approval before deployment)
- **dependencies:** None