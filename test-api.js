#!/usr/bin/env node
'use strict';

/**
 * Simple API test script for property search functionality
 * This script verifies basic functionality, error handling, and backward compatibility
 */

const http = require('http');
const { URL } = require('url');

const BASE_URL = 'http://localhost:3000';
const TESTS_PASSED = [];
const TESTS_FAILED = [];

/**
 * Makes HTTP GET request and returns parsed JSON response
 */
function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (error) {
          resolve({ status: res.statusCode, data: data, headers: res.headers, parseError: error });
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Test runner with detailed output
 */
async function runTest(name, testFn) {
  try {
    console.log(`\n🔄 Running: ${name}`);
    await testFn();
    console.log(`✅ PASSED: ${name}`);
    TESTS_PASSED.push(name);
  } catch (error) {
    console.log(`❌ FAILED: ${name}`);
    console.log(`   Error: ${error.message}`);
    TESTS_FAILED.push({ name, error: error.message });
  }
}

/**
 * Test backward compatibility with original API
 */
async function testBackwardCompatibility() {
  const response = await makeRequest('/api/properties/search');
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  // Check required original fields exist
  const requiredFields = ['message', 'query', 'results'];
  for (const field of requiredFields) {
    if (!(field in response.data)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  // Verify message matches original
  if (response.data.message !== 'Hello from property search API') {
    throw new Error('Message field does not match original');
  }
  
  // Verify results is an array
  if (!Array.isArray(response.data.results)) {
    throw new Error('Results field is not an array');
  }
}

/**
 * Test enhanced parameter filtering
 */
async function testEnhancedFiltering() {
  const testCases = [
    '/api/properties/search?location=downtown',
    '/api/properties/search?priceMin=1000&priceMax=2000',
    '/api/properties/search?propertyType=apartment',
    '/api/properties/search?location=downtown&propertyType=apartment&priceMin=500&priceMax=2500'
  ];
  
  for (const testCase of testCases) {
    const response = await makeRequest(testCase);
    
    if (response.status !== 200) {
      throw new Error(`Filter test failed for ${testCase}: status ${response.status}`);
    }
    
    if (!response.data.pagination) {
      throw new Error(`Missing pagination data for ${testCase}`);
    }
    
    if (!response.data.searchParameters) {
      throw new Error(`Missing search parameters for ${testCase}`);
    }
  }
}

/**
 * Test pagination functionality
 */
async function testPagination() {
  const response = await makeRequest('/api/properties/search?page=1&limit=3');
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  const requiredPaginationFields = ['currentPage', 'totalResults', 'totalPages', 'hasNextPage', 'hasPrevPage', 'limit'];
  for (const field of requiredPaginationFields) {
    if (!(field in response.data.pagination)) {
      throw new Error(`Missing pagination field: ${field}`);
    }
  }
  
  if (response.data.pagination.currentPage !== 1) {
    throw new Error('Current page should be 1');
  }
  
  if (response.data.pagination.limit !== 3) {
    throw new Error('Limit should be 3');
  }
}

/**
 * Test input validation and error handling
 */
async function testInputValidation() {
  const errorCases = [
    { path: '/api/properties/search?priceMin=invalid', expectedStatus: 400 },
    { path: '/api/properties/search?limit=-5', expectedStatus: 400 },
    { path: '/api/properties/search?propertyType=invalid', expectedStatus: 400 },
    { path: '/api/properties/search?page=0', expectedStatus: 400 }
  ];
  
  for (const testCase of errorCases) {
    const response = await makeRequest(testCase.path);
    
    if (response.status !== testCase.expectedStatus) {
      throw new Error(`Expected status ${testCase.expectedStatus} for ${testCase.path}, got ${response.status}`);
    }
    
    if (!response.data.error) {
      throw new Error(`Missing error field in response for ${testCase.path}`);
    }
    
    if (!response.data.details || !Array.isArray(response.data.details)) {
      throw new Error(`Missing or invalid details field for ${testCase.path}`);
    }
  }
}

/**
 * Test documentation endpoint
 */
async function testDocumentationEndpoint() {
  const response = await makeRequest('/api/properties/search/docs');
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  const requiredDocFields = ['title', 'version', 'baseUrl', 'endpoints'];
  for (const field of requiredDocFields) {
    if (!(field in response.data)) {
      throw new Error(`Missing documentation field: ${field}`);
    }
  }
  
  if (!response.data.endpoints['/api/properties/search']) {
    throw new Error('Missing search endpoint documentation');
  }
}

/**
 * Test response format and structure
 */
async function testResponseFormat() {
  const response = await makeRequest('/api/properties/search?limit=1');
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  // Check response structure
  const expectedStructure = {
    message: 'string',
    query: 'string',
    results: 'array',
    pagination: 'object',
    searchParameters: 'object',
    timestamp: 'string'
  };
  
  for (const [field, expectedType] of Object.entries(expectedStructure)) {
    if (!(field in response.data)) {
      throw new Error(`Missing field: ${field}`);
    }
    
    const actualType = Array.isArray(response.data[field]) ? 'array' : typeof response.data[field];
    if (actualType !== expectedType) {
      throw new Error(`Field ${field} has type ${actualType}, expected ${expectedType}`);
    }
  }
  
  // Check if results have proper structure
  if (response.data.results.length > 0) {
    const result = response.data.results[0];
    const requiredResultFields = ['id', 'title', 'city', 'price'];
    for (const field of requiredResultFields) {
      if (!(field in result)) {
        throw new Error(`Missing result field: ${field}`);
      }
    }
  }
}

/**
 * Test performance (basic response time check)
 */
async function testPerformance() {
  const startTime = Date.now();
  const response = await makeRequest('/api/properties/search?location=downtown');
  const responseTime = Date.now() - startTime;
  
  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }
  
  if (responseTime > 500) {
    console.log(`⚠️  Warning: Response time ${responseTime}ms exceeds 500ms target`);
  }
  
  console.log(`   Response time: ${responseTime}ms`);
}

/**
 * Main test runner
 */
async function main() {
  console.log('🚀 Starting Property Search API Tests');
  console.log('=' .repeat(50));
  
  // Check if server is running
  try {
    await makeRequest('/api/properties/search');
  } catch (error) {
    console.log('❌ Server is not running. Please start the API first:');
    console.log('   node backend/api/properties/search.js');
    process.exit(1);
  }
  
  await runTest('Backward Compatibility', testBackwardCompatibility);
  await runTest('Enhanced Filtering', testEnhancedFiltering);
  await runTest('Pagination Functionality', testPagination);
  await runTest('Input Validation', testInputValidation);
  await runTest('Documentation Endpoint', testDocumentationEndpoint);
  await runTest('Response Format', testResponseFormat);
  await runTest('Performance Check', testPerformance);
  
  // Test summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary');
  console.log('=' .repeat(50));
  console.log(`✅ Passed: ${TESTS_PASSED.length}`);
  console.log(`❌ Failed: ${TESTS_FAILED.length}`);
  
  if (TESTS_FAILED.length > 0) {
    console.log('\nFailed Tests:');
    TESTS_FAILED.forEach(test => {
      console.log(`  • ${test.name}: ${test.error}`);
    });
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    console.log('\nNext steps:');
    console.log('• Test the API manually with curl or a browser');
    console.log('• Check the documentation at http://localhost:3000/api/properties/search/docs');
    console.log('• Integrate with your application');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('💥 Test runner failed:', error);
    process.exit(1);
  });
}