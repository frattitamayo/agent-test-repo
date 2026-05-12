# Property Search API

A high-performance property search API built with Node.js, featuring advanced search capabilities, robust error handling, and sub-200ms response times.

## Features

- **Advanced Search**: Multi-parameter filtering (location, price range, bedrooms, bathrooms, property type)
- **High Performance**: Optimized database queries with response times under 200ms
- **Robust Error Handling**: Comprehensive input validation and graceful error responses
- **Security**: SQL injection prevention and input sanitization
- **Caching**: In-memory response caching with configurable TTL
- **Monitoring**: Performance logging and health check endpoints
- **Backward Compatibility**: Maintains existing API contract while adding new features

## Quick Start

### Prerequisites

- Node.js 14.0.0 or higher
- MySQL database (optional - API falls back to sample data)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd property-search-api
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the API server:
   ```bash
   npm start
   ```

4. Test the API:
   ```bash
   curl http://localhost:3000/api/properties/search
   ```

### Development Mode

```bash
npm run dev
```

## API Documentation

### Base URL
```
http://localhost:3000
```

### Endpoints

#### Property Search
```
GET /api/properties/search
```

**Parameters:**
- `city` (string): Filter by city name (partial matching supported)
- `location` (string): Filter by address/location (partial matching)
- `price_min` (number): Minimum price filter
- `price_max` (number): Maximum price filter  
- `bedrooms` (integer): Minimum number of bedrooms
- `bathrooms` (number): Minimum number of bathrooms
- `property_type` (string): Property type filter
  - Valid values: `apartment`, `house`, `condo`, `townhouse`, `studio`, `duplex`, `other`
- `sort` (string): Sort order
  - Valid values: `price_asc`, `price_desc`, `newest`, `oldest`
- `limit` (integer): Maximum number of results (1-100, default: 50)

**Example Requests:**
```bash
# Basic search
curl "http://localhost:3000/api/properties/search"

# Search with filters
curl "http://localhost:3000/api/properties/search?city=downtown&price_min=100000&price_max=500000&bedrooms=2"

# Search with sorting
curl "http://localhost:3000/api/properties/search?sort=price_desc&limit=10"
```

**Response Format:**
```json
{
  "message": "Hello from property search API",
  "query": "/api/properties/search?city=downtown",
  "results": [
    {
      "id": 1,
      "title": "Modern Downtown Apartment",
      "city": "Downtown",
      "price": 450000,
      "bedrooms": 2,
      "bathrooms": 1.5,
      "property_type": "apartment",
      "location": "123 Main St"
    }
  ],
  "metadata": {
    "count": 1,
    "executionTime": "45ms",
    "source": "database",
    "cached": false,
    "searchCriteria": {
      "city": "downtown",
      "sort": "price_asc",
      "limit": 50
    }
  }
}
```

#### Health Check
```
GET /health
```

Returns system health status including database connectivity, cache statistics, and performance metrics.

**Example Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-05-12T19:46:52Z",
  "services": {
    "database": {
      "status": "healthy",
      "pool": {
        "totalConnections": 5,
        "freeConnections": 4,
        "queuedRequests": 0
      }
    },
    "cache": {
      "status": "healthy",
      "stats": {
        "hits": 150,
        "misses": 50,
        "hitRate": "75.00%",
        "size": 45
      }
    }
  }
}
```

## Configuration

The API can be configured using environment variables:

### Server Configuration
- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: localhost)
- `NODE_ENV` - Environment (development/production)

### Database Configuration
- `DB_HOST` - Database host (default: localhost)
- `DB_PORT` - Database port (default: 3306)
- `DB_USER` - Database username (default: root)
- `DB_PASSWORD` - Database password
- `DB_NAME` - Database name (default: property_db)
- `DB_CONNECTION_LIMIT` - Max connections (default: 10)

### Performance Configuration
- `CACHE_ENABLED` - Enable response caching (default: true)
- `CACHE_TTL` - Cache TTL in milliseconds (default: 300000)
- `RESPONSE_TIMEOUT` - API response timeout (default: 200ms)
- `MAX_SEARCH_RESULTS` - Maximum results per query (default: 50)

### Example Configuration
```bash
# .env file
NODE_ENV=production
PORT=8080
DB_HOST=prod-db-server
DB_USER=api_user
DB_PASSWORD=secure_password
DB_NAME=properties_prod
CACHE_TTL=600000
RESPONSE_TIMEOUT=150
```

## Database Setup

### Required Tables

```sql
CREATE TABLE properties (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  city VARCHAR(100),
  location VARCHAR(255),
  price DECIMAL(10,2),
  bedrooms INT,
  bathrooms DECIMAL(3,1),
  property_type ENUM('apartment','house','condo','townhouse','studio','duplex','other'),
  square_feet INT,
  status ENUM('active','inactive','sold') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL
);
```

### Performance Indexes

Run the included index creation script for optimal performance:

```bash
mysql -u your_user -p your_database < backend/database/schema-indexes.sql
```

Key indexes include:
- `idx_properties_price_status` - For price range queries
- `idx_properties_search_common` - Composite index for multi-criteria searches
- `idx_properties_city` and `idx_properties_location` - For location searches

## Testing

### Run All Tests
```bash
npm test
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Test Categories

- **API Integration Tests**: Validate endpoint responses and error handling
- **Performance Tests**: Verify response time requirements
- **Security Tests**: SQL injection and input validation testing  
- **Backward Compatibility**: Ensure existing API contracts are maintained

## Performance Characteristics

### Response Time Targets
- **Target**: < 200ms for 95th percentile
- **Minimum**: < 500ms for basic queries
- **Exceptional**: < 100ms with optimized indexes

### Throughput
- Supports 100+ concurrent requests
- Database connection pooling prevents resource exhaustion
- In-memory caching reduces database load

### Monitoring
- Automatic slow query detection (>100ms)
- Performance metrics collection
- Database connection health monitoring
- Cache hit/miss rate tracking

## Project Structure

```
backend/
├── api/
│   └── properties/
│       └── search.js          # Main API endpoint
├── config/
│   └── environment.js         # Configuration management
├── database/
│   ├── connection-pool.js     # Database connection pooling
│   └── queries/
│       ├── property-search.sql # Optimized search query
│       └── schema-indexes.sql  # Database indexes
├── middleware/
│   ├── validation.js          # Input validation
│   └── error-handler.js       # Error handling
├── monitoring/
│   └── performance-logger.js   # Performance monitoring
├── utils/
│   ├── cache-manager.js       # Response caching
│   └── response-formatter.js  # Response formatting
└── tests/
    ├── api/
    │   └── search.test.js     # API integration tests
    └── database/
        └── query-performance.test.js # Database tests
```

## Error Handling

The API provides detailed error responses with appropriate HTTP status codes:

- **400 Bad Request**: Invalid input parameters
- **404 Not Found**: Unknown endpoints
- **405 Method Not Allowed**: Unsupported HTTP methods
- **500 Internal Server Error**: Server-side errors
- **503 Service Unavailable**: Database connectivity issues
- **504 Gateway Timeout**: Request timeout

### Example Error Response
```json
{
  "error": true,
  "message": "price_min must be a valid number between 0 and 100,000,000",
  "errorCode": "VALIDATION_ERROR",
  "statusCode": 400,
  "timestamp": "2026-05-12T19:46:52Z",
  "requestId": "req_1673540812345_abc123"
}
```

## Security

### Input Validation
- All parameters are validated and sanitized
- SQL injection prevention through parameterized queries
- Input length and type restrictions
- Special character filtering for text inputs

### Database Security
- Connection pooling with timeout limits
- Least-privilege database access
- Prepared statements exclusively
- No dynamic SQL construction

## Development

### Code Quality
- ESLint configuration with security rules
- Jest testing framework
- Security-focused linting rules
- Code coverage reporting

### Contributing
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.
