namespace Calculator
{
    /// <summary>
    /// Provides basic arithmetic operations for the calculator application.
    /// </summary>
    public static class Calculator
    {
        /// <summary>
        /// Adds two numbers together.
        /// </summary>
        /// <param name="a">The first number</param>
        /// <param name="b">The second number</param>
        /// <returns>The sum of a and b</returns>
        public static double Add(double a, double b)
        {
            return a + b;
        }

        /// <summary>
        /// Subtracts the second number from the first.
        /// </summary>
        /// <param name="a">The number to subtract from</param>
        /// <param name="b">The number to subtract</param>
        /// <returns>The difference of a minus b</returns>
        public static double Subtract(double a, double b)
        {
            return a - b;
        }

        /// <summary>
        /// Multiplies two numbers together.
        /// </summary>
        /// <param name="a">The first number</param>
        /// <param name="b">The second number</param>
        /// <returns>The product of a and b</returns>
        public static double Multiply(double a, double b)
        {
            return a * b;
        }

        /// <summary>
        /// Divides the dividend by the divisor.
        /// </summary>
        /// <param name="dividend">The number to be divided</param>
        /// <param name="divisor">The number to divide by</param>
        /// <returns>The quotient of dividend divided by divisor</returns>
        /// <exception cref="DivideByZeroException">Thrown when divisor is zero</exception>
        public static double Divide(double dividend, double divisor)
        {
            // Explicit check for division by zero to provide clear error handling
            if (divisor == 0)
            {
                throw new DivideByZeroException("Cannot divide by zero. Please provide a non-zero divisor.");
            }
            
            return dividend / divisor;
        }
    }
}
