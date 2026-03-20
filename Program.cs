using System;

namespace Calculator
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("Welcome to the Calculator!");
            Console.WriteLine("==========================");
            
            while (true)
            {
                Console.WriteLine();
                Console.WriteLine("Select operation:");
                Console.WriteLine("1. Add");
                Console.WriteLine("2. Subtract");
                Console.WriteLine("3. Multiply");
                Console.WriteLine("4. Divide");
                Console.WriteLine("5. Exit");
                Console.Write("Enter your choice (1-5): ");
                
                string? operation = Console.ReadLine();
                
                if (operation == "5")
                {
                    Console.WriteLine("Thank you for using the Calculator. Goodbye!");
                    break;
                }
                
                if (operation != "1" && operation != "2" && operation != "3" && operation != "4")
                {
                    Console.WriteLine("Error: Invalid operation selected. Please choose 1-5.");
                    continue;
                }
                
                Console.Write("Enter first number: ");
                string? input1 = Console.ReadLine();
                if (!double.TryParse(input1, out double num1))
                {
                    Console.WriteLine("Error: Invalid number format. Please enter a valid number.");
                    continue;
                }
                
                Console.Write("Enter second number: ");
                string? input2 = Console.ReadLine();
                if (!double.TryParse(input2, out double num2))
                {
                    Console.WriteLine("Error: Invalid number format. Please enter a valid number.");
                    continue;
                }
                
                try
                {
                    double result = 0;
                    string operationName = "";
                    
                    switch (operation)
                    {
                        case "1":
                            result = Calculator.Add(num1, num2);
                            operationName = "addition";
                            break;
                        case "2":
                            result = Calculator.Subtract(num1, num2);
                            operationName = "subtraction";
                            break;
                        case "3":
                            result = Calculator.Multiply(num1, num2);
                            operationName = "multiplication";
                            break;
                        case "4":
                            result = Calculator.Divide(num1, num2);
                            operationName = "division";
                            break;
                    }
                    
                    Console.WriteLine($"Result of {operationName}: {result}");
                }
                catch (DivideByZeroException ex)
                {
                    Console.WriteLine($"Error: {ex.Message}");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error: An unexpected error occurred: {ex.Message}");
                }
            }
        }
    }
}
