'use strict';

// Simple in-memory cache implementation with TTL support
class CacheManager {
  constructor(options = {}) {
    this.cache = new Map();
    this.ttl = options.ttl || 300000; // 5 minutes default
    this.maxSize = options.maxSize || 1000;
    this.enabled = options.enabled !== false;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
    
    // Cleanup expired entries every minute
    if (this.enabled) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, 60000);
    }
  }
  
  // Generate cache key from search parameters
  generateKey(searchParams) {
    // Sort parameters for consistent keys
    const sortedParams = Object.keys(searchParams)
      .sort()
      .reduce((result, key) => {
        result[key] = searchParams[key];
        return result;
      }, {});
    
    return JSON.stringify(sortedParams);
  }
  
  // Get value from cache
  get(key) {
    if (!this.enabled) return null;
    
    const item = this.cache.get(key);
    
    if (!item) {
      this.stats.misses++;
      return null;
    }
    
    // Check if item has expired
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    
    // Update access time for LRU-like behavior
    item.lastAccess = Date.now();
    this.stats.hits++;
    
    return item.value;
  }
  
  // Set value in cache
  set(key, value, customTtl = null) {
    if (!this.enabled) return false;
    
    // Use custom TTL or default
    const ttl = customTtl || this.ttl;
    const expires = Date.now() + ttl;
    
    // Check size limits and evict if necessary
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    
    this.cache.set(key, {
      value,
      expires,
      created: Date.now(),
      lastAccess: Date.now()
    });
    
    this.stats.sets++;
    return true;
  }
  
  // Delete value from cache
  delete(key) {
    if (!this.enabled) return false;
    
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.deletes++;
    }
    return deleted;
  }
  
  // Clear all cache
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.deletes += size;
  }
  
  // Get cache statistics
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;
      
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      size: this.cache.size,
      maxSize: this.maxSize,
      enabled: this.enabled
    };
  }
  
  // Cleanup expired entries
  cleanup() {
    const now = Date.now();
    const toDelete = [];
    
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expires) {
        toDelete.push(key);
      }
    }
    
    toDelete.forEach(key => {
      this.cache.delete(key);
      this.stats.deletes++;
    });
    
    return toDelete.length;
  }
  
  // Evict oldest entries (LRU-like behavior)
  evictOldest() {
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, item] of this.cache.entries()) {
      if (item.lastAccess < oldestTime) {
        oldestTime = item.lastAccess;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.deletes++;
    }
  }
  
  // Shutdown cache (cleanup intervals)
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}

// Cache middleware function for property search
function createCacheMiddleware(cacheManager) {
  return function cacheMiddleware(req, res, next) {
    if (!req.searchParams) {
      return next();
    }
    
    // Generate cache key
    const cacheKey = cacheManager.generateKey(req.searchParams);
    
    // Try to get cached response
    const cachedResponse = cacheManager.get(cacheKey);
    
    if (cachedResponse) {
      // Mark as cached and add performance headers
      cachedResponse.data.performance.cached = true;
      
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Cache-Key', cacheKey.substring(0, 32) + '...');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cachedResponse));
      return;
    }
    
    // Cache miss - continue to handler
    res.setHeader('X-Cache', 'MISS');
    
    // Store original end function
    const originalEnd = res.end;
    
    // Override end function to cache response
    res.end = function(chunk, encoding) {
      if (res.statusCode === 200 && chunk) {
        try {
          const responseData = JSON.parse(chunk);
          if (responseData.success) {
            cacheManager.set(cacheKey, responseData);
          }
        } catch (error) {
          // Ignore JSON parse errors for caching
        }
      }
      
      // Call original end function
      originalEnd.call(res, chunk, encoding);
    };
    
    next();
  };
}

// Create singleton cache instance
const defaultCache = new CacheManager({
  ttl: parseInt(process.env.CACHE_TTL) || 300000, // 5 minutes
  maxSize: parseInt(process.env.CACHE_MAX_SIZE) || 1000,
  enabled: process.env.CACHE_ENABLED !== 'false'
});

// Graceful shutdown
process.on('SIGTERM', () => {
  defaultCache.shutdown();
});
process.on('SIGINT', () => {
  defaultCache.shutdown();
});

module.exports = {
  CacheManager,
  createCacheMiddleware,
  defaultCache
};