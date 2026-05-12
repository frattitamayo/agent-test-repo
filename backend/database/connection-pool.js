'use strict';

const mysql = require('mysql2/promise');

// Database configuration with environment variables and defaults
const config = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'property_db',
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT) || 20,
  acquireTimeout: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 60000,
  timeout: parseInt(process.env.DB_TIMEOUT) || 60000,
  reconnect: true,
  charset: 'utf8mb4'
};

// Create the connection pool
const pool = mysql.createPool(config);

// Health check function
async function checkConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return true;
  } catch (error) {
    console.error('Database connection health check failed:', error.message);
    return false;
  }
}

// Graceful shutdown function
async function closePool() {
  try {
    await pool.end();
    console.log('Database connection pool closed gracefully');
  } catch (error) {
    console.error('Error closing database pool:', error.message);
  }
}

// Query wrapper with error handling and performance logging
async function executeQuery(sql, params = []) {
  const startTime = Date.now();
  let connection;
  
  try {
    connection = await pool.getConnection();
    const [rows, fields] = await connection.execute(sql, params);
    const executionTime = Date.now() - startTime;
    
    // Log slow queries (> 100ms)
    if (executionTime > 100) {
      console.warn(`Slow query detected: ${executionTime}ms`, {
        sql: sql.substring(0, 100),
        paramCount: params.length
      });
    }
    
    return { rows, executionTime, affectedRows: rows.affectedRows || 0 };
  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error('Database query error:', {
      error: error.message,
      sql: sql.substring(0, 100),
      executionTime
    });
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

// Pool statistics for monitoring
function getPoolStats() {
  return {
    totalConnections: pool.pool._allConnections?.length || 0,
    freeConnections: pool.pool._freeConnections?.length || 0,
    queuedRequests: pool.pool._connectionQueue?.length || 0
  };
}

module.exports = {
  pool,
  executeQuery,
  checkConnection,
  closePool,
  getPoolStats
};

// Graceful shutdown handlers
process.on('SIGINT', closePool);
process.on('SIGTERM', closePool);
process.on('exit', closePool);