'use strict';

// Centralized error handling middleware
function createErrorResponse(error, req) {
  const timestamp = new Date().toISOString();
  const requestId = req.requestId || 'unknown';
  
  // Log the error for monitoring
  console.error('API Error:', {
    timestamp,
    requestId,
    url: req.url,
    method: req.method,
    error: error.message,
    stack: error.stack?.split('\n').slice(0, 3) // Limited stack trace for security
  });
  
  // Determine error type and appropriate response
  let statusCode = 500;
  let message = 'Internal server error';
  let errorCode = 'INTERNAL_ERROR';
  
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = error.message;
    errorCode = 'VALIDATION_ERROR';
  } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
    statusCode = 503;
    message = 'Database connection error';
    errorCode = 'DATABASE_ERROR';
  } else if (error.code === 'ECONNREFUSED') {
    statusCode = 503;
    message = 'Service temporarily unavailable';
    errorCode = 'SERVICE_UNAVAILABLE';
  } else if (error.code === 'ER_BAD_DB_ERROR') {
    statusCode = 503;
    message = 'Database configuration error';
    errorCode = 'DATABASE_CONFIG_ERROR';
  } else if (error.message?.includes('timeout')) {
    statusCode = 504;
    message = 'Request timeout';
    errorCode = 'TIMEOUT_ERROR';
  } else if (error.message?.includes('not found') || error.message?.includes('404')) {
    statusCode = 404;
    message = 'Resource not found';
    errorCode = 'NOT_FOUND';
  }
  
  return {
    error: true,
    message,
    errorCode,
    statusCode,
    timestamp,
    requestId: requestId
  };
}

// Error handler for async operations
function handleAsyncError(asyncFn) {
  return async (req, res, ...args) => {
    try {
      await asyncFn(req, res, ...args);
    } catch (error) {
      handleError(error, req, res);
    }
  };
}

// Main error handling function
function handleError(error, req, res) {
  const errorResponse = createErrorResponse(error, req);
  
  // Set appropriate headers
  res.writeHead(errorResponse.statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'X-Request-ID': errorResponse.requestId
  });
  
  // Send error response
  res.end(JSON.stringify(errorResponse));
}

// Database error handler with connection pool monitoring
function handleDatabaseError(error, req, res, poolStats = null) {
  // Add pool statistics to error context for debugging
  if (poolStats) {
    console.error('Database pool status:', poolStats);
  }
  
  // Enhanced database error handling
  let statusCode = 503;
  let message = 'Database service unavailable';
  let errorCode = 'DATABASE_ERROR';
  
  if (error.code === 'PROTOCOL_CONNECTION_LOST') {
    message = 'Database connection lost';
    errorCode = 'CONNECTION_LOST';
  } else if (error.code === 'ER_TOO_MANY_CONNECTIONS') {
    message = 'Database connection limit exceeded';
    errorCode = 'CONNECTION_LIMIT_EXCEEDED';
  } else if (error.sqlState) {
    // SQL-specific errors
    message = 'Database query error';
    errorCode = 'SQL_ERROR';
  }
  
  const errorResponse = {
    error: true,
    message,
    errorCode,
    statusCode,
    timestamp: new Date().toISOString(),
    requestId: req.requestId || 'unknown'
  };
  
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'X-Request-ID': errorResponse.requestId
  });
  
  res.end(JSON.stringify(errorResponse));
}

// Validation error handler
function handleValidationError(validationErrors, req, res) {
  const errorResponse = {
    error: true,
    message: 'Request validation failed',
    errorCode: 'VALIDATION_ERROR',
    statusCode: 400,
    timestamp: new Date().toISOString(),
    requestId: req.requestId || 'unknown',
    details: Array.isArray(validationErrors) ? validationErrors : [validationErrors]
  };
  
  res.writeHead(400, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'X-Request-ID': errorResponse.requestId
  });
  
  res.end(JSON.stringify(errorResponse));
}

// Timeout error handler
function handleTimeout(req, res, timeoutMs = 30000) {
  const timeoutId = setTimeout(() => {
    if (!res.headersSent) {
      const errorResponse = {
        error: true,
        message: `Request timeout after ${timeoutMs}ms`,
        errorCode: 'TIMEOUT_ERROR',
        statusCode: 504,
        timestamp: new Date().toISOString(),
        requestId: req.requestId || 'unknown'
      };
      
      res.writeHead(504, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Request-ID': errorResponse.requestId
      });
      
      res.end(JSON.stringify(errorResponse));
    }
  }, timeoutMs);
  
  // Return cleanup function
  return () => clearTimeout(timeoutId);
}

// 404 handler for unmatched routes
function handle404(req, res) {
  const errorResponse = {
    error: true,
    message: 'Endpoint not found',
    errorCode: 'NOT_FOUND',
    statusCode: 404,
    timestamp: new Date().toISOString(),
    requestId: req.requestId || 'unknown',
    path: req.url
  };
  
  res.writeHead(404, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'X-Request-ID': errorResponse.requestId
  });
  
  res.end(JSON.stringify(errorResponse));
}

module.exports = {
  handleError,
  handleDatabaseError,
  handleValidationError,
  handleAsyncError,
  handleTimeout,
  handle404,
  createErrorResponse
};