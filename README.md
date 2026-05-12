# Property Search API

A RESTful API for property search functionality with SQLite database integration. This backend service provides property listings with filtering capabilities for location, price range, and property type.

## Features

- **Property Search**: Filter properties by location, price range, and property type
- **Pagination**: Configurable page size with automatic total count and navigation
- **Input Validation**: Comprehensive parameter validation with detailed error messages
- **Performance Monitoring**: Response time tracking with 2-second SLA
- **Health Checks**: Database connectivity monitoring and service health endpoint
- **API Documentation**: Built-in documentation endpoint with usage examples

## Structure

```
backend/
├── api/properties/search.js          # Main API server with Express.js
├── database/
│   ├── connection.js                 # SQLite database connection and initialization
│   ├── property-service.js          # Property data access layer
│   ├── queries/property-search.sql  # Parameterized search query
│   └── properties.db                # SQLite database (auto-created)
└── utils/
    ├── validators.js                 # Input validation and sanitization
    └── formatters.js                # Response formatting utilities
```

## Requirements

- Node.js >= 14.0.0
- npm or yarn package manager

## Installation

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Validate Setup** (Optional)
   ```bash
   npm run check
   ```

3. **Start the Server**
   ```bash
   npm start
   ```

   Or for development:
   ```bash
   npm run dev
   ```

3. **Verify Installation**
   - Health Check: http://localhost:3000/health
   - API Documentation: http://localhost:3000/api/docs
   - Sample Search: http://localhost:3000/api/properties/search

4. **Run Tests**
   ```bash
   npm test
   ```
   This will run a comprehensive test suite covering all endpoints and functionality.

## API Endpoints

### Property Search
```
GET /api/properties/search
```

**Query Parameters:**
- `location` (string) - Filter by location or city (partial match)
- `min_price` (integer) - Minimum price in dollars
- `max_price` (integer) - Maximum price in dollars  
- `type` (string) - Property type: `apartment`, `house`, `condo`, `townhouse`, `loft`
- `page` (integer) - Page number (default: 1)
- `limit` (integer) - Results per page (default: 50, max: 200)

**Example Requests:**
```bash
# Search all properties
curl http://localhost:3000/api/properties/search

# Search downtown apartments under $400k
curl "http://localhost:3000/api/properties/search?location=downtown&type=apartment&max_price=400000"

# Search with pagination
curl "http://localhost:3000/api/properties/search?page=2&limit=10"
```

### Individual Property
```
GET /api/properties/:id
```

Get detailed information for a specific property by ID.

### Health Check
```
GET /health
```

Returns service health status and database connectivity.

### API Documentation
```
GET /api/docs
```

Returns comprehensive API documentation with examples.

## Response Format

**Success Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "Cozy Studio Apartment",
      "location": "downtown",
      "city": "Sampleville", 
      "price": 180000,
      "type": "apartment",
      "description": "A charming studio in the heart of downtown...",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 8,
    "hasMore": false,
    "totalPages": 1
  },
  "timestamp": "2024-01-15T14:22:33.123Z"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": {
    "message": "Invalid request parameters",
    "code": 400,
    "details": [
      {
        "field": "min_price",
        "message": "min_price must be a non-negative integer"
      }
    ]
  },
  "timestamp": "2024-01-15T14:22:33.123Z"
}
```

## Sample Data

The database is automatically initialized with sample properties including:
- Downtown apartments and condos
- Suburban houses and townhouses  
- Coastal properties
- Urban lofts
- Price range: $180,000 - $850,000

## Configuration

**Environment Variables:**
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode (development/production)

**Memory Usage:** Optimized to stay under 512MB during normal operation
**Response Time:** Target < 2 seconds for all search queries

## Development

**Key Design Patterns:**
- Parameterized SQL queries for security
- Input validation and sanitization
- Structured error handling with appropriate HTTP status codes
- Connection pooling for database efficiency
- Response pagination for large result sets

**Performance Considerations:**
- Database indexes on searchable columns (location, price, property_type)
- Query timeout handling
- Memory usage monitoring
- Response time tracking

## Troubleshooting

**Database Issues:**
- Database file is created automatically in `backend/database/properties.db`
- Sample data is inserted on first startup
- Check health endpoint for connectivity status

**Common Errors:**
- Port 3000 already in use: Set `PORT` environment variable
- Permission errors: Ensure write access to database directory
- Slow queries: Check database file location and disk space
