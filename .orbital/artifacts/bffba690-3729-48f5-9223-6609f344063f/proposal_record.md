# Proposal Record: Add Property Filtering to Search API

## Interpreted Intent

This orbit extends the existing authenticated property search API to support optional filtering via query parameters while maintaining complete backward compatibility. Users will be able to filter properties by price range (minPrice, maxPrice), location, and property type through standard REST query parameters. The core requirements are:

1. **Filtering Capability** — Accept four optional query parameters that narrow search results using AND logic (all specified filters must match)
2. **Backward Compatibility** — Requests without query parameters must return identical results to current behavior (all properties)
3. **Security** — All filter inputs validated and sanitized, SQL injection prevented through parameterized queries only
4. **Performance** — Filtered queries must complete within 200ms P95 latency for datasets up to 10,000 properties, requiring database indexes

The implementation is constrained to SQL-based filtering (no in-memory JavaScript filtering), standard REST query parameter format, and must preserve the existing response schema. The JWT authentication layer remains unchanged — all search requests continue to require valid tokens.

Success is measured across three tiers: minimum viable (filters work, <500ms), target state (indexes created, <200ms, enhanced validation), and stretch goals (case-insensitive matching, result caching, multiple location values).

## Implementation Plan

### Phase 1: Schema Investigation & Migration Preparation

**1.1 Inspect Current Database Schema**
Before implementing filters, must determine actual column names and types in the properties table:

```sql
-- Execute in database console
d properties  -- PostgreSQL
-- or
DESCRIBE properties;  -- MySQL
```

Expected columns (names may vary):
- `property_id` (PRIMARY KEY)
- `price` or `listing_price` (NUMERIC/DECIMAL)
- `location` or `city` or `address` (VARCHAR/TEXT)
- `property_type` or `type` or `category` (VARCHAR/TEXT)
- Other columns: `description`, `bedrooms`, `created_at`, etc.

**Action:** Document actual column names and update all subsequent SQL to match.

**1.2 Inspect Current property-search.sql Query**
```bash
cat backend/database/queries/property-search.sql
```

Expected content (base query):
```sql
SELECT * FROM properties;
-- or
SELECT property_id, price, location, property_type, description, ... FROM properties;
```

**Action:** Confirm current query structure to understand what SELECT fields exist and ensure they're preserved in filtered version.

**1.3 Create Database Index Migration**

Create **backend/database/migrations/002-add-property-indexes.sql**:

```sql
-- Migration: Add indexes for property search filters
-- Target state requirement for <200ms P95 query performance

-- Index on price for range queries (minPrice, maxPrice)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_price 
ON properties (price);

-- Index on location for equality matching
-- Use functional index for case-insensitive search (stretch goal compatibility)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_location_lower 
ON properties (LOWER(location));

-- Index on property_type for equality matching
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_property_type 
ON properties (property_type);

-- Optional: Composite index for common filter combinations
-- Uncomment if testing shows better performance with composite index
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_filters
-- ON properties (price, location, property_type);

-- Verify indexes created
SELECT schemaname, tablename, indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'properties';
```

**PostgreSQL-specific:** `CONCURRENTLY` keyword prevents table locking during index creation (safe for production). For MySQL, use standard `CREATE INDEX` (may require maintenance window).

**Deployment:** Run migration before deploying filter code to ensure performance targets are achievable.

### Phase 2: SQL Query Modification

**2.1 Modify backend/database/queries/property-search.sql**

Replace current query with parameterized conditional WHERE clause:

```sql
-- Property search query with optional filters
-- Parameters: $1 = minPrice, $2 = maxPrice, $3 = location, $4 = propertyType
-- NULL parameters are treated as "no filter" for that dimension

SELECT 
  property_id,
  price,
  location,
  property_type,
  description,
  bedrooms,
  bathrooms,
  square_feet,
  created_at,
  updated_at
FROM properties
WHERE 
  ($1::numeric IS NULL OR price >= $1)
  AND ($2::numeric IS NULL OR price <= $2)
  AND ($3::text IS NULL OR LOWER(location) = LOWER($3))
  AND ($4::text IS NULL OR property_type = $4)
ORDER BY created_at DESC;
```

**Query Logic:**
- `$1::numeric IS NULL` — If minPrice parameter is null/undefined, condition evaluates to TRUE (skip filter)
- `price >= $1` — If minPrice provided, apply lower bound filter
- `LOWER(location) = LOWER($3)` — Case-insensitive location matching (stretch goal integrated)
- Combined with AND logic — all non-null filters must match

**Performance Optimization:**
- `IS NULL` check short-circuits before column comparison (efficient for unfiltered queries)
- Indexes on price, location, property_type enable fast lookups
- `ORDER BY created_at DESC` can use index if created_at indexed (not in migration, add if needed)

**Alternative for MySQL:**
MySQL doesn't support `$1::numeric` cast syntax. Use placeholder-only version:

```sql
SELECT ... FROM properties
WHERE 
  (? IS NULL OR price >= ?)
  AND (? IS NULL OR price <= ?)
  AND (? IS NULL OR LOWER(location) = LOWER(?))
  AND (? IS NULL OR property_type = ?);
```

Pass parameters twice: `[minPrice, minPrice, maxPrice, maxPrice, location, location, propertyType, propertyType]`

**Decision:** Use PostgreSQL syntax first (matches auth orbit pattern). Document MySQL alternative in comments.

### Phase 3: API Endpoint Modification

**3.1 Modify backend/api/properties/search.js**

Current structure (inferred from auth orbit patterns):
```javascript
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pool = require('../../database/connection');

const searchQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/property-search.sql'),
  'utf8'
);

router.get('/search', async (req, res) => {
  // Current: Execute query with no parameters
  // Need to add: Parameter parsing, validation, parameterized execution
});

module.exports = router;
```

**Modified implementation:**

```javascript
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pool = require('../../database/connection');

// Load SQL query (now with parameterized WHERE clause)
const searchQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/property-search.sql'),
  'utf8'
);

// Validation helper functions
function validateNumericParameter(value, paramName) {
  if (value === undefined || value === null || value === '') {
    return null; // Treat as "no filter"
  }
  
  const parsed = Number(value);
  if (isNaN(parsed)) {
    throw {
      error: 'INVALID_PARAMETER',
      message: `${paramName} must be a valid number`,
      field: paramName
    };
  }
  
  return parsed;
}

function validateStringParameter(value, paramName) {
  if (value === undefined || value === null || value === '') {
    return null; // Treat as "no filter"
  }
  
  if (typeof value !== 'string') {
    throw {
      error: 'INVALID_PARAMETER',
      message: `${paramName} must be a string`,
      field: paramName
    };
  }
  
  // Trim whitespace (stretch goal: normalize input)
  return value.trim();
}

router.get('/search', async (req, res) => {
  try {
    // Parse query parameters
    const { minPrice, maxPrice, location, propertyType } = req.query;
    
    // Validate and convert parameters
    let minPriceValue, maxPriceValue, locationValue, propertyTypeValue;
    
    try {
      minPriceValue = validateNumericParameter(minPrice, 'minPrice');
      maxPriceValue = validateNumericParameter(maxPrice, 'maxPrice');
      locationValue = validateStringParameter(location, 'location');
      propertyTypeValue = validateStringParameter(propertyType, 'propertyType');
    } catch (validationError) {
      return res.status(400).json(validationError);
    }
    
    // Target state: Additional range validation
    if (minPriceValue !== null && minPriceValue < 0) {
      return res.status(400).json({
        error: 'INVALID_PARAMETER',
        message: 'minPrice must be a positive number',
        field: 'minPrice'
      });
    }
    
    if (maxPriceValue !== null && maxPriceValue < 0) {
      return res.status(400).json({
        error: 'INVALID_PARAMETER',
        message: 'maxPrice must be a positive number',
        field: 'maxPrice'
      });
    }
    
    if (minPriceValue !== null && maxPriceValue !== null && minPriceValue > maxPriceValue) {
      return res.status(400).json({
        error: 'INVALID_RANGE',
        message: 'minPrice cannot exceed maxPrice',
        field: 'minPrice'
      });
    }
    
    // Execute parameterized query
    const result = await pool.query(searchQuery, [
      minPriceValue,
      maxPriceValue,
      locationValue,
      propertyTypeValue
    ]);
    
    // Target state: Log filter usage for analytics
    console.log('Property search:', {
      userId: req.user.userId,
      filters: {
        minPrice: minPriceValue,
        maxPrice: maxPriceValue,
        location: locationValue,
        propertyType: propertyTypeValue
      },
      resultCount: result.rows.length,
      executionTime: result.duration || 'N/A'
    });
    
    // Return filtered results (same response format as before)
    res.json(result.rows);
    
  } catch (error) {
    console.error('Property search error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Property search failed'
    });
  }
});

module.exports = router;
```

**Key Implementation Details:**
1. **Backward Compatibility:** Empty/missing parameters converted to `null` → SQL `IS NULL` check passes → no filter applied
2. **Type Coercion:** `Number(value)` handles string-to-number conversion from query parameters
3. **Empty String Handling:** `value === ''` treated as null (not literal empty string filter)
4. **Validation Errors:** Return 400 with field-level error messages (target state requirement)
5. **Logging:** Captures filter parameters and result counts without logging full data (privacy/performance)

### Phase 4: Stretch Goal Enhancements (Optional)

**4.1 Multiple Location Support**

Modify validation to accept comma-separated locations:

```javascript
function validateStringParameter(value, paramName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  
  if (typeof value !== 'string') {
    throw {
      error: 'INVALID_PARAMETER',
      message: `${paramName} must be a string`,
      field: paramName
    };
  }
  
  // Support comma-separated values for location
  if (paramName === 'location') {
    const locations = value.split(',').map(loc => loc.trim()).filter(loc => loc.length > 0);
    return locations.length > 0 ? locations : null;
  }
  
  return value.trim();
}
```

Modify SQL query:

```sql
-- Multiple location support (stretch goal)
AND ($3::text IS NULL OR LOWER(location) = ANY(string_to_array(LOWER($3), ',')))
```

**4.2 Property Type Enum Validation**

Define allowed property types and validate:

```javascript
const VALID_PROPERTY_TYPES = ['apartment', 'house', 'condo', 'townhouse', 'land'];

function validatePropertyType(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  
  const normalized = value.toLowerCase().trim();
  if (!VALID_PROPERTY_TYPES.includes(normalized)) {
    throw {
      error: 'INVALID_PARAMETER',
      message: `propertyType must be one of: ${VALID_PROPERTY_TYPES.join(', ')}`,
      field: 'propertyType'
    };
  }
  
  return normalized;
}
```

**4.3 Query Result Caching**

Implement in-memory cache with TTL for common filter combinations:

```javascript
const NodeCache = require('node-cache');
const filterCache = new NodeCache({ stdTTL: 300 }); // 5-minute TTL

// In route handler, before database query:
const cacheKey = JSON.stringify({
  minPrice: minPriceValue,
  maxPrice: maxPriceValue,
  location: locationValue,
  propertyType: propertyTypeValue
});

const cachedResult = filterCache.get(cacheKey);
if (cachedResult) {
  console.log('Cache hit for filter combination');
  return res.json(cachedResult);
}

// After database query:
filterCache.set(cacheKey, result.rows);
```

**Trade-offs:** Caching adds memory overhead and complexity. Only implement if analytics show repeated identical filter queries.

### Phase 5: Documentation & Testing Setup

**5.1 Update README.md**

Add filtering section after authentication documentation:

```markdown
## Property Search Filtering

The property search endpoint supports optional filters via query parameters.

### Filter Parameters

All parameters are optional. Missing parameters return all properties (no filtering).

- **minPrice** (number) — Minimum property price (inclusive)
- **maxPrice** (number) — Maximum property price (inclusive)
- **location** (string) — Property location (case-insensitive match)
- **propertyType** (string) — Property type/category

### Examples

Search all properties (no filters):
```
GET /api/properties/search
Authorization: Bearer <token>
```

Filter by price range:
```
GET /api/properties/search?minPrice=100000&maxPrice=500000
Authorization: Bearer <token>
```

Filter by location:
```
GET /api/properties/search?location=Seattle
Authorization: Bearer <token>
```

Combine multiple filters (AND logic):
```
GET /api/properties/search?minPrice=200000&maxPrice=400000&location=Seattle&propertyType=apartment
Authorization: Bearer <token>
```

### Error Responses

Invalid parameter types:
```json
{
  "error": "INVALID_PARAMETER",
  "message": "minPrice must be a valid number",
  "field": "minPrice"
}
```

Invalid range:
```json
{
  "error": "INVALID_RANGE",
  "message": "minPrice cannot exceed maxPrice",
  "field": "minPrice"
}
```
```

**5.2 Create Test Data Seeding Script**

Create **scripts/seed-properties.js** for testing:

```javascript
const pool = require('../backend/database/connection');

const testProperties = [
  { price: 150000, location: 'Seattle', property_type: 'apartment', description: 'Cozy downtown apt' },
  { price: 250000, location: 'Seattle', property_type: 'condo', description: 'Modern condo' },
  { price: 450000, location: 'Portland', property_type: 'house', description: 'Family home' },
  { price: 350000, location: 'Portland', property_type: 'townhouse', description: 'Spacious townhouse' },
  { price: 100000, location: 'Tacoma', property_type: 'apartment', description: 'Budget-friendly' },
  { price: 600000, location: 'Seattle', property_type: 'house', description: 'Luxury home' },
  { price: 200000, location: 'Tacoma', property_type: 'condo', description: 'Waterfront condo' },
  { price: 500000, location: 'Portland', property_type: 'house', description: 'Suburban house' }
];

async function seedProperties() {
  try {
    for (const property of testProperties) {
      await pool.query(
        'INSERT INTO properties (price, location, property_type, description) VALUES ($1, $2, $3, $4)',
        [property.price, property.location, property.property_type, property.description]
      );
    }
    console.log(`Seeded ${testProperties.length} test properties`);
  } catch (error) {
    console.error('Seeding error:', error);
  } finally {
    await pool.end();
  }
}

seedProperties();
```

Run: `node scripts/seed-properties.js`

### Phase 6: Deployment Strategy

**6.1 Pre-Deployment Checklist**

1. **Run Migration:** Execute `002-add-property-indexes.sql` in staging/production database
2. **Verify Indexes:** Confirm indexes created with `di properties` (PostgreSQL) or `SHOW INDEX FROM properties` (MySQL)
3. **Test Query Plans:** Run `EXPLAIN ANALYZE` on filtered queries to verify index usage
4. **Baseline Performance:** Measure current unfiltered query latency (establish regression threshold)
5. **Seed Test Data:** Load test properties into staging environment

**6.2 Phased Rollout**

**Phase A: Staging Deployment**
- Deploy filter code to staging environment
- Run integration tests (see Phase 7)
- Performance benchmarking with 10,000 test properties
- Security testing (SQL injection attempts, parameter fuzzing)

**Phase B: Production Deployment (Canary)**
- Deploy to 10% of production traffic
- Monitor error rates, latency P95/P99
- Compare filtered vs unfiltered query performance
- Check database connection pool usage

**Phase C: Full Production Rollout**
- If no issues detected after 24 hours, roll out to 100%
- Continue monitoring for 7 days
- Document any edge cases discovered

**6.3 Rollback Plan**

If critical issues detected:

1. **Immediate:** Revert `backend/api/properties/search.js` to previous version (remove filter logic)
2. **Query File:** Revert `property-search.sql` to simple `SELECT * FROM properties`
3. **Indexes:** Leave indexes in place (safe, may help other queries)
4. **Investigation:** Analyze logs to determine root cause before re-attempting

### Phase 7: Testing Implementation

**7.1 Create Test Suite Structure**

Create **test/api/property-search-filters.test.js**:

```javascript
const request = require('supertest');
const app = require('../../backend/server');
const pool = require('../../backend/database/connection');

describe('Property Search Filters', () => {
  let authToken;
  
  beforeAll(async () => {
    // Get authentication token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });
    authToken = loginResponse.body.token;
    
    // Seed test properties
    await pool.query('DELETE FROM properties'); // Clean slate
    // Insert test data...
  });
  
  afterAll(async () => {
    await pool.end();
  });
  
  describe('Backward Compatibility', () => {
    it('should return all properties when no filters provided', async () => {
      const response = await request(app)
        .get('/api/properties/search')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });
  
  describe('Price Range Filtering', () => {
    it('should filter by minPrice', async () => {
      const response = await request(app)
        .get('/api/properties/search?minPrice=200000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(response.body.every(p => p.price >= 200000)).toBe(true);
    });
    
    it('should filter by maxPrice', async () => {
      const response = await request(app)
        .get('/api/properties/search?maxPrice=300000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(response.body.every(p => p.price <= 300000)).toBe(true);
    });
    
    it('should filter by price range', async () => {
      const response = await request(app)
        .get('/api/properties/search?minPrice=200000&maxPrice=400000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(response.body.every(p => p.price >= 200000 && p.price <= 400000)).toBe(true);
    });
  });
  
  describe('Location Filtering', () => {
    it('should filter by location (case-insensitive)', async () => {
      const response = await request(app)
        .get('/api/properties/search?location=seattle')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(response.body.every(p => p.location.toLowerCase() === 'seattle')).toBe(true);
    });
  });
  
  describe('Property Type Filtering', () => {
    it('should filter by propertyType', async () => {
      const response = await request(app)
        .get('/api/properties/search?propertyType=apartment')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(response.body.every(p => p.property_type === 'apartment')).toBe(true);
    });
  });
  
  describe('Combined Filters (AND logic)', () => {
    it('should apply all filters simultaneously', async () => {
      const response = await request(app)
        .get('/api/properties/search?minPrice=100000&maxPrice=300000&location=Seattle&propertyType=apartment')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(response.body.every(p => 
        p.price >= 100000 && 
        p.price <= 300000 && 
        p.location.toLowerCase() === 'seattle' &&
        p.property_type === 'apartment'
      )).toBe(true);
    });
  });
  
  describe('Validation Errors', () => {
    it('should return 400 for non-numeric minPrice', async () => {
      const response = await request(app)
        .get('/api/properties/search?minPrice=notanumber')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
      
      expect(response.body.error).toBe('INVALID_PARAMETER');
      expect(response.body.field).toBe('minPrice');
    });
    
    it('should return 400 when minPrice > maxPrice', async () => {
      const response = await request(app)
        .get('/api/properties/search?minPrice=500000&maxPrice=100000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
      
      expect(response.body.error).toBe('INVALID_RANGE');
    });
    
    it('should return 400 for negative prices', async () => {
      const response = await request(app)
        .get('/api/properties/search?minPrice=-1000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
      
      expect(response.body.error).toBe('INVALID_PARAMETER');
    });
  });
  
  describe('Edge Cases', () => {
    it('should treat empty string parameters as no filter', async () => {
      const response = await request(app)
        .get('/api/properties/search?minPrice=&location=')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(Array.isArray(response.body)).toBe(true);
    });
    
    it('should handle zero as valid minPrice', async () => {
      const response = await request(app)
        .get('/api/properties/search?minPrice=0')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(response.body.every(p => p.price >= 0)).toBe(true);
    });
  });
});
```

**7.2 Performance Benchmark Test**

Create **test/performance/filter-latency.test.js**:

```javascript
describe('Filter Performance', () => {
  it('should complete filtered queries in under 200ms P95', async () => {
    const iterations = 100;
    const latencies = [];
    
    const filterCombinations = [
      '?minPrice=200000&maxPrice=400000',
      '?location=Seattle',
      '?propertyType=apartment',
      '?minPrice=100000&location=Portland&propertyType=house'
    ];
    
    for (const filters of filterCombinations) {
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await request(app)
          .get(`/api/properties/search${filters}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);
        latencies.push(Date.now() - start);
      }
    }
    
    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95Latency = latencies[p95Index];
    
    console.log(`Filter query P95 latency: ${p95Latency}ms`);
    expect(p95Latency).toBeLessThan(200); // Target state
  });
});
```

## Risk Surface

### Critical Implementation Risks

| Risk | Mitigation Strategy | Verification Method |
|------|-------------------|-------------------|
| **SQL Injection via Query Parameters** | Use parameterized queries exclusively (`$1, $2, $3, $4`). Never concatenate user input. Validate all parameters before query execution. | Manual code review of SQL construction. Automated SQL injection test suite. Fuzzing with SQL keywords and special characters. |
| **Backward Compatibility Break** | Treat missing/empty parameters as `null` → SQL `IS NULL` check passes → no filtering. Test unfiltered endpoint extensively before deployment. | Automated regression test comparing unfiltered results pre/post deployment. Load test with zero-parameter requests. |
| **Performance Regression (Unfiltered)** | Use `IS NULL` short-circuit pattern in SQL. Profile query execution with EXPLAIN ANALYZE. Monitor production latency. | Benchmark unfiltered query before/after. Alert if P95 latency increases >10ms. Database query plan analysis. |
| **Missing Indexes Impact** | Create indexes before deploying filter code. Use CONCURRENTLY (PostgreSQL) to avoid blocking. Test query plans verify index usage. | EXPLAIN ANALYZE on all filter combinations. Monitor sequential scan rate in database metrics. Performance benchmark with 10k properties. |
| **Type Coercion Vulnerabilities** | Strict type validation with `isNaN()`, `typeof` checks. Reject invalid types with 400 errors. Convert empty strings to null. | Property-based testing with random inputs. Fuzzing with edge cases (NaN, Infinity, null string, special characters). |

### Edge Case Handling

| Edge Case | Behavior | Test Coverage |
|-----------|----------|---------------|
| `minPrice=0` | Valid (free properties exist), apply filter | Unit test validates 0 is accepted and filters correctly |
| `maxPrice=0` | Invalid (illogical), return 400 error | Validation test expects 400 with INVALID_PARAMETER |
| `minPrice > maxPrice` | Invalid, return 400 with INVALID_RANGE error | Validation test checks error message and field reference |
| `location=""` (empty string) | Convert to null, treat as no filter | Edge case test verifies empty string doesn't match literal empty location |
| `location="null"` | Treat as string literal "null", not null value | Test verifies parameterized query handles string "null" correctly |
| SQL keywords in location | "SELECT", "DROP TABLE" → validate as string, parameterized query prevents injection | Security test attempts injection with SQL keywords in all parameters |
| Very large numbers | `minPrice=9007199254740991` (MAX_SAFE_INTEGER) → validate, handle overflow | Boundary test with Number.MAX_SAFE_INTEGER, ensure database handles |
| Negative prices | `minPrice=-1000` → validate positive numbers, return 400 | Validation test expects 400 for negative minPrice/maxPrice |
| Special characters | `location="Seattle; DROP--"` → parameterized query prevents injection | SQL injection test suite includes special character combinations |
| Unicode characters | `location="Zürich"` → ensure UTF-8 handling, case-insensitive works | International character test with various encodings |
| No results | Overly restrictive filters → return empty array `[]` | Test verifies empty array returned, not null or error |

### Security Attack Vectors & Defenses

| Attack | Defense Mechanism | Verification |
|--------|------------------|--------------|
| SQL Injection (minPrice) | Type validation (must be number), parameterized `$1` | Automated injection test: `?minPrice=1 OR 1=1--` expects 400 |
| SQL Injection (location) | Parameterized `$3`, LOWER() in SQL only | Injection test: `?location=Seattle' OR '1'='1` expects safe handling |
| Parameter Pollution | Validate expected parameters only, reject unknown | Test with extra parameters: `?minPrice=100&hacker=value` ignored |
| DoS via Expensive Queries | Inherit 2-second query timeout from pool, monitor slow queries | Load test with complex filter combinations, verify timeout enforcement |
| Information Disclosure | Generic error messages, no stack traces, no schema details | Error test verifies sensitive info not leaked in 400/500 responses |
| Authentication Bypass | Authenticate middleware runs before filter logic | Test unfiltered/filtered requests without token expect 401 |

### Performance Risk Mitigation

**Query Optimization Strategy:**
1. **Index Usage Verification:** Run `EXPLAIN ANALYZE` on all filter combinations before deployment
2. **Index Strategy:** Separate single-column indexes (price, location_lower, property_type) sufficient for AND-combined filters
3. **Fallback Plan:** If indexes don't improve performance, consider composite index `(price, location, property_type)` in follow-up migration
4. **Connection Pool:** Monitor active connections under load, current 20-connection limit should suffice

**Performance Monitoring:**
- Track P50/P95/P99 latency by filter combination
- Alert if P95 exceeds 200ms (target state) or 500ms (hard requirement)
- Monitor index hit rate (goal: >90% index seeks, <10% sequential scans)
- Log slow queries (>200ms) with filter parameters for analysis

**Regression Prevention:**
- Baseline unfiltered query latency before deployment
- Automated performance test fails if P95 increases >50ms
- Canary deployment monitors latency metrics before full rollout

### Monitoring & Observability

**Metrics to Implement:**
```javascript
// In search endpoint, after query execution:
console.log('Property search metrics:', {
  userId: req.user.userId,
  filters: { minPrice, maxPrice, location, propertyType },
  resultCount: result.rows.length,
  queryDuration: result.duration,
  timestamp: new Date().toISOString()
});
```

**Dashboard Metrics:**
- Filter usage frequency (which parameters used most)
- Query latency by filter combination
- Empty result rate (filters too restrictive indicator)
- Validation error rate by parameter type
- Database index hit vs sequential scan ratio

**Alerting Thresholds:**
- P95 latency >200ms for 5 consecutive minutes → investigate performance
- Validation error rate >5% → possible client misconfiguration or API docs issue
- Empty result rate >50% → filter UX problem, users not finding properties
- Sequential scan rate >10% → missing or unused indexes

## Scope Estimate

### Complexity Assessment: **LOW-MEDIUM**

**Factors:**
- **Well-established pattern:** Query parameter filtering is standard REST API functionality
- **Clear constraints:** Parameterized queries, type validation, index creation all have known implementations
- **Existing infrastructure:** Database connection pool, authentication, error handling already in place
- **Unknown variables:** Actual database schema (column names), current query structure, production data distribution

**Complexity Drivers:**
- SQL query modification requires careful parameterization (security critical)
- Performance testing needs realistic dataset (10,000 properties)
- Backward compatibility testing essential (high user impact if broken)
- Index creation on production database (requires coordination)

### Work Breakdown

**Phase 1: Investigation & Setup (1-2 hours)**
- Inspect database schema for column names and types
- Review current property-search.sql query structure
- Document baseline performance metrics (unfiltered query)
- Create index migration script
- **Exit Criteria:** Schema documented, migration ready, baseline captured

**Phase 2: SQL & API Implementation (3-4 hours)**
- Modify property-search.sql with parameterized WHERE clause
- Implement parameter validation in search.js
- Add error handling for validation failures
- Implement logging for filter usage
- **Exit Criteria:** Code complete, passes lint/type checks, unit tests written

**Phase 3: Testing & Performance Validation (2-3 hours)**
- Write automated test suite (backward compatibility, filters, validation, edge cases)
- Create test data seeding script
- Run performance benchmarks with 10k properties
- Test query plans with EXPLAIN ANALYZE
- **Exit Criteria:** All tests pass, P95 latency <200ms achieved, indexes verified

**Phase 4: Documentation & Deployment (1-2 hours)**
- Update README with filtering examples
- Document error codes and validation rules
- Deploy to staging environment
- Run staging integration tests
- **Exit Criteria:** Documentation complete, staging validated, production deployment plan ready

**Total Estimated Time:** 7-11 hours of development work

### Phased Implementation Strategy

**Minimum Viable Scope (Required for Acceptance):**
- Query parameter parsing and validation (minPrice, maxPrice, location, propertyType)
- Parameterized SQL query with conditional WHERE clause
- Backward compatibility (no parameters = no filtering)
- Error handling (400 for invalid inputs)
- Basic testing (happy path + validation errors)
- Query execution <500ms for 10k properties

**Target State Scope (Should Achieve):**
- Database indexes created (price, location_lower, property_type)
- Enhanced validation (range checks, positive numbers)
- Field-level error messages
- Request logging with filter parameters
- Performance optimization to <200ms P95
- Comprehensive test coverage

**Stretch Goal Scope (Nice to Have):**
- Case-insensitive location matching (included in base SQL)
- Multiple location values (comma-separated)
- Property type enum validation
- Query result caching (5-minute TTL)
- Performance metrics endpoint
- Integration test coverage >80%

### Success Metrics

**Minimum Viable Success:**
- All filter parameters accepted and functional
- No breaking changes to unfiltered endpoint
- SQL injection prevented (parameterized queries verified)
- Query latency <500ms P95 for 10k properties
- Automated tests pass (backward compatibility, filtering, validation)

**Target State Success:**
- Query latency <200ms P95 with indexes
- Range validation rejects illogical inputs (minPrice > maxPrice)
- Field-level error messages implemented
- Filter usage logged for analytics
- No performance regression on unfiltered queries

**Stretch Goal Success:**
- Case-insensitive location matching working
- Multiple location support implemented
- Property type enum validation active
- Query caching reduces repeated filter query latency
- Performance dashboard shows filter usage patterns

### Deployment Timeline

**Week 1:**
- Days 1-2: Investigation, schema documentation, baseline metrics
- Days 3-4: Implementation (SQL + API code)
- Day 5: Testing and performance validation

**Week 2:**
- Day 1: Deploy indexes to staging database (CONCURRENTLY)
- Day 2: Deploy filter code to staging, run integration tests
- Day 3: Performance benchmarking, query plan analysis
- Day 4: Documentation, code review, security review
- Day 5: Deploy to production (canary rollout)

**Week 3:**
- Monitor production metrics, validate performance targets met
- Address any edge cases discovered in production
- Document lessons learned for future filtering features

### Risk-Adjusted Timeline

**Best Case (7 hours):** Schema matches expected, no surprises, indexes improve performance as expected, all tests pass first try

**Realistic Case (9 hours):** Minor schema differences require SQL adjustments, some test failures require debugging, performance tuning needed

**Worst Case (15 hours):** Unexpected schema structure requires significant SQL rewrite, performance targets require query optimization, backward compatibility issues discovered, index creation blocked by production constraints

**Contingency:** If worst-case timeline exceeded, consider partial rollout (deploy indexes first, enable filters later) or re-scope to minimum viable only.

## Human Modifications

Pending human review.