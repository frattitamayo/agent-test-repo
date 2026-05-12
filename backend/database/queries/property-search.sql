-- Optimized property search query with parameterized inputs
-- Supports multiple search criteria with proper indexing considerations

SELECT
  p.id,
  p.title,
  p.description,
  p.city,
  p.location,
  p.price,
  p.bedrooms,
  p.bathrooms,
  p.property_type,
  p.square_feet,
  p.created_at,
  p.updated_at
FROM
  properties p
WHERE
  -- Location filters with index-friendly conditions
  (? IS NULL OR p.city LIKE CONCAT('%', ?, '%'))
  AND (? IS NULL OR p.location LIKE CONCAT('%', ?, '%'))
  
  -- Price range filters (highly selective, should use index)
  AND (? IS NULL OR p.price >= ?)
  AND (? IS NULL OR p.price <= ?)
  
  -- Bedroom and bathroom filters
  AND (? IS NULL OR p.bedrooms >= ?)
  AND (? IS NULL OR p.bathrooms >= ?)
  
  -- Property type filter (categorical, good for indexing)
  AND (? IS NULL OR p.property_type = ?)
  
  -- Ensure property is active/available
  AND p.status = 'active'
  AND p.deleted_at IS NULL

ORDER BY
  -- Dynamic sorting based on parameter
  CASE WHEN ? = 'price_asc' THEN p.price END ASC,
  CASE WHEN ? = 'price_desc' THEN p.price END DESC,
  CASE WHEN ? = 'newest' THEN p.created_at END DESC,
  CASE WHEN ? = 'oldest' THEN p.created_at END ASC,
  -- Default fallback sort for consistent results
  p.id ASC

LIMIT ?;
