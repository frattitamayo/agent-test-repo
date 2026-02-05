-- Sample property search query
-- This is just an example and not tied to a specific database.

SELECT
  id,
  title,
  city,
  price
FROM
  properties
WHERE
  (@city IS NULL OR city = @city)
  AND (@min_price IS NULL OR price >= @min_price)
  AND (@max_price IS NULL OR price <= @max_price)
ORDER BY
  price ASC
LIMIT 50;
