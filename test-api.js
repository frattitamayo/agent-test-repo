#!/usr/bin/env node
'use strict';

const http = require('http');

const BASE_URL = 'http://localhost:3000';

async function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${path}`;
    console.log(`Testing: ${url}`);
    
    const startTime = Date.now();
    const req = http.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        try {
          const parsed = JSON.parse(data);
          resolve({
            status: res.statusCode,
            data: parsed,
            responseTime
          });
        } catch (error) {
          resolve({
            status: res.statusCode,
            data: data,
            responseTime,
            parseError: true
          });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.setTimeout(5000, () => {
      req.abort();
      reject(new Error('Request timeout'));
    });
  });
}

async function runTests() {
  console.log('🧪 Testing Property Search API\n');
  
  const tests = [
    // Health check
    {
      name: 'Health Check',
      path: '/health'
    },
    
    // Basic search
    {
      name: 'Basic Property Search',
      path: '/api/properties/search'
    },
    
    // Location filter
    {
      name: 'Location Filter (downtown)',
      path: '/api/properties/search?location=downtown'
    },
    
    // Price range
    {
      name: 'Price Range Filter',
      path: '/api/properties/search?min_price=200000&max_price=500000'
    },
    
    // Property type
    {
      name: 'Property Type Filter (apartment)',
      path: '/api/properties/search?type=apartment'
    },
    
    // Pagination
    {
      name: 'Pagination Test',
      path: '/api/properties/search?limit=3&page=1'
    },
    
    // Combined filters
    {
      name: 'Combined Filters',
      path: '/api/properties/search?location=downtown&type=apartment&max_price=400000'
    },
    
    // Invalid parameters
    {
      name: 'Invalid Parameters (should return 400)',
      path: '/api/properties/search?min_price=invalid&max_price=abc'
    },
    
    // Individual property
    {
      name: 'Get Property by ID',
      path: '/api/properties/1'
    },
    
    // Non-existent property
    {
      name: 'Non-existent Property (should return 404)',
      path: '/api/properties/999'
    },
    
    // API documentation
    {
      name: 'API Documentation',
      path: '/api/docs'
    }
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await makeRequest(test.path);
      
      let success = false;
      let message = '';
      
      if (test.name.includes('should return 400')) {
        success = result.status === 400;
        message = success ? '✅ Correctly returned 400' : `❌ Expected 400, got ${result.status}`;
      } else if (test.name.includes('should return 404')) {
        success = result.status === 404;
        message = success ? '✅ Correctly returned 404' : `❌ Expected 404, got ${result.status}`;
      } else {
        success = result.status === 200 && !result.parseError;
        if (success && result.data && result.data.success !== undefined) {
          success = result.data.success === true;
          message = success ? '✅ Success' : '❌ API returned success: false';
        } else {
          message = success ? '✅ Success' : `❌ Status ${result.status}`;
        }
      }
      
      console.log(`${test.name}: ${message} (${result.responseTime}ms)`);
      
      if (success) {
        passed++;
      } else {
        failed++;
        console.log(`   Response: ${JSON.stringify(result.data).substring(0, 200)}...`);
      }
      
      // Check response time
      if (result.responseTime > 2000) {
        console.log(`   ⚠️  Response time exceeded 2s limit: ${result.responseTime}ms`);
      }
      
    } catch (error) {
      console.log(`${test.name}: ❌ Error - ${error.message}`);
      failed++;
    }
    
    console.log('');
  }
  
  console.log(`📊 Test Summary: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed! API is working correctly.');
  } else {
    console.log('❌ Some tests failed. Check the API implementation.');
  }
}

// Check if server is running
makeRequest('/health')
  .then(() => {
    runTests();
  })
  .catch((error) => {
    console.log('❌ Could not connect to API server. Make sure it\'s running on port 3000.');
    console.log('   Start the server with: npm start');
    console.log(`   Error: ${error.message}`);
  });