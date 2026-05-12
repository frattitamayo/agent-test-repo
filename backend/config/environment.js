'use strict';

// Environment configuration with validation and defaults
const config = {
  // Server configuration
  port: parseInt(process.env.PORT) || 3000,
  host: process.env.HOST || 'localhost',
  environment: process.env.NODE_ENV || 'development',
  
  // Database configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'property_db',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
    queueLimit: parseInt(process.env.DB_QUEUE_LIMIT) || 20,
    acquireTimeout: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 60000,
    timeout: parseInt(process.env.DB_TIMEOUT) || 60000
  },
  
  // API configuration
  api: {
    maxRequestSize: process.env.MAX_REQUEST_SIZE || '1mb',
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT) || 30000,
    responseTimeout: parseInt(process.env.RESPONSE_TIMEOUT) || 200, // Target 200ms
    maxSearchResults: parseInt(process.env.MAX_SEARCH_RESULTS) || 50
  },
  
  // Cache configuration
  cache: {
    enabled: process.env.CACHE_ENABLED !== 'false',
    ttl: parseInt(process.env.CACHE_TTL) || 300, // 5 minutes default
    maxSize: parseInt(process.env.CACHE_MAX_SIZE) || 1000 // Max cached responses
  },
  
  // Rate limiting configuration
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX) || 100 // 100 requests per minute
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enablePerformanceLogging: process.env.PERF_LOGGING !== 'false',
    enableQueryLogging: process.env.QUERY_LOGGING === 'true'
  }
};

// Configuration validation
function validateConfig() {
  const errors = [];
  
  if (config.port < 1 || config.port > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }
  
  if (config.database.connectionLimit < 1 || config.database.connectionLimit > 100) {
    errors.push('DB_CONNECTION_LIMIT must be between 1 and 100');
  }
  
  if (config.api.responseTimeout < 50 || config.api.responseTimeout > 5000) {
    errors.push('RESPONSE_TIMEOUT must be between 50ms and 5000ms');
  }
  
  if (config.api.maxSearchResults < 1 || config.api.maxSearchResults > 500) {
    errors.push('MAX_SEARCH_RESULTS must be between 1 and 500');
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
  
  return true;
}

// Initialize and validate configuration
try {
  validateConfig();
  console.log('Configuration validated successfully');
} catch (error) {
  console.error('Configuration error:', error.message);
  process.exit(1);
}

module.exports = config;