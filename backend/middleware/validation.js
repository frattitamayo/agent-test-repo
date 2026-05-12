'use strict';

const url = require('url');

// Input sanitization and validation for property search parameters
function sanitizeSearchParams(queryParams) {
  const sanitized = {};
  
  // Location validation - alphanumeric, spaces, hyphens, commas
  if (queryParams.location) {
    const location = String(queryParams.location).trim();
    if (location.length > 0 && location.length <= 100) {
      // Remove potentially dangerous characters but allow common location characters
      sanitized.location = location.replace(/[^a-zA-Z0-9\s\-,.']/g, '').trim();
      if (sanitized.location.length === 0) {
        throw new Error('Location contains invalid characters');
      }
    } else if (location.length > 100) {
      throw new Error('Location must be 100 characters or less');
    }
  }
  
  // City validation - similar to location
  if (queryParams.city) {
    const city = String(queryParams.city).trim();
    if (city.length > 0 && city.length <= 50) {
      sanitized.city = city.replace(/[^a-zA-Z0-9\s\-,']/g, '').trim();
      if (sanitized.city.length === 0) {
        throw new Error('City contains invalid characters');
      }
    } else if (city.length > 50) {
      throw new Error('City must be 50 characters or less');
    }
  }
  
  // Price range validation
  if (queryParams.price_min) {
    const priceMin = parseFloat(queryParams.price_min);
    if (isNaN(priceMin) || priceMin < 0 || priceMin > 100000000) {
      throw new Error('price_min must be a valid number between 0 and 100,000,000');
    }
    sanitized.price_min = priceMin;
  }
  
  if (queryParams.price_max) {
    const priceMax = parseFloat(queryParams.price_max);
    if (isNaN(priceMax) || priceMax < 0 || priceMax > 100000000) {
      throw new Error('price_max must be a valid number between 0 and 100,000,000');
    }
    sanitized.price_max = priceMax;
  }
  
  // Validate price range logic
  if (sanitized.price_min && sanitized.price_max && sanitized.price_min > sanitized.price_max) {
    throw new Error('price_min cannot be greater than price_max');
  }
  
  // Bedroom validation
  if (queryParams.bedrooms) {
    const bedrooms = parseInt(queryParams.bedrooms);
    if (isNaN(bedrooms) || bedrooms < 0 || bedrooms > 20) {
      throw new Error('bedrooms must be a valid integer between 0 and 20');
    }
    sanitized.bedrooms = bedrooms;
  }
  
  // Bathroom validation
  if (queryParams.bathrooms) {
    const bathrooms = parseFloat(queryParams.bathrooms);
    if (isNaN(bathrooms) || bathrooms < 0 || bathrooms > 20) {
      throw new Error('bathrooms must be a valid number between 0 and 20');
    }
    sanitized.bathrooms = bathrooms;
  }
  
  // Property type validation
  if (queryParams.property_type) {
    const validTypes = ['apartment', 'house', 'condo', 'townhouse', 'studio', 'duplex', 'other'];
    const propertyType = String(queryParams.property_type).toLowerCase().trim();
    if (!validTypes.includes(propertyType)) {
      throw new Error(`property_type must be one of: ${validTypes.join(', ')}`);
    }
    sanitized.property_type = propertyType;
  }
  
  // Limit validation
  if (queryParams.limit) {
    const limit = parseInt(queryParams.limit);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be a valid integer between 1 and 100');
    }
    sanitized.limit = limit;
  } else {
    sanitized.limit = 50; // Default limit
  }
  
  // Sort validation
  if (queryParams.sort) {
    const validSorts = ['price_asc', 'price_desc', 'newest', 'oldest'];
    const sort = String(queryParams.sort).toLowerCase().trim();
    if (!validSorts.includes(sort)) {
      throw new Error(`sort must be one of: ${validSorts.join(', ')}`);
    }
    sanitized.sort = sort;
  } else {
    sanitized.sort = 'price_asc'; // Default sort
  }
  
  return sanitized;
}

// Middleware function for request validation
function validateSearchRequest(req, res, next) {
  try {
    // Parse URL and query parameters
    const parsedUrl = url.parse(req.url, true);
    const queryParams = parsedUrl.query;
    
    // Validate and sanitize parameters
    const sanitizedParams = sanitizeSearchParams(queryParams);
    
    // Add sanitized parameters to request object
    req.searchParams = sanitizedParams;
    req.originalQuery = queryParams;
    
    next();
  } catch (error) {
    // Return validation error as JSON response
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Invalid request parameters',
      message: error.message,
      statusCode: 400
    }));
  }
}

// Utility function to validate individual parameter types
function validateParam(value, type, min = null, max = null) {
  switch (type) {
    case 'integer':
      const intVal = parseInt(value);
      if (isNaN(intVal)) return false;
      if (min !== null && intVal < min) return false;
      if (max !== null && intVal > max) return false;
      return intVal;
      
    case 'float':
      const floatVal = parseFloat(value);
      if (isNaN(floatVal)) return false;
      if (min !== null && floatVal < min) return false;
      if (max !== null && floatVal > max) return false;
      return floatVal;
      
    case 'string':
      const strVal = String(value).trim();
      if (min !== null && strVal.length < min) return false;
      if (max !== null && strVal.length > max) return false;
      return strVal;
      
    default:
      return false;
  }
}

module.exports = {
  validateSearchRequest,
  sanitizeSearchParams,
  validateParam
};