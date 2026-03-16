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
        Console.WriteLine("\nPress any key to continue...");
        Console.ReadKey();
        Console.Clear();
    }
}

static void DisplayMenu()
{
    Console.WriteLine("=== Calculator ===");
    Console.WriteLine("1. Addition");
    Console.WriteLine("2. Exit");
    Console.Write("\nSelect an operation: ");
}

static void PerformAddition()
{
    Console.WriteLine("\n--- Addition ---");
    
    double firstNumber = GetNumericInput("Enter first number: ");
    double secondNumber = GetNumericInput("Enter second number: ");
    
    double result = firstNumber + secondNumber;
    
    // Check for overflow/underflow conditions
    if (double.IsInfinity(result))
    {
        Console.WriteLine($"\nResult: {firstNumber} + {secondNumber} = Infinity (overflow)");
    }
    else if (double.IsNaN(result))
    {
        Console.WriteLine($"\nResult: {firstNumber} + {secondNumber} = NaN (undefined)");
    }
    else
    {
        Console.WriteLine($"\nResult: {firstNumber} + {secondNumber} = {result}");
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
