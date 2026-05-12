-- Property search query with parameterization
-- Supports location, price range, and property type filtering with pagination

SELECT
  id,
  title,
  location,
  city,
  price,
  property_type,
  description,
  created_at
FROM
  properties
WHERE
  (? IS NULL OR location LIKE '%' || ? || '%' OR city LIKE '%' || ? || '%')
  AND (? IS NULL OR price >= ?)
  AND (? IS NULL OR price <= ?)
  AND (? IS NULL OR property_type = ?)
ORDER BY
  price ASC,
  created_at DESC
LIMIT ? OFFSET ?;
