'use strict';

const path = require('path');

const config = {
  development: {
    dialect: 'sqlite',
    storage: path.join(__dirname, '..', 'database', 'properties.db'),
    logging: console.log,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  },
  
  production: {
    dialect: 'sqlite',
    storage: process.env.DATABASE_PATH || path.join(__dirname, '..', 'database', 'properties.db'),
    logging: false,
    pool: {
      max: 10,
      min: 1,
      acquire: 30000,
      idle: 10000
    }
  },

  test: {
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false
  }
};

const environment = process.env.NODE_ENV || 'development';

module.exports = config[environment];