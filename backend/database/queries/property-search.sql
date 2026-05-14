-- Enhanced property search query with comprehensive filtering and pagination
-- Uses parameterized queries to prevent SQL injection
-- Supports location, price range, and property type filtering

SELECT
  id,
  title,
  city,
  location,
  price,
  property_type
FROM
  properties
WHERE
  1=1
  -- Location filter (searches both city and location fields)
  AND (
    @location IS NULL 
    OR LOWER(city) LIKE LOWER(CONCAT('%', @location, '%'))
    OR LOWER(location) LIKE LOWER(CONCAT('%', @location, '%'))
  )
  -- Price range filters
  AND (@min_price IS NULL OR price >= @min_price)
  AND (@max_price IS NULL OR price <= @max_price)
  -- Property type filter
  AND (@property_type IS NULL OR LOWER(property_type) = LOWER(@property_type))
ORDER BY
  price ASC
LIMIT @limit OFFSET @offset;

-- Count query for pagination metadata
-- Should be executed alongside the main query
SELECT COUNT(*) as total_count
FROM properties
WHERE
  1=1
  -- Same filters as main query for accurate count
  AND (
    @location IS NULL 
    OR LOWER(city) LIKE LOWER(CONCAT('%', @location, '%'))
    OR LOWER(location) LIKE LOWER(CONCAT('%', @location, '%'))
  )
  AND (@min_price IS NULL OR price >= @min_price)
  AND (@max_price IS NULL OR price <= @max_price)
  AND (@property_type IS NULL OR LOWER(property_type) = LOWER(@property_type));
