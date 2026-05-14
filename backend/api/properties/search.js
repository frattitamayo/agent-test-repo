'use strict';

const http = require('http');
const url = require('url');
const path = require('path');

const { validateSearchParameters, sanitizeError } = require('./validation');
const { executePropertySearch, checkDatabaseHealth } = require('../../database/connection');

const PORT = process.env.PORT || 3000;

/**
 * Handles property search requests with comprehensive parameter validation and error handling
 * @param {http.IncomingMessage} req - HTTP request object
 * @param {http.ServerResponse} res - HTTP response object
 */
async function handlePropertySearch(req, res) {
  try {
    const parsedUrl = url.parse(req.url, true);
    const queryParams = parsedUrl.query || {};
    
    // Validate input parameters
    const validation = validateSearchParameters(queryParams);
    
    if (!validation.isValid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Invalid search parameters',
        details: validation.errors,
        status: 400
      }));
      return;
    }
    
    // Check database availability
    const isDbHealthy = await checkDatabaseHealth();
    if (!isDbHealthy) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Service temporarily unavailable',
        message: 'Database is currently unavailable. Please try again later.',
        status: 503
      }));
      return;
    }
    
    // Execute property search
    const searchResults = await executePropertySearch(validation.params);
    
    // Format response to maintain backward compatibility while adding new features
    const response = {
      message: 'Hello from property search API', // Maintained for backward compatibility
      query: req.url, // Maintained for backward compatibility
      results: searchResults.results,
      // New pagination and metadata fields
      pagination: {
        currentPage: searchResults.currentPage,
        totalResults: searchResults.totalResults,
        totalPages: searchResults.totalPages,
        hasNextPage: searchResults.hasNextPage,
        hasPrevPage: searchResults.hasPrevPage,
        limit: validation.params.limit
      },
      searchParameters: validation.params,
      timestamp: new Date().toISOString()
    };
    
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300' // 5-minute cache for performance
    });
    res.end(JSON.stringify(response, null, 2));
    
  } catch (error) {
    console.error('Property search error:', error);
    
    const sanitizedMessage = sanitizeError(error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Internal server error',
      message: sanitizedMessage,
      status: 500
    }));
  }
}

/**
 * Serves API documentation
 * @param {http.IncomingMessage} req - HTTP request object
 * @param {http.ServerResponse} res - HTTP response object
 */
function handleApiDocumentation(req, res) {
  const documentation = {
    title: 'Property Search API Documentation',
    version: '1.0.0',
    baseUrl: `http://localhost:${PORT}`,
    endpoints: {
      '/api/properties/search': {
        method: 'GET',
        description: 'Search for properties with optional filters and pagination',
        parameters: {
          location: {
            type: 'string',
            required: false,
            description: 'Location to search (city or area name)',
            example: 'downtown'
          },
          priceMin: {
            type: 'number',
            required: false,
            description: 'Minimum price filter',
            example: 1000
          },
          priceMax: {
            type: 'number',
            required: false,
            description: 'Maximum price filter',
            example: 3000
          },
          propertyType: {
            type: 'string',
            required: false,
            description: 'Type of property',
            allowedValues: ['apartment', 'house', 'condo', 'townhouse', 'studio', 'loft'],
            example: 'apartment'
          },
          page: {
            type: 'integer',
            required: false,
            description: 'Page number for pagination (default: 1)',
            example: 1
          },
          limit: {
            type: 'integer',
            required: false,
            description: 'Number of results per page (default: 10, max: 100)',
            example: 20
          }
        },
        examples: {
          basic: `GET /api/properties/search`,
          filtered: `GET /api/properties/search?location=downtown&priceMin=1000&priceMax=2000&propertyType=apartment`,
          paginated: `GET /api/properties/search?page=2&limit=5`
        },
        responses: {
          200: {
            description: 'Successful search with results',
            schema: {
              message: 'string',
              query: 'string',
              results: 'array of property objects',
              pagination: {
                currentPage: 'integer',
                totalResults: 'integer',
                totalPages: 'integer',
                hasNextPage: 'boolean',
                hasPrevPage: 'boolean',
                limit: 'integer'
              }
            }
          },
          400: {
            description: 'Invalid search parameters',
            schema: {
              error: 'string',
              details: 'array of error messages',
              status: 'integer'
            }
          },
          500: {
            description: 'Internal server error',
            schema: {
              error: 'string',
              message: 'string',
              status: 'integer'
            }
          }
        }
      }
    }
  };
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(documentation, null, 2));
}

/**
 * Main request handler
 */
const server = http.createServer(async (req, res) => {
  // Enable CORS for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname;
  
  // Route handling
  if (pathname === '/api/properties/search' && req.method === 'GET') {
    await handlePropertySearch(req, res);
  } else if (pathname === '/api/properties/search/docs' && req.method === 'GET') {
    handleApiDocumentation(req, res);
  } else if (pathname.startsWith('/api/properties/search')) {
    // Handle any other search-related paths
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not found',
      message: 'The requested endpoint does not exist',
      availableEndpoints: [
        '/api/properties/search',
        '/api/properties/search/docs'
      ],
      status: 404
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Property search API listening on http://localhost:${PORT}`);
  console.log(`API documentation available at http://localhost:${PORT}/api/properties/search/docs`);
});
