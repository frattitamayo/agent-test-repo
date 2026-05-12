#!/usr/bin/env node
'use strict';

// Simple startup validation script
console.log('🔍 Property Search API - Startup Validation\n');

// Check Node.js version
const nodeVersion = process.version;
const [major] = nodeVersion.slice(1).split('.').map(Number);

console.log(`Node.js Version: ${nodeVersion}`);
if (major < 14) {
  console.log('❌ Node.js version 14.0.0 or higher is required');
  process.exit(1);
} else {
  console.log('✅ Node.js version requirement met');
}

// Check if required files exist
const fs = require('fs');
const path = require('path');

const requiredFiles = [
  'package.json',
  'backend/api/properties/search.js',
  'backend/database/connection.js',
  'backend/database/property-service.js',
  'backend/utils/validators.js',
  'backend/utils/formatters.js'
];

console.log('\n📁 Checking required files...');
let allFilesExist = true;

for (const file of requiredFiles) {
  if (fs.existsSync(file)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - Missing`);
    allFilesExist = false;
  }
}

if (!allFilesExist) {
  console.log('\n❌ Some required files are missing. Cannot start API.');
  process.exit(1);
}

// Check package.json dependencies
console.log('\n📦 Checking package.json...');
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  const requiredDeps = ['express', 'sqlite3', 'cors'];
  const dependencies = packageJson.dependencies || {};
  
  let allDepsPresent = true;
  for (const dep of requiredDeps) {
    if (dependencies[dep]) {
      console.log(`✅ ${dep}: ${dependencies[dep]}`);
    } else {
      console.log(`❌ ${dep} - Missing from dependencies`);
      allDepsPresent = false;
    }
  }
  
  if (!allDepsPresent) {
    console.log('\n❌ Some dependencies are missing. Run: npm install');
    process.exit(1);
  }
  
} catch (error) {
  console.log(`❌ Error reading package.json: ${error.message}`);
  process.exit(1);
}

// Try to require modules to check for syntax errors
console.log('\n🔧 Validating module syntax...');
try {
  require('./backend/database/connection');
  console.log('✅ Database connection module');
  
  require('./backend/database/property-service');
  console.log('✅ Property service module');
  
  require('./backend/utils/validators');
  console.log('✅ Validators module');
  
  require('./backend/utils/formatters');
  console.log('✅ Formatters module');
  
} catch (error) {
  console.log(`❌ Module syntax error: ${error.message}`);
  console.log('\nFull error:');
  console.log(error.stack);
  process.exit(1);
}

// Check if node_modules exists
console.log('\n📚 Checking dependencies installation...');
if (fs.existsSync('node_modules')) {
  console.log('✅ node_modules directory exists');
  
  // Check if key dependencies are installed
  const depPaths = [
    'node_modules/express',
    'node_modules/sqlite3', 
    'node_modules/cors'
  ];
  
  let allInstalled = true;
  for (const depPath of depPaths) {
    if (fs.existsSync(depPath)) {
      console.log(`✅ ${path.basename(depPath)} installed`);
    } else {
      console.log(`❌ ${path.basename(depPath)} not installed`);
      allInstalled = false;
    }
  }
  
  if (!allInstalled) {
    console.log('\n❌ Some dependencies are not installed. Run: npm install');
    process.exit(1);
  }
  
} else {
  console.log('❌ node_modules directory not found. Run: npm install');
  process.exit(1);
}

console.log('\n🎉 All startup checks passed!');
console.log('\n🚀 Ready to start the API server:');
console.log('   npm start');
console.log('\n📝 Or run tests:');
console.log('   npm test');