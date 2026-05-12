'use strict';

function formatPropertyObject(dbProperty) {
  return {
    id: dbProperty.id,
    title: dbProperty.title,
    location: dbProperty.location,
    city: dbProperty.city,
    price: dbProperty.price,
    type: dbProperty.property_type,
    description: dbProperty.description || null,
    created_at: dbProperty.created_at
  };
}

function formatSearchResponse(properties, pagination) {
  return {
    success: true,
    data: properties.map(formatPropertyObject),
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: pagination.total,
      hasMore: pagination.hasMore,
      totalPages: Math.ceil(pagination.total / pagination.limit)
    },
    timestamp: new Date().toISOString()
  };
}

function formatErrorResponse(error, statusCode = 500) {
  const response = {
    success: false,
    error: {
      message: getErrorMessage(error, statusCode),
      code: statusCode
    },
    timestamp: new Date().toISOString()
  };

  // Include validation errors if available
  if (error.name === 'ValidationError' && error.errors) {
    response.error.details = error.errors;
  }

  return response;
}

function getErrorMessage(error, statusCode) {
  switch (statusCode) {
    case 400:
      return error.message || 'Invalid request parameters';
    case 404:
      return 'Resource not found';
    case 500:
      return 'Internal server error';
    default:
      return 'An error occurred';
  }
}

function formatHealthCheckResponse(isHealthy, dbStatus = null) {
  return {
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    services: {
      database: dbStatus !== null ? (dbStatus ? 'connected' : 'disconnected') : 'unknown'
    }
  };
}

module.exports = {
  formatPropertyObject,
  formatSearchResponse,
  formatErrorResponse,
  formatHealthCheckResponse
};