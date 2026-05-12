'use strict';

const request = require('supertest');
const server = require('../../api/properties/search');

// Test configuration
const TEST_TIMEOUT = 5000;

describe('Property Search API', () => {
  let app;
  
  beforeAll(() => {
    app = server;
  });
  
  afterAll((done) => {
    if (app && app.close) {
      app.close(done);
    } else {
      done();
    }
  });
  
  describe('GET /api/properties/search', () => {
    test('should return properties with default parameters', async () => {
      const response = await request(app)
        .get('/api/properties/search')
        .expect(200)
        .expect('Content-Type', /json/);
      
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('results');
      expect(Array.isArray(response.body.results)).toBe(true);
      expect(response.body).toHaveProperty('metadata');
      expect(response.body.metadata).toHaveProperty('executionTime');
    }, TEST_TIMEOUT);
    
    test('should handle city search parameter', async () => {
      const response = await request(app)
        .get('/api/properties/search?city=Sampleville')
        .expect(200);
      
      expect(response.body.results).toBeDefined();
      expect(response.body.metadata.searchCriteria).toHaveProperty('city', 'Sampleville');
    }, TEST_TIMEOUT);
    
    test('should handle price range filters', async () => {
      const response = await request(app)
        .get('/api/properties/search?price_min=500&price_max=1500')
        .expect(200);
      
      expect(response.body.results).toBeDefined();
      expect(response.body.metadata.searchCriteria).toHaveProperty('price_min', 500);
      expect(response.body.metadata.searchCriteria).toHaveProperty('price_max', 1500);
    }, TEST_TIMEOUT);
    
    test('should handle bedroom and bathroom filters', async () => {
      const response = await request(app)
        .get('/api/properties/search?bedrooms=2&bathrooms=1')
        .expect(200);
      
      expect(response.body.results).toBeDefined();
      expect(response.body.metadata.searchCriteria).toHaveProperty('bedrooms', 2);
      expect(response.body.metadata.searchCriteria).toHaveProperty('bathrooms', 1);
    }, TEST_TIMEOUT);
    
    test('should handle property type filter', async () => {
      const response = await request(app)
        .get('/api/properties/search?property_type=apartment')
        .expect(200);
      
      expect(response.body.results).toBeDefined();
      expect(response.body.metadata.searchCriteria).toHaveProperty('property_type', 'apartment');
    }, TEST_TIMEOUT);
    
    test('should handle sorting parameters', async () => {
      const response = await request(app)
        .get('/api/properties/search?sort=price_desc')
        .expect(200);
      
      expect(response.body.results).toBeDefined();
      expect(response.body.metadata.searchCriteria).toHaveProperty('sort', 'price_desc');
    }, TEST_TIMEOUT);
    
    test('should handle limit parameter', async () => {
      const response = await request(app)
        .get('/api/properties/search?limit=5')
        .expect(200);
      
      expect(response.body.results).toBeDefined();
      expect(response.body.results.length).toBeLessThanOrEqual(5);
      expect(response.body.metadata.searchCriteria).toHaveProperty('limit', 5);
    }, TEST_TIMEOUT);
  });
  
  describe('Input Validation', () => {
    test('should reject invalid price_min', async () => {
      const response = await request(app)
        .get('/api/properties/search?price_min=not-a-number')
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('price_min');
    }, TEST_TIMEOUT);
    
    test('should reject invalid price_max', async () => {
      const response = await request(app)
        .get('/api/properties/search?price_max=invalid')
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('price_max');
    }, TEST_TIMEOUT);
    
    test('should reject price_min greater than price_max', async () => {
      const response = await request(app)
        .get('/api/properties/search?price_min=2000&price_max=1000')
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('price_min cannot be greater than price_max');
    }, TEST_TIMEOUT);
    
    test('should reject invalid bedrooms', async () => {
      const response = await request(app)
        .get('/api/properties/search?bedrooms=not-a-number')
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('bedrooms');
    }, TEST_TIMEOUT);
    
    test('should reject invalid property_type', async () => {
      const response = await request(app)
        .get('/api/properties/search?property_type=invalid-type')
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('property_type');
    }, TEST_TIMEOUT);
    
    test('should reject invalid sort parameter', async () => {
      const response = await request(app)
        .get('/api/properties/search?sort=invalid-sort')
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('sort');
    }, TEST_TIMEOUT);
    
    test('should reject limit out of range', async () => {
      const response = await request(app)
        .get('/api/properties/search?limit=500')
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('limit');
    }, TEST_TIMEOUT);
    
    test('should sanitize location input', async () => {
      const response = await request(app)
        .get('/api/properties/search?location=<script>alert("xss")</script>Normal Location')
        .expect(200);
      
      // Should succeed but script tags should be removed
      expect(response.body.metadata.searchCriteria.location).not.toContain('<script>');
      expect(response.body.metadata.searchCriteria.location).toContain('Normal Location');
    }, TEST_TIMEOUT);
  });
  
  describe('Performance Tests', () => {
    test('should respond within 500ms for basic queries', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/properties/search')
        .expect(200);
      
      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(500);
      
      // Check if execution time is reported in metadata
      const reportedTime = parseInt(response.body.metadata.executionTime);
      expect(reportedTime).toBeGreaterThan(0);
      expect(reportedTime).toBeLessThan(500);
    }, TEST_TIMEOUT);
    
    test('should handle multiple concurrent requests', async () => {
      const requests = Array(5).fill().map((_, i) => 
        request(app).get(`/api/properties/search?bedrooms=${i % 3 + 1}`)
      );
      
      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('results');
      });
    }, TEST_TIMEOUT);
  });
  
  describe('Security Tests', () => {
    test('should prevent SQL injection in city parameter', async () => {
      const maliciousInput = "'; DROP TABLE properties; --";
      
      const response = await request(app)
        .get('/api/properties/search')
        .query({ city: maliciousInput });
      
      // Should either return 400 (validation error) or 200 (safely handled)
      expect([200, 400]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body).toHaveProperty('results');
      }
    }, TEST_TIMEOUT);
    
    test('should prevent SQL injection in price parameters', async () => {
      const maliciousInput = "1; DROP TABLE properties; --";
      
      const response = await request(app)
        .get('/api/properties/search')
        .query({ price_min: maliciousInput });
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    }, TEST_TIMEOUT);
  });
  
  describe('Backward Compatibility', () => {
    test('should maintain original response structure', async () => {
      const response = await request(app)
        .get('/api/properties/search')
        .expect(200);
      
      // Check original fields are present
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('query');
      expect(response.body).toHaveProperty('results');
      expect(Array.isArray(response.body.results)).toBe(true);
      
      // Check result structure for backward compatibility
      if (response.body.results.length > 0) {
        const property = response.body.results[0];
        expect(property).toHaveProperty('id');
        expect(property).toHaveProperty('title');
        expect(property).toHaveProperty('city');
        expect(property).toHaveProperty('price');
      }
    }, TEST_TIMEOUT);
  });
  
  describe('Health Check', () => {
    test('should provide health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('services');
      expect(response.body.services).toHaveProperty('database');
      expect(response.body.services).toHaveProperty('cache');
      expect(response.body.services).toHaveProperty('api');
    }, TEST_TIMEOUT);
  });
  
  describe('Error Handling', () => {
    test('should return 404 for unknown endpoints', async () => {
      const response = await request(app)
        .get('/api/unknown')
        .expect(404);
      
      expect(response.body).toHaveProperty('error');
      expect(response.body.errorCode).toBe('NOT_FOUND');
    }, TEST_TIMEOUT);
    
    test('should return 405 for unsupported methods', async () => {
      const response = await request(app)
        .post('/api/properties/search')
        .expect(405);
      
      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('Method not allowed');
    }, TEST_TIMEOUT);
  });
});