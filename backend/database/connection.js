'use strict';

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class DatabaseConnection {
  constructor() {
    this.db = null;
    this.dbPath = path.join(__dirname, 'properties.db');
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Database connection error:', err.message);
          reject(err);
        } else {
          console.log('Connected to SQLite database');
          this.initializeDatabase()
            .then(() => resolve())
            .catch(reject);
        }
      });
    });
  }

  async initializeDatabase() {
    return new Promise((resolve, reject) => {
      // Create properties table if it doesn't exist
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS properties (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          location TEXT NOT NULL,
          city TEXT NOT NULL,
          price INTEGER NOT NULL,
          property_type TEXT NOT NULL,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      this.db.run(createTableQuery, (err) => {
        if (err) {
          reject(err);
        } else {
          // Check if we need to populate with sample data
          this.db.get('SELECT COUNT(*) as count FROM properties', (err, row) => {
            if (err) {
              reject(err);
            } else if (row.count === 0) {
              this.insertSampleData()
                .then(() => resolve())
                .catch(reject);
            } else {
              resolve();
            }
          });
        }
      });
    });
  }

  async insertSampleData() {
    const sampleProperties = [
      {
        title: 'Cozy Studio Apartment',
        location: 'downtown',
        city: 'Sampleville',
        price: 180000,
        property_type: 'apartment',
        description: 'A charming studio in the heart of downtown with modern amenities.'
      },
      {
        title: 'Spacious Family Home',
        location: 'suburbs',
        city: 'Sampletown',
        price: 425000,
        property_type: 'house',
        description: 'Beautiful 4-bedroom home with large backyard perfect for families.'
      },
      {
        title: 'Modern Condo',
        location: 'downtown',
        city: 'Metro City',
        price: 320000,
        property_type: 'condo',
        description: 'Contemporary condo with city views and premium finishes.'
      },
      {
        title: 'Luxury Penthouse',
        location: 'downtown',
        city: 'Metro City',
        price: 850000,
        property_type: 'apartment',
        description: 'Exclusive penthouse with panoramic city views and luxury amenities.'
      },
      {
        title: 'Suburban Townhouse',
        location: 'suburbs',
        city: 'Sampleville',
        price: 275000,
        property_type: 'townhouse',
        description: 'Well-maintained townhouse in quiet neighborhood with excellent schools.'
      },
      {
        title: 'Beach House',
        location: 'coastal',
        city: 'Oceanview',
        price: 650000,
        property_type: 'house',
        description: 'Stunning beachfront property with direct ocean access.'
      },
      {
        title: 'City Loft',
        location: 'downtown',
        city: 'Metro City',
        price: 395000,
        property_type: 'loft',
        description: 'Industrial-style loft in converted warehouse with exposed brick.'
      },
      {
        title: 'Garden Apartment',
        location: 'suburbs',
        city: 'Greenfield',
        price: 210000,
        property_type: 'apartment',
        description: 'Ground-floor apartment with private garden and pet-friendly policy.'
      }
    ];

    const insertQuery = `
      INSERT INTO properties (title, location, city, price, property_type, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      let completed = 0;
      const total = sampleProperties.length;

      sampleProperties.forEach((property) => {
        this.db.run(insertQuery, [
          property.title,
          property.location,
          property.city,
          property.price,
          property.property_type,
          property.description
        ], (err) => {
          if (err) {
            reject(err);
            return;
          }
          
          completed++;
          if (completed === total) {
            console.log(`Inserted ${total} sample properties`);
            resolve();
          }
        });
      });
    });
  }

  async executeQuery(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) {
          console.error('Query execution error:', err.message);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async healthCheck() {
    try {
      await this.executeQuery('SELECT 1');
      return true;
    } catch (error) {
      console.error('Database health check failed:', error.message);
      return false;
    }
  }

  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err.message);
        } else {
          console.log('Database connection closed');
        }
      });
    }
  }
}

module.exports = DatabaseConnection;