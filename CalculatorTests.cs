using Microsoft.VisualStudio.TestTools.UnitTesting;
using System;

namespace Calculator.Tests
{
    [TestClass]
    public class AdditionTests
    {
        [TestMethod]
        public void Add_TwoPositiveIntegers_ReturnsCorrectSum()
        {
            double result = Calculator.Add(5, 3);
            Assert.AreEqual(8.0, result, 0.0001);
        }

        [TestMethod]
        [DataRow(5.0, 3.0, 8.0)]           // positive + positive
        [DataRow(-5.0, -3.0, -8.0)]        // negative + negative
        [DataRow(5.0, -3.0, 2.0)]          // positive + negative
        [DataRow(-5.0, 3.0, -2.0)]         // negative + positive
        [DataRow(0.0, 5.0, 5.0)]           // zero + positive
        [DataRow(5.0, 0.0, 5.0)]           // positive + zero
        [DataRow(0.0, 0.0, 0.0)]           // zero + zero
        public void Add_VariousInputs_ReturnsCorrectSum(double a, double b, double expected)
        {
            double result = Calculator.Add(a, b);
            Assert.AreEqual(expected, result, 0.0001);
        }

        [TestMethod]
        public void Add_DecimalOperands_ReturnsCorrectSum()
        {
            double result = Calculator.Add(2.5, 3.7);
            Assert.AreEqual(6.2, result, 0.0001);
        }

        [TestMethod]
        public void Add_NegativeDecimals_ReturnsCorrectSum()
        {
            double result = Calculator.Add(-2.5, -1.5);
            Assert.AreEqual(-4.0, result, 0.0001);
        }
    }

    [TestClass]
    public class SubtractionTests
    {
        [TestMethod]
        public void Subtract_TwoPositiveIntegers_ReturnsCorrectDifference()
        {
            double result = Calculator.Subtract(10, 4);
            Assert.AreEqual(6.0, result, 0.0001);
        }

        [TestMethod]
        [DataRow(10.0, 4.0, 6.0)]          // positive - positive
        [DataRow(-10.0, -4.0, -6.0)]       // negative - negative
        [DataRow(10.0, -4.0, 14.0)]        // positive - negative (becomes addition)
        [DataRow(-10.0, 4.0, -14.0)]       // negative - positive
        [DataRow(0.0, 5.0, -5.0)]          // zero - positive
        [DataRow(5.0, 0.0, 5.0)]           // positive - zero
        [DataRow(0.0, 0.0, 0.0)]           // zero - zero
        public void Subtract_VariousInputs_ReturnsCorrectDifference(double a, double b, double expected)
        {
            double result = Calculator.Subtract(a, b);
            Assert.AreEqual(expected, result, 0.0001);
        }

        [TestMethod]
        public void Subtract_DecimalOperands_ReturnsCorrectDifference()
        {
            double result = Calculator.Subtract(7.5, 2.3);
            Assert.AreEqual(5.2, result, 0.0001);
        }

        [TestMethod]
        public void Subtract_SmallerFromLarger_ReturnsNegative()
        {
            double result = Calculator.Subtract(3, 10);
            Assert.AreEqual(-7.0, result, 0.0001);
        }
    }

    [TestClass]
    public class MultiplicationTests
    {
        [TestMethod]
        public void Multiply_PositiveNumbers_ReturnsCorrectProduct()
        {
            double result = Calculator.Multiply(5.0, 3.0);
            Assert.AreEqual(15.0, result, 0.0001);
        }

        [TestMethod]
        public void Multiply_NegativeNumber_ReturnsCorrectProduct()
        {
            double result = Calculator.Multiply(-5.0, 3.0);
            Assert.AreEqual(-15.0, result, 0.0001);
        }
    }

    [TestClass]
    public class DivisionTests
    {
        [TestMethod]
        public void Divide_PositiveNumbers_ReturnsCorrectQuotient()
        {
            // Arrange
            double dividend = 10.0;
            double divisor = 2.0;
            double expected = 5.0;
            
            // Act
            double result = Calculator.Divide(dividend, divisor);
            
            // Assert
            Assert.AreEqual(expected, result, 0.0001);
        }
        
        [TestMethod]
        public void Divide_NegativeDividend_ReturnsNegativeQuotient()
        {
            double result = Calculator.Divide(-10.0, 2.0);
            Assert.AreEqual(-5.0, result, 0.0001);
        }
        
        [TestMethod]
        public void Divide_NegativeDivisor_ReturnsNegativeQuotient()
        {
            double result = Calculator.Divide(10.0, -2.0);
            Assert.AreEqual(-5.0, result, 0.0001);
        }
        
        [TestMethod]
        public void Divide_BothNegative_ReturnsPositiveQuotient()
        {
            double result = Calculator.Divide(-10.0, -2.0);
            Assert.AreEqual(5.0, result, 0.0001);
        }
        
        [TestMethod]
        public void Divide_DecimalInputs_ReturnsAccurateQuotient()
        {
            double result = Calculator.Divide(7.5, 2.5);
            Assert.AreEqual(3.0, result, 0.0001);
        }
        
        [TestMethod]
        public void Divide_LargeNumbers_HandlesCorrectly()
        {
            double result = Calculator.Divide(1000000.0, 1000.0);
            Assert.AreEqual(1000.0, result, 0.0001);
        }
        
        [TestMethod]
        public void Divide_SmallDivisor_ProducesLargeQuotient()
        {
            double result = Calculator.Divide(100.0, 0.01);
            Assert.AreEqual(10000.0, result, 0.0001);
        }
        
        [TestMethod]
        [ExpectedException(typeof(DivideByZeroException))]
        public void Divide_ByZero_ThrowsDivideByZeroException()
        {
            Calculator.Divide(10.0, 0.0);
        }
        
        [TestMethod]
        public void Divide_ZeroDividend_ReturnsZero()
        {
            double result = Calculator.Divide(0.0, 5.0);
            Assert.AreEqual(0.0, result, 0.0001);
        }
    }
}
