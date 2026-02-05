'use strict';

const http = require('http');

const PORT = process.env.PORT || 3000;

const sampleResults = [
  { id: 1, title: 'Cozy Studio Apartment', city: 'Sampleville', price: 900 },
  { id: 2, title: 'Spacious Family Home', city: 'Sampletown', price: 2500 },
];

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/properties/search')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        message: 'Hello from property search API',
        query: req.url,
        results: sampleResults,
      })
    );
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Property search API listening on http://localhost:${PORT}`);
});
