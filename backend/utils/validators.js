'use strict';

const PROPERTY_TYPES = ['apartment', 'house', 'condo', 'townhouse', 'loft'];
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

function validateSearchParameters(query) {
  const errors = [];
  const validated = {};

  // Validate and sanitize location
  if (query.location !== undefined) {
    if (typeof query.location === 'string' && query.location.trim().length > 0) {
      // Remove potential SQL injection characters and limit length
      validated.location = query.location.trim().substring(0, 100);
      // Basic sanitization - remove dangerous characters
      validated.location = validated.location.replace(/['"`;]/g, '');
    } else if (query.location !== '') {
      errors.push({ field: 'location', message: 'Location must be a non-empty string' });
    }
  }

  // Validate min_price
  if (query.min_price !== undefined) {
    const minPrice = parseInt(query.min_price, 10);
    if (isNaN(minPrice) || minPrice < 0) {
      errors.push({ field: 'min_price', message: 'min_price must be a non-negative integer' });
    } else {
      validated.min_price = minPrice;
    }
  }

  // Validate max_price
  if (query.max_price !== undefined) {
    const maxPrice = parseInt(query.max_price, 10);
    if (isNaN(maxPrice) || maxPrice < 0) {
      errors.push({ field: 'max_price', message: 'max_price must be a non-negative integer' });
    } else {
      validated.max_price = maxPrice;
    }
  }

  // Validate price range consistency
  if (validated.min_price !== undefined && validated.max_price !== undefined) {
    if (validated.min_price > validated.max_price) {
      errors.push({ 
        field: 'price_range', 
        message: 'min_price cannot be greater than max_price' 
      });
    }
  }

  // Validate property_type
  if (query.type !== undefined || query.property_type !== undefined) {
    const propertyType = query.type || query.property_type;
    if (typeof propertyType === 'string' && propertyType.trim().length > 0) {
      const normalizedType = propertyType.trim().toLowerCase();
      if (PROPERTY_TYPES.includes(normalizedType)) {
        validated.property_type = normalizedType;
      } else {
        errors.push({ 
          field: 'property_type', 
          message: `property_type must be one of: ${PROPERTY_TYPES.join(', ')}` 
        });
      }
    } else {
      errors.push({ field: 'property_type', message: 'property_type must be a non-empty string' });
    }
  }

  // Validate pagination parameters
  if (query.page !== undefined) {
    const page = parseInt(query.page, 10);
    if (isNaN(page) || page < 1) {
      errors.push({ field: 'page', message: 'page must be a positive integer starting from 1' });
    } else {
      validated.page = page;
    }
  } else {
    validated.page = 1;
  }

  if (query.limit !== undefined) {
    const limit = parseInt(query.limit, 10);
    if (isNaN(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      errors.push({ 
        field: 'limit', 
        message: `limit must be between 1 and ${MAX_PAGE_SIZE}` 
      });
    } else {
      validated.limit = limit;
    }
  } else {
    validated.limit = DEFAULT_PAGE_SIZE;
  }

  if (errors.length > 0) {
    const error = new ValidationError('Validation failed');
    error.errors = errors;
    throw error;
  }

  return validated;
}

function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }
  
  // Remove potential XSS and SQL injection patterns
  return input
    .replace(/[<>'"`;]/g, '') // Remove dangerous characters
    .trim()
    .substring(0, 1000); // Limit length
}

module.exports = {
  validateSearchParameters,
  sanitizeInput,
  ValidationError,
  PROPERTY_TYPES,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE
};