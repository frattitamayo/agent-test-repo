'use strict';

// Utility functions for formatting consistent API responses

function formatSuccessResponse(data, metadata = {}) {
  const response = {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    ...metadata
  };
  
  return response;
}

function formatPropertySearchResponse(properties, searchParams, executionTime, totalCount = null) {
  const response = {
    success: true,
    data: {
      properties: properties || [],
      count: properties?.length || 0,
      searchParams: searchParams || {},
      performance: {
        executionTime: `${executionTime}ms`,
        cached: false // Will be overridden by cache layer if applicable
      }
    },
    timestamp: new Date().toISOString()
  };
  
  // Add total count if provided (useful for pagination)
  if (totalCount !== null) {
    response.data.totalCount = totalCount;
  }
  
  // Add pagination info if applicable
  if (searchParams.limit) {
    response.data.pagination = {
      limit: searchParams.limit,
      hasMore: properties?.length === searchParams.limit
    };
  }
  
  return response;
}

function formatPropertyData(rawProperty) {
  if (!rawProperty) return null;
  
  // Ensure consistent property format
  return {
    id: rawProperty.id,
    title: rawProperty.title || '',
    description: rawProperty.description || '',
    location: {
      city: rawProperty.city || '',
      address: rawProperty.location || ''
    },
    price: parseFloat(rawProperty.price) || 0,
    details: {
      bedrooms: parseInt(rawProperty.bedrooms) || 0,
      bathrooms: parseFloat(rawProperty.bathrooms) || 0,
      squareFeet: parseInt(rawProperty.square_feet) || null,
      propertyType: rawProperty.property_type || 'unknown'
    },
    dates: {
      createdAt: rawProperty.created_at || null,
      updatedAt: rawProperty.updated_at || null
    }
  };
}

function formatErrorResponse(error, statusCode = 500, requestId = null) {
  const response = {
    success: false,
    error: {
      message: error.message || 'Unknown error occurred',
      code: error.code || 'UNKNOWN_ERROR',
      statusCode
    },
    timestamp: new Date().toISOString()
  };
  
  if (requestId) {
    response.requestId = requestId;
  }
  
  return response;
}

function formatValidationErrorResponse(validationErrors, requestId = null) {
  const response = {
    success: false,
    error: {
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details: Array.isArray(validationErrors) ? validationErrors : [validationErrors]
    },
    timestamp: new Date().toISOString()
  };
  
  if (requestId) {
    response.requestId = requestId;
  }
  
  return response;
}

function addCacheHeaders(res, cacheEnabled = true, maxAge = 300) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff'
  };
  
  if (cacheEnabled) {
    headers['Cache-Control'] = `public, max-age=${maxAge}`;
    headers['ETag'] = `"${Date.now()}"`;
  } else {
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    headers['Pragma'] = 'no-cache';
    headers['Expires'] = '0';
  }
  
  return headers;
}

function addPerformanceHeaders(res, executionTime, cached = false) {
  res.setHeader('X-Response-Time', `${executionTime}ms`);
  res.setHeader('X-Cached', cached ? 'true' : 'false');
  
  // Performance warning for slow responses
  if (executionTime > 200) {
    res.setHeader('X-Performance-Warning', 'Response time exceeded target');
  }
}

function sendJsonResponse(res, data, statusCode = 200, options = {}) {
  const {
    cacheEnabled = true,
    maxAge = 300,
    executionTime = null,
    cached = false,
    requestId = null,
    additionalHeaders = {}
  } = options;
  
  // Set base headers
  const headers = {
    ...addCacheHeaders(res, cacheEnabled, maxAge),
    ...additionalHeaders
  };
  
  // Add request ID if provided
  if (requestId) {
    headers['X-Request-ID'] = requestId;
  }
  
  // Set all headers
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  
  // Add performance headers if execution time provided
  if (executionTime !== null) {
    addPerformanceHeaders(res, executionTime, cached);
  }
  
  // Send response
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

// Backward compatibility formatter for maintaining existing API contract
function formatLegacyResponse(properties, searchParams, executionTime) {
  // Maintain the original response structure for backward compatibility
  const legacyResults = properties.map(property => ({
    id: property.id,
    title: property.title,
    city: property.city,
    price: property.price,
    // Add new fields as optional extensions
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    property_type: property.property_type,
    location: property.location
  }));
  
  return {
    message: 'Hello from property search API',
    query: searchParams.originalUrl || '/api/properties/search',
    results: legacyResults,
    // Extended metadata (new fields)
    metadata: {
      count: legacyResults.length,
      executionTime: `${executionTime}ms`,
      searchCriteria: searchParams
    }
  };
}

module.exports = {
  formatSuccessResponse,
  formatPropertySearchResponse,
  formatPropertyData,
  formatErrorResponse,
  formatValidationErrorResponse,
  sendJsonResponse,
  formatLegacyResponse,
  addCacheHeaders,
  addPerformanceHeaders
};