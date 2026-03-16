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
