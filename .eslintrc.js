module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true
  },
  extends: [
    'eslint:recommended'
  ],
  plugins: [
    'security'
  ],
  rules: {
    // Security rules
    'security/detect-sql-injection': 'error',
    'security/detect-object-injection': 'error',
    'security/detect-non-literal-regexp': 'error',
    'security/detect-unsafe-regex': 'error',
    'security/detect-eval-with-expression': 'error',
    'security/detect-pseudoRandomBytes': 'error',
    'security/detect-possible-timing-attacks': 'error',
    'security/detect-no-csrf-before-method-override': 'error',
    
    // General code quality
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
    
    // Console and debugging
    'no-console': 'off', // Allow console.log in Node.js environment
    'no-debugger': 'error',
    'no-alert': 'error',
    
    // Best practices
    'eqeqeq': 'error',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
    
    // Style (relaxed for this project)
    'quotes': ['warn', 'single'],
    'semi': ['warn', 'always'],
    'indent': ['warn', 2],
    'comma-dangle': ['warn', 'never']
  },
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module'
  },
  overrides: [
    {
      files: ['**/*.test.js'],
      env: {
        jest: true
      },
      rules: {
        // Relax some rules for test files
        'no-unused-expressions': 'off'
      }
    }
  ]
};