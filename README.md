# Property Search API

A robust property search API with comprehensive filtering, pagination, and validation capabilities. This API provides a production-ready endpoint for searching properties with support for multiple criteria including location, price range, and property type.

## Structure

```
backend/
├── api/
│   └── properties/
│       ├── search.js          # Main API endpoint
│       └── validation.js      # Input validation module
└── database/
    ├── connection.js          # Database connection and query execution
    └── queries/
        └── property-search.sql # SQL query templates
```

## Features

- **Comprehensive Filtering**: Search by location, price range, and property type
- **Pagination**: Configurable result pagination with metadata
- **Input Validation**: Robust parameter validation with descriptive error messages
- **Error Handling**: Proper HTTP status codes and sanitized error responses
- **SQL Injection Protection**: Parameterized queries for security
- **API Documentation**: Interactive documentation endpoint
- **CORS Support**: Cross-origin resource sharing enabled
- **Performance Optimized**: Response caching and query optimization

## Quick Start

1. **Prerequisites**: Node.js 12.x or higher
2. **Start the API server**:
   ```bash
   node backend/api/properties/search.js
   ```
3. **Access the API**: http://localhost:3000/api/properties/search
4. **View Documentation**: http://localhost:3000/api/properties/search/docs

## API Reference

### Endpoint: `GET /api/properties/search`

Search for properties with optional filters and pagination.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `location` | string | No | - | Location to search (city or area name) |
| `priceMin` | number | No | - | Minimum price filter |
| `priceMax` | number | No | - | Maximum price filter |
| `propertyType` | string | No | - | Property type: apartment, house, condo, townhouse, studio, loft |
| `page` | integer | No | 1 | Page number for pagination |
| `limit` | integer | No | 10 | Results per page (max: 100) |

#### Example Requests

**Basic search:**
```bash
curl "http://localhost:3000/api/properties/search"
```

**Filtered search:**
```bash
curl "http://localhost:3000/api/properties/search?location=downtown&priceMin=1000&priceMax=2000&propertyType=apartment"
```

**Paginated search:**
```bash
curl "http://localhost:3000/api/properties/search?page=2&limit=5"
```

#### Response Format

**Success Response (200):**
```json
{
  "message": "Hello from property search API",
  "query": "/api/properties/search?location=downtown",
  "results": [
    {
      "id": 1,
      "title": "Cozy Studio Apartment",
      "city": "Sampleville",
      "location": "downtown",
      "price": 900,
      "property_type": "studio"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalResults": 1,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPrevPage": false,
    "limit": 10
  },
  "searchParameters": {
    "location": "downtown",
    "page": 1,
    "limit": 10
  },
  "timestamp": "2026-05-14T19:24:32.000Z"
}
```

**Error Response (400):**
```json
{
  "error": "Invalid search parameters",
  "details": [
    "Minimum price must be a non-negative number"
  ],
  "status": 400
}
```

**Error Response (500):**
```json
{
  "error": "Internal server error",
  "message": "Database temporarily unavailable. Please try again later.",
  "status": 500
}
}
```

### Endpoint: `GET /api/properties/search/docs`

Returns comprehensive API documentation in JSON format.

## Property Types

The API supports the following property types:
- `apartment` - Standard apartment units
- `house` - Single-family houses
- `condo` - Condominium units
- `townhouse` - Multi-level townhouses
- `studio` - Studio apartments
- `loft` - Loft-style units

## Error Handling

The API uses standard HTTP status codes:

- **200**: Successful request with results
- **400**: Bad request - invalid parameters
- **404**: Endpoint not found
- **500**: Internal server error
- **503**: Service unavailable

All error responses include descriptive messages to help with debugging while protecting internal system details.

## Performance

- **Response Time**: Optimized for <500ms response times under normal load
- **Caching**: Responses cached for 5 minutes to improve performance
- **Pagination**: Limits result sets to prevent memory issues
- **Query Optimization**: Database queries are optimized for common search patterns

## Security

- **SQL Injection Protection**: All database queries use parameterized statements
- **Input Validation**: Comprehensive validation prevents malicious input
- **Error Sanitization**: Error messages are sanitized to prevent information disclosure
- **CORS Configuration**: Proper cross-origin resource sharing configuration

## Testing

Test the API with various scenarios:

```bash
# Test basic functionality
curl "http://localhost:3000/api/properties/search"

# Test filtering
curl "http://localhost:3000/api/properties/search?location=downtown&propertyType=apartment"

# Test pagination
curl "http://localhost:3000/api/properties/search?page=1&limit=3"

# Test error handling
curl "http://localhost:3000/api/properties/search?priceMin=invalid"

# Test documentation
curl "http://localhost:3000/api/properties/search/docs"
```

## Development

### File Organization

- **`search.js`**: Main API endpoint with routing and request handling
- **`validation.js`**: Input validation and parameter sanitization
- **`connection.js`**: Database connection and query execution (mock implementation)
- **`property-search.sql`**: SQL query templates with parameterized statements

### Adding New Features

1. **New search parameters**: Add validation logic to `validation.js`
2. **New property fields**: Update the mock data in `connection.js`
3. **New endpoints**: Add routing logic to `search.js`
4. **Database integration**: Replace mock implementation in `connection.js`

### Database Integration

The current implementation uses mock data for demonstration. To integrate with a real database:

1. Replace `connection.js` with actual database connection logic
2. Update SQL queries in `property-search.sql` for your database schema
3. Configure connection parameters via environment variables
4. Add proper connection pooling and error handling

## Troubleshooting

**Common Issues:**

- **Port already in use**: Change the PORT environment variable
- **Module not found**: Ensure all files are in the correct directory structure
- **Validation errors**: Check parameter types and values match requirements
- **Empty results**: Verify search criteria aren't too restrictive

**Getting Help:**

- Check the API documentation endpoint: `/api/properties/search/docs`
- Review error messages for specific guidance
- Test with simpler queries to isolate issues
- Ensure Node.js version compatibility (12.x+)
