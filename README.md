# Calculator

This project is a calculator that can add, subtract, multiply and divide. It is a console app written in C#.

## Features

The calculator supports the following operations:
- **Add**: Add two numbers together
- **Subtract**: Subtract one number from another
- **Multiply**: Multiply two numbers together
- **Divide**: Divide one number by another (with division by zero protection)

## Running the Calculator

1. Make sure you have the .NET 6.0 SDK or later installed.
2. From the repository root, run:
   ```bash
   dotnet run --project Calculator.csproj
   ```
3. Follow the on-screen prompts to select an operation and enter numbers.

## Running Tests

To run the unit tests:
```bash
dotnet test CalculatorTests.csproj
```

## Project Structure

- **Calculator.cs** - Core calculator logic with arithmetic operations
- **Program.cs** - Console application entry point and user interface
- **CalculatorTests.cs** - Comprehensive unit tests for all operations
- **Calculator.csproj** - Main project file
- **CalculatorTests.csproj** - Test project file

## Example Usage

```
Welcome to the Calculator!
==========================

Select operation:
1. Add
2. Subtract
3. Multiply
4. Divide
5. Exit
Enter your choice (1-5): 4
Enter first number: 10
Enter second number: 2
Result of division: 5
```

## Error Handling

The calculator includes robust error handling:
- Division by zero is detected and reported with a clear error message
- Invalid numeric input is rejected with helpful feedback
- Invalid operation selections are caught and the user is prompted again

---

## Legacy Note

This repository previously contained a Node.js property search sample. The calculator C# project is now the primary content.
