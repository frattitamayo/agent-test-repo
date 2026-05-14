'use strict';

/**
 * Input validation module for property search parameters
 */

const VALID_PROPERTY_TYPES = ['apartment', 'house', 'condo', 'townhouse', 'studio', 'loft'];
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const DEFAULT_PAGE = 1;

/**
 * Validates and sanitizes search parameters
 * @param {Object} params - Raw query parameters
 * @returns {Object} - Validated parameters object with errors array
 */
function validateSearchParameters(params) {
  const errors = [];
  const validated = {};

  // Location validation (optional, string)
  if (params.location !== undefined) {
    if (typeof params.location === 'string' && params.location.trim().length > 0) {
      validated.location = params.location.trim().slice(0, 100); // Prevent excessively long strings
    } else {
      errors.push('Location must be a non-empty string');
    }
  }

  // Price range validation (optional, positive numbers)
  if (params.priceMin !== undefined) {
    const priceMin = parseFloat(params.priceMin);
    if (isNaN(priceMin) || priceMin < 0) {
      errors.push('Minimum price must be a non-negative number');
    } else {
      validated.priceMin = priceMin;
    }
  }

  if (params.priceMax !== undefined) {
    const priceMax = parseFloat(params.priceMax);
    if (isNaN(priceMax) || priceMax < 0) {
      errors.push('Maximum price must be a non-negative number');
    } else {
      validated.priceMax = priceMax;
    }
  }

  // Validate price range consistency
  if (validated.priceMin !== undefined && validated.priceMax !== undefined) {
    if (validated.priceMin > validated.priceMax) {
      errors.push('Minimum price cannot be greater than maximum price');
    }
  }

  // Property type validation (optional, from allowed list)
  if (params.propertyType !== undefined) {
    if (typeof params.propertyType === 'string' && VALID_PROPERTY_TYPES.includes(params.propertyType.toLowerCase())) {
      validated.propertyType = params.propertyType.toLowerCase();
    } else {
      errors.push(`Property type must be one of: ${VALID_PROPERTY_TYPES.join(', ')}`);
    }
  }

  // Pagination validation
  let page = parseInt(params.page) || DEFAULT_PAGE;
  if (page < 1) {
    errors.push('Page number must be a positive integer');
    page = DEFAULT_PAGE;
  }
  validated.page = page;

  let limit = parseInt(params.limit) || DEFAULT_LIMIT;
  if (limit < 1) {
    errors.push('Limit must be a positive integer');
    limit = DEFAULT_LIMIT;
  } else if (limit > MAX_LIMIT) {
    errors.push(`Limit cannot exceed ${MAX_LIMIT}`);
    limit = MAX_LIMIT;
  }
  validated.limit = limit;

  return {
    params: validated,
    errors: errors,
    isValid: errors.length === 0
  };
}

/**
 * Sanitizes error messages to prevent information disclosure
 * @param {Error} error - Original error object
 * @returns {string} - Safe error message for client
 */
function sanitizeError(error) {
  // Map known error patterns to safe messages
  const errorMessage = error.message || 'Unknown error';
  
  if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('connection')) {
    return 'Database temporarily unavailable. Please try again later.';
  }
  
  if (errorMessage.includes('timeout')) {
    return 'Request timeout. Please try again with fewer search criteria.';
  }
  
  if (errorMessage.includes('syntax') || errorMessage.includes('SQL')) {
    return 'Invalid search parameters. Please check your input.';
  }
  
  // Default safe message for unexpected errors
  return 'An internal error occurred. Please try again later.';
}

module.exports = {
  validateSearchParameters,
  sanitizeError,
  VALID_PROPERTY_TYPES,
  MAX_LIMIT,
  DEFAULT_LIMIT
};