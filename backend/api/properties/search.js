'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// Import our custom modules
const config = require('../../config/environment');
const { executeQuery, checkConnection, getPoolStats } = require('../../database/connection-pool');
const { validateSearchRequest } = require('../../middleware/validation');
const { handleError, handleDatabaseError, handle404, handleTimeout, handleAsyncError } = require('../../middleware/error-handler');
const { formatLegacyResponse, formatPropertyData, sendJsonResponse } = require('../../utils/response-formatter');
const { createCacheMiddleware, defaultCache } = require('../../utils/cache-manager');
const { performanceLogger, measureTime } = require('../../monitoring/performance-logger');

// Load SQL query template
const queryPath = path.join(__dirname, '../../database/queries/property-search.sql');
let propertySearchSQL;

try {
  propertySearchSQL = fs.readFileSync(queryPath, 'utf8');
} catch (error) {
  console.error('Failed to load property search SQL:', error.message);
  process.exit(1);
}

// Sample fallback data for development/testing
const sampleResults = [
  { 
    id: 1, 
    title: 'Cozy Studio Apartment', 
    city: 'Sampleville', 
    location: '123 Main St',
    price: 900,
    bedrooms: 0,
    bathrooms: 1,
    property_type: 'studio',
    square_feet: 450,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  { 
    id: 2, 
    title: 'Spacious Family Home', 
    city: 'Sampletown',
    location: '456 Oak Ave', 
    price: 2500,
    bedrooms: 3,
    bathrooms: 2,
    property_type: 'house',
    square_feet: 1800,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
];

// Main property search handler
async function handlePropertySearch(req, res) {
  const requestStart = Date.now();
  let clearTimeout;
  
  try {
    // Set request timeout
    clearTimeout = handleTimeout(req, res, config.api.requestTimeout);
    
    // Get validated search parameters
    const searchParams = req.searchParams;
    searchParams.originalUrl = req.url;
    
    let properties;
    let executionTime;
    let isFromDatabase = true;
    
    // Check database connection
    const dbHealthy = await checkConnection();
    
    if (dbHealthy) {
      try {
        // Execute database query with performance monitoring
        const queryResult = await measureTime(executePropertySearchQuery)(searchParams);
        properties = queryResult.result.rows;
        executionTime = queryResult.executionTime;
      } catch (dbError) {
        console.warn('Database query failed, falling back to sample data:', dbError.message);
        properties = filterSampleData(searchParams);
        executionTime = Date.now() - requestStart;
        isFromDatabase = false;
      }
    } else {
      console.warn('Database unhealthy, using sample data');
      properties = filterSampleData(searchParams);
      executionTime = Date.now() - requestStart;
      isFromDatabase = false;
    }
    
    // Format response for backward compatibility
    const responseData = formatLegacyResponse(properties || [], searchParams, executionTime);
    
    // Add metadata about data source
    responseData.metadata.source = isFromDatabase ? 'database' : 'sample';
    responseData.metadata.cached = false; // Will be set by cache middleware if applicable
    
    // Send response with appropriate headers
    sendJsonResponse(res, responseData, 200, {
      executionTime,
      requestId: req.requestId,
      cacheEnabled: config.cache.enabled
    });
    
  } catch (error) {
    console.error('Property search error:', error);
    handleError(error, req, res);
  } finally {
    if (clearTimeout) {
      clearTimeout();
    }
  }
}

// Execute property search query with proper parameterization
async function executePropertySearchQuery(searchParams) {
  // Prepare parameters for the SQL query (order must match SQL placeholders)
  const params = [
    // City filters (2 parameters: null check and value)
    searchParams.city || null,
    searchParams.city || null,
    
    // Location filters (2 parameters: null check and value)
    searchParams.location || null,
    searchParams.location || null,
    
    // Price range filters (4 parameters: null checks and values)
    searchParams.price_min || null,
    searchParams.price_min || null,
    searchParams.price_max || null,
    searchParams.price_max || null,
    
    // Bedroom filter (2 parameters)
    searchParams.bedrooms || null,
    searchParams.bedrooms || null,
    
    // Bathroom filter (2 parameters)  
    searchParams.bathrooms || null,
    searchParams.bathrooms || null,
    
    // Property type filter (2 parameters)
    searchParams.property_type || null,
    searchParams.property_type || null,
    
    // Sort parameters (4 parameters for CASE statements)
    searchParams.sort || null,
    searchParams.sort || null,
    searchParams.sort || null,
    searchParams.sort || null,
    
    // Limit parameter
    searchParams.limit || 50
  ];
  
  return await executeQuery(propertySearchSQL, params);
}

// Filter sample data based on search parameters (fallback function)
function filterSampleData(searchParams) {
  let filtered = [...sampleResults];
  
  // Apply filters
  if (searchParams.city) {
    filtered = filtered.filter(p => 
      p.city.toLowerCase().includes(searchParams.city.toLowerCase())
    );
  }
  
  if (searchParams.location) {
    filtered = filtered.filter(p => 
      p.location.toLowerCase().includes(searchParams.location.toLowerCase())
    );
  }
  
  if (searchParams.price_min) {
    filtered = filtered.filter(p => p.price >= searchParams.price_min);
  }
  
  if (searchParams.price_max) {
    filtered = filtered.filter(p => p.price <= searchParams.price_max);
  }
  
  if (searchParams.bedrooms) {
    filtered = filtered.filter(p => p.bedrooms >= searchParams.bedrooms);
  }
  
  if (searchParams.bathrooms) {
    filtered = filtered.filter(p => p.bathrooms >= searchParams.bathrooms);
  }
  
  if (searchParams.property_type) {
    filtered = filtered.filter(p => p.property_type === searchParams.property_type);
  }
  
  // Apply sorting
  switch (searchParams.sort) {
    case 'price_desc':
      filtered.sort((a, b) => b.price - a.price);
      break;
    case 'newest':
      filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      break;
    case 'oldest':
      filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      break;
    default: // price_asc
      filtered.sort((a, b) => a.price - b.price);
  }
  
  // Apply limit
  return filtered.slice(0, searchParams.limit);
}

// Health check endpoint
async function handleHealthCheck(req, res) {
  try {
    const dbHealthy = await checkConnection();
    const poolStats = getPoolStats();
    const cacheStats = defaultCache.getStats();
    const perfMetrics = performanceLogger.getMetrics();
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: {
          status: dbHealthy ? 'healthy' : 'unhealthy',
          pool: poolStats
        },
        cache: {
          status: 'healthy',
          stats: cacheStats
        },
        api: {
          status: 'healthy',
          performance: perfMetrics
        }
      }
    };
    
    const statusCode = dbHealthy ? 200 : 503;
    sendJsonResponse(res, health, statusCode, {
      cacheEnabled: false,
      requestId: req.requestId
    });
  } catch (error) {
    handleError(error, req, res);
  }
}

// Request routing with middleware
function routeRequest(req, res) {
  // Add request ID for tracking
  req.requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Method not allowed',
      message: 'Only GET requests are supported',
      statusCode: 405
    }));
    return;
  }
  
  if (req.url.startsWith('/api/properties/search')) {
    // Property search endpoint with full middleware chain
    validateSearchRequest(req, res, () => {
      createCacheMiddleware(defaultCache)(req, res, () => {
        handleAsyncError(handlePropertySearch)(req, res);
      });
    });
  } else if (req.url === '/health' || req.url === '/api/health') {
    // Health check endpoint
    handleAsyncError(handleHealthCheck)(req, res);
  } else {
    // 404 handler
    handle404(req, res);
  }
}

// Create HTTP server with performance monitoring
const server = http.createServer((req, res) => {
  // Add performance logging middleware
  const perfMiddleware = performanceLogger.createMiddleware();
  perfMiddleware(req, res, () => {
    routeRequest(req, res);
  });
});

// Server startup with configuration validation
server.listen(config.port, config.host, async () => {
  console.log(`Property search API listening on http://${config.host}:${config.port}`);
  console.log('Environment:', config.environment);
  console.log('Cache enabled:', config.cache.enabled);
  console.log('Database connection limit:', config.database.connectionLimit);
  
  // Check initial database connection
  const dbHealthy = await checkConnection();
  if (dbHealthy) {
    console.log('Database connection: OK');
  } else {
    console.warn('Database connection: Failed - using sample data');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

module.exports = server;
