'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');

// Import custom modules
const DatabaseConnection = require('../../database/connection');
const PropertyService = require('../../database/property-service');
const { validateSearchParameters, ValidationError } = require('../../utils/validators');
const { formatSearchResponse, formatErrorResponse, formatHealthCheckResponse } = require('../../utils/formatters');

const app = express();
const PORT = process.env.PORT || 3000;

// Global variables for database and services
let dbConnection = null;
let propertyService = null;
let serverStartTime = null;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
  });
  
  next();
});

// Routes

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbHealthy = dbConnection ? await dbConnection.healthCheck() : false;
    const isHealthy = dbHealthy;
    
    res.status(isHealthy ? 200 : 503)
       .json(formatHealthCheckResponse(isHealthy, dbHealthy));
  } catch (error) {
    console.error('Health check error:', error.message);
    res.status(503).json(formatHealthCheckResponse(false, false));
  }
});

// Property search endpoint
app.get('/api/properties/search', async (req, res) => {
  const requestStart = Date.now();
  
  try {
    // Validate request parameters
    const validatedParams = validateSearchParameters(req.query);
    
    // Execute search
    const searchResult = await propertyService.searchProperties(validatedParams);
    
    // Check response time constraint
    const responseTime = Date.now() - requestStart;
    if (responseTime > 2000) {
      console.warn(`Search response time exceeded limit: ${responseTime}ms`);
    }
    
    // Format and send response
    const response = formatSearchResponse(searchResult.properties, searchResult.pagination);
    res.json(response);
    
  } catch (error) {
    console.error('Search endpoint error:', error.message);
    
    if (error.name === 'ValidationError') {
      res.status(400).json(formatErrorResponse(error, 400));
    } else {
      res.status(500).json(formatErrorResponse(error, 500));
    }
  }
});

// Individual property endpoint
app.get('/api/properties/:id', async (req, res) => {
  try {
    const propertyId = parseInt(req.params.id, 10);
    
    if (isNaN(propertyId) || propertyId <= 0) {
      return res.status(400).json(formatErrorResponse(
        new Error('Property ID must be a positive integer'), 400
      ));
    }
    
    const property = await propertyService.getPropertyById(propertyId);
    
    if (!property) {
      return res.status(404).json(formatErrorResponse(
        new Error('Property not found'), 404
      ));
    }
    
    res.json({
      success: true,
      data: property,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Get property endpoint error:', error.message);
    res.status(500).json(formatErrorResponse(error, 500));
  }
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  const docs = {
    title: 'Property Search API Documentation',
    version: '1.0.0',
    endpoints: {
      'GET /health': {
        description: 'Health check endpoint',
        parameters: 'None',
        response: 'Service health status'
      },
      'GET /api/properties/search': {
        description: 'Search properties with optional filters',
        parameters: {
          location: 'string - Filter by location or city (partial match)',
          min_price: 'integer - Minimum price filter',
          max_price: 'integer - Maximum price filter', 
          type: 'string - Property type (apartment, house, condo, townhouse, loft)',
          page: 'integer - Page number (default: 1)',
          limit: 'integer - Results per page (default: 50, max: 200)'
        },
        example: '/api/properties/search?location=downtown&min_price=200000&max_price=500000&type=apartment&page=1&limit=20'
      },
      'GET /api/properties/:id': {
        description: 'Get specific property by ID',
        parameters: {
          id: 'integer - Property ID'
        },
        example: '/api/properties/123'
      }
    }
  };
  
  res.json(docs);
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json(formatErrorResponse(
    new Error('Endpoint not found'), 404
  ));
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error.message);
  res.status(500).json(formatErrorResponse(error, 500));
});

// Initialize database and start server
async function startServer() {
  try {
    console.log('Initializing Property Search API...');
    
    // Initialize database connection
    dbConnection = new DatabaseConnection();
    await dbConnection.connect();
    
    // Initialize property service
    propertyService = new PropertyService(dbConnection);
    
    // Start server
    const server = app.listen(PORT, () => {
      serverStartTime = new Date();
      console.log(`Property Search API listening on http://localhost:${PORT}`);
      console.log(`API Documentation available at http://localhost:${PORT}/api/docs`);
      console.log(`Health check available at http://localhost:${PORT}/health`);
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('Received SIGTERM, shutting down gracefully...');
      server.close(() => {
        if (dbConnection) {
          dbConnection.close();
        }
        process.exit(0);
      });
    });
    
    process.on('SIGINT', () => {
      console.log('Received SIGINT, shutting down gracefully...');
      server.close(() => {
        if (dbConnection) {
          dbConnection.close();
        }
        process.exit(0);
      });
    });
    
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

// Start the server
if (require.main === module) {
  startServer();
}

module.exports = app;
