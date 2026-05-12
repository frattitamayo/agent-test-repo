'use strict';

class PropertyService {
  constructor(dbConnection) {
    this.db = dbConnection;
  }

  async searchProperties(filters) {
    const { location, min_price, max_price, property_type, page, limit } = filters;
    
    // Calculate offset for pagination
    const offset = (page - 1) * limit;
    
    // Build dynamic query based on provided filters
    let whereConditions = [];
    let queryParams = [];
    
    // Location filter (search in both location and city fields)
    if (location) {
      whereConditions.push('(location LIKE ? OR city LIKE ?)');
      queryParams.push(`%${location}%`, `%${location}%`);
    }
    
    // Price range filters
    if (min_price !== undefined) {
      whereConditions.push('price >= ?');
      queryParams.push(min_price);
    }
    
    if (max_price !== undefined) {
      whereConditions.push('price <= ?');
      queryParams.push(max_price);
    }
    
    // Property type filter
    if (property_type) {
      whereConditions.push('property_type = ?');
      queryParams.push(property_type);
    }
    
    // Build final query
    let query = `
      SELECT id, title, location, city, price, property_type, description, created_at
      FROM properties
    `;
    
    if (whereConditions.length > 0) {
      query += ` WHERE ${whereConditions.join(' AND ')}`;
    }
    
    query += ` ORDER BY price ASC, created_at DESC LIMIT ? OFFSET ?`;
    
    // Add pagination parameters
    queryParams.push(limit, offset);

    try {
      const startTime = Date.now();
      const results = await this.db.executeQuery(query, queryParams);
      const queryTime = Date.now() - startTime;
      
      console.log(`Property search executed in ${queryTime}ms, returned ${results.length} results`);
      
      // Get total count for pagination
      const total = await this.getTotalCount(filters);
      
      return {
        properties: results,
        pagination: {
          page,
          limit,
          total,
          hasMore: offset + results.length < total
        }
      };
    } catch (error) {
      console.error('Property search error:', error.message);
      throw new Error('Failed to search properties');
    }
  }

  async getTotalCount(filters) {
    const { location, min_price, max_price, property_type } = filters;
    
    // Build dynamic count query with same filters as search
    let whereConditions = [];
    let countParams = [];
    
    // Location filter
    if (location) {
      whereConditions.push('(location LIKE ? OR city LIKE ?)');
      countParams.push(`%${location}%`, `%${location}%`);
    }
    
    // Price range filters  
    if (min_price !== undefined) {
      whereConditions.push('price >= ?');
      countParams.push(min_price);
    }
    
    if (max_price !== undefined) {
      whereConditions.push('price <= ?');
      countParams.push(max_price);
    }
    
    // Property type filter
    if (property_type) {
      whereConditions.push('property_type = ?');
      countParams.push(property_type);
    }
    
    let countQuery = 'SELECT COUNT(*) as total FROM properties';
    
    if (whereConditions.length > 0) {
      countQuery += ` WHERE ${whereConditions.join(' AND ')}`;
    }
    
    try {
      const result = await this.db.executeQuery(countQuery, countParams);
      return result[0]?.total || 0;
    } catch (error) {
      console.error('Count query error:', error.message);
      return 0;
    }
  }

  async getPropertyById(id) {
    const query = 'SELECT * FROM properties WHERE id = ?';
    
    try {
      const results = await this.db.executeQuery(query, [id]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      console.error('Get property by ID error:', error.message);
      throw new Error('Failed to retrieve property');
    }
  }
}

module.exports = PropertyService;