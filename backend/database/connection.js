'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Database connection and query execution module
 * This is a mock implementation that simulates database behavior
 * In a real application, this would connect to an actual database
 */

// Mock property data that simulates database content
const MOCK_PROPERTIES = [
  { id: 1, title: 'Cozy Studio Apartment', city: 'Sampleville', location: 'downtown', price: 900, property_type: 'studio' },
  { id: 2, title: 'Spacious Family Home', city: 'Sampletown', location: 'suburbs', price: 2500, property_type: 'house' },
  { id: 3, title: 'Modern Condo', city: 'Sampleville', location: 'downtown', price: 1800, property_type: 'condo' },
  { id: 4, title: 'Luxury Loft', city: 'Cityville', location: 'downtown', price: 3200, property_type: 'loft' },
  { id: 5, title: 'Suburban Townhouse', city: 'Sampletown', location: 'suburbs', price: 2200, property_type: 'townhouse' },
  { id: 6, title: 'City Center Apartment', city: 'Sampleville', location: 'downtown', price: 1500, property_type: 'apartment' },
  { id: 7, title: 'Garden Home', city: 'Greentown', location: 'suburbs', price: 2800, property_type: 'house' },
  { id: 8, title: 'Penthouse Suite', city: 'Cityville', location: 'downtown', price: 4500, property_type: 'apartment' },
  { id: 9, title: 'Starter Condo', city: 'Sampletown', location: 'midtown', price: 1200, property_type: 'condo' },
  { id: 10, title: 'Historic Townhouse', city: 'Oldtown', location: 'historic', price: 3500, property_type: 'townhouse' }
];

/**
 * Simulates database query execution with filtering and pagination
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} - Query results with pagination info
 */
async function executePropertySearch(params) {
  // Simulate some database latency
  await new Promise(resolve => setTimeout(resolve, 50));
  
  let results = [...MOCK_PROPERTIES];
  
  // Apply filters
  if (params.location) {
    results = results.filter(property => 
      property.location.toLowerCase().includes(params.location.toLowerCase()) ||
      property.city.toLowerCase().includes(params.location.toLowerCase())
    );
  }
  
  if (params.priceMin !== undefined) {
    results = results.filter(property => property.price >= params.priceMin);
  }
  
  if (params.priceMax !== undefined) {
    results = results.filter(property => property.price <= params.priceMax);
  }
  
  if (params.propertyType) {
    results = results.filter(property => property.property_type === params.propertyType);
  }
  
  // Calculate pagination
  const totalResults = results.length;
  const totalPages = Math.ceil(totalResults / params.limit);
  const offset = (params.page - 1) * params.limit;
  
  // Apply pagination
  const paginatedResults = results
    .sort((a, b) => a.price - b.price) // Sort by price ascending
    .slice(offset, offset + params.limit);
  
  return {
    results: paginatedResults,
    totalResults,
    totalPages,
    currentPage: params.page,
    hasNextPage: params.page < totalPages,
    hasPrevPage: params.page > 1
  };
}

/**
 * Loads SQL query from file (for reference, not used in mock implementation)
 * @param {string} queryName - Name of the SQL file
 * @returns {string} - SQL query string
 */
function loadSQLQuery(queryName) {
  const queryPath = path.join(__dirname, 'queries', `${queryName}.sql`);
  try {
    return fs.readFileSync(queryPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to load SQL query: ${queryName}`);
  }
}

/**
 * Simulates database health check
 * @returns {Promise<boolean>} - Database availability status
 */
async function checkDatabaseHealth() {
  // Simulate health check latency
  await new Promise(resolve => setTimeout(resolve, 10));
  return true; // Mock implementation always reports healthy
}

module.exports = {
  executePropertySearch,
  loadSQLQuery,
  checkDatabaseHealth
};