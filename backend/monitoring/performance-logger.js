'use strict';

const fs = require('fs');
const path = require('path');

// Performance monitoring and logging utility
class PerformanceLogger {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.logLevel = options.logLevel || 'info';
    this.slowQueryThreshold = options.slowQueryThreshold || 100; // ms
    this.slowApiThreshold = options.slowApiThreshold || 200; // ms
    this.logFile = options.logFile || path.join(__dirname, '../logs/performance.log');
    this.metrics = {
      requests: 0,
      slowRequests: 0,
      totalResponseTime: 0,
      queryCount: 0,
      slowQueries: 0,
      totalQueryTime: 0,
      errors: 0
    };
    
    // Ensure log directory exists
    this.ensureLogDirectory();
  }
  
  ensureLogDirectory() {
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
      } catch (error) {
        console.error('Failed to create log directory:', error.message);
        this.enabled = false;
      }
    }
  }
  
  // Log API request performance
  logApiRequest(req, res, startTime, endTime, error = null) {
    if (!this.enabled) return;
    
    const duration = endTime - startTime;
    this.metrics.requests++;
    this.metrics.totalResponseTime += duration;
    
    if (error) {
      this.metrics.errors++;
    }
    
    if (duration > this.slowApiThreshold) {
      this.metrics.slowRequests++;
    }
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'api_request',
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.headers['user-agent'] || 'unknown',
      ip: req.connection?.remoteAddress || 'unknown',
      error: error?.message || null,
      slow: duration > this.slowApiThreshold
    };
    
    this.writeLog(logEntry);
    
    // Console warning for slow requests
    if (duration > this.slowApiThreshold) {
      console.warn(`Slow API request: ${req.method} ${req.url} (${duration}ms)`);
    }
  }
  
  // Log database query performance
  logDatabaseQuery(sql, params, startTime, endTime, error = null) {
    if (!this.enabled) return;
    
    const duration = endTime - startTime;
    this.metrics.queryCount++;
    this.metrics.totalQueryTime += duration;
    
    if (error) {
      this.metrics.errors++;
    }
    
    if (duration > this.slowQueryThreshold) {
      this.metrics.slowQueries++;
    }
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'database_query',
      sql: sql.substring(0, 200) + (sql.length > 200 ? '...' : ''), // Truncate long queries
      paramCount: params?.length || 0,
      duration: `${duration}ms`,
      error: error?.message || null,
      slow: duration > this.slowQueryThreshold
    };
    
    this.writeLog(logEntry);
    
    // Console warning for slow queries
    if (duration > this.slowQueryThreshold) {
      console.warn(`Slow database query: ${duration}ms - ${sql.substring(0, 100)}...`);
    }
  }
  
  // Log cache operations
  logCacheOperation(operation, key, hit = null, duration = null) {
    if (!this.enabled) return;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'cache_operation',
      operation,
      key: key.substring(0, 50) + (key.length > 50 ? '...' : ''),
      hit: hit,
      duration: duration ? `${duration}ms` : null
    };
    
    this.writeLog(logEntry);
  }
  
  // Write log entry to file
  writeLog(logEntry) {
    if (!this.enabled) return;
    
    try {
      const logLine = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(this.logFile, logLine);
    } catch (error) {
      console.error('Failed to write performance log:', error.message);
    }
  }
  
  // Get performance metrics
  getMetrics() {
    const avgResponseTime = this.metrics.requests > 0
      ? Math.round(this.metrics.totalResponseTime / this.metrics.requests)
      : 0;
      
    const avgQueryTime = this.metrics.queryCount > 0
      ? Math.round(this.metrics.totalQueryTime / this.metrics.queryCount)
      : 0;
      
    const slowRequestRate = this.metrics.requests > 0
      ? Math.round((this.metrics.slowRequests / this.metrics.requests) * 100)
      : 0;
      
    const slowQueryRate = this.metrics.queryCount > 0
      ? Math.round((this.metrics.slowQueries / this.metrics.queryCount) * 100)
      : 0;
    
    return {
      requests: {
        total: this.metrics.requests,
        slow: this.metrics.slowRequests,
        slowRate: `${slowRequestRate}%`,
        avgResponseTime: `${avgResponseTime}ms`
      },
      queries: {
        total: this.metrics.queryCount,
        slow: this.metrics.slowQueries,
        slowRate: `${slowQueryRate}%`,
        avgQueryTime: `${avgQueryTime}ms`
      },
      errors: this.metrics.errors,
      thresholds: {
        slowApi: `${this.slowApiThreshold}ms`,
        slowQuery: `${this.slowQueryThreshold}ms`
      }
    };
  }
  
  // Reset metrics (useful for testing)
  resetMetrics() {
    this.metrics = {
      requests: 0,
      slowRequests: 0,
      totalResponseTime: 0,
      queryCount: 0,
      slowQueries: 0,
      totalQueryTime: 0,
      errors: 0
    };
  }
  
  // Middleware function for automatic API request logging
  createMiddleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      
      // Generate unique request ID
      req.requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Store original end function
      const originalEnd = res.end;
      
      // Override end function to log performance
      res.end = (chunk, encoding) => {
        const endTime = Date.now();
        this.logApiRequest(req, res, startTime, endTime);
        
        // Call original end function
        originalEnd.call(res, chunk, encoding);
      };
      
      next();
    };
  }
}

// Create singleton instance
const performanceLogger = new PerformanceLogger({
  enabled: process.env.PERF_LOGGING !== 'false',
  logLevel: process.env.LOG_LEVEL || 'info',
  slowQueryThreshold: parseInt(process.env.SLOW_QUERY_THRESHOLD) || 100,
  slowApiThreshold: parseInt(process.env.SLOW_API_THRESHOLD) || 200
});

// Helper function for measuring execution time
function measureTime(fn) {
  return async (...args) => {
    const startTime = Date.now();
    try {
      const result = await fn(...args);
      const endTime = Date.now();
      return { result, executionTime: endTime - startTime };
    } catch (error) {
      const endTime = Date.now();
      throw { error, executionTime: endTime - startTime };
    }
  };
}

// Helper function for database query timing
function wrapDatabaseQuery(queryFn) {
  return async (sql, params = []) => {
    const startTime = Date.now();
    try {
      const result = await queryFn(sql, params);
      const endTime = Date.now();
      performanceLogger.logDatabaseQuery(sql, params, startTime, endTime);
      return result;
    } catch (error) {
      const endTime = Date.now();
      performanceLogger.logDatabaseQuery(sql, params, startTime, endTime, error);
      throw error;
    }
  };
}

module.exports = {
  PerformanceLogger,
  performanceLogger,
  measureTime,
  wrapDatabaseQuery
};