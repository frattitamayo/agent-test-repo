-- Database indexes for optimal property search performance
-- These indexes should be created to support the property search query

-- Composite index for price range queries (most selective first)
-- This index will significantly speed up price-based searches
CREATE INDEX IF NOT EXISTS idx_properties_price_status ON properties (price, status);

-- Location-based search indexes
-- Separate indexes for city and location searches
CREATE INDEX IF NOT EXISTS idx_properties_city ON properties (city);
CREATE INDEX IF NOT EXISTS idx_properties_location ON properties (location);

-- Full-text search indexes for better LIKE performance
-- These can be used for more advanced text searching if needed
CREATE FULLTEXT INDEX IF NOT EXISTS ft_properties_city ON properties (city);
CREATE FULLTEXT INDEX IF NOT EXISTS ft_properties_location ON properties (location);

-- Property characteristics index for bedroom/bathroom filters
CREATE INDEX IF NOT EXISTS idx_properties_rooms ON properties (bedrooms, bathrooms);

-- Property type index (categorical data)
CREATE INDEX IF NOT EXISTS idx_properties_type_status ON properties (property_type, status);

-- Temporal indexes for sorting by creation/update time
CREATE INDEX IF NOT EXISTS idx_properties_created_at ON properties (created_at);
CREATE INDEX IF NOT EXISTS idx_properties_updated_at ON properties (updated_at);

-- Composite index for common search patterns
-- This index covers the most common search combination: active properties by price and type
CREATE INDEX IF NOT EXISTS idx_properties_search_common ON properties 
  (status, property_type, price, bedrooms, bathrooms);

-- Status and soft delete index
-- Essential for filtering out deleted/inactive properties
CREATE INDEX IF NOT EXISTS idx_properties_status_deleted ON properties (status, deleted_at);

-- Covering index for basic property list (includes commonly selected columns)
-- This can serve entire queries without accessing the main table
CREATE INDEX IF NOT EXISTS idx_properties_covering ON properties 
  (status, deleted_at, price) 
  INCLUDE (id, title, city, location, bedrooms, bathrooms, property_type, created_at);

-- Index usage notes:
-- 1. The price index should be most effective for range queries
-- 2. City/location indexes support both exact matches and LIKE queries  
-- 3. The composite search index handles multi-criteria searches efficiently
-- 4. Covering index can satisfy queries with only basic property data
-- 5. All indexes include status/deleted_at to filter inactive properties

-- Query performance monitoring queries:
-- Use these to monitor index effectiveness:

-- Check index usage:
-- EXPLAIN SELECT * FROM properties WHERE price BETWEEN 100000 AND 500000 AND status = 'active';

-- Show index statistics:
-- SHOW INDEX FROM properties;

-- Monitor slow queries:
-- SELECT * FROM mysql.slow_log WHERE sql_text LIKE '%properties%' ORDER BY start_time DESC LIMIT 10;