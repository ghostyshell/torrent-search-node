const axios = require('axios');

async function globalSetup() {
  console.log('Global setup starting...');

  // Wait for server to be fully ready and database to be initialized
  console.log('Waiting for server and database initialization...');

  const maxWaitTime = 120000; // 120 seconds (increased for CI)
  const checkInterval = 3000; // 3 seconds (increased for CI)
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const response = await axios.get(
        'http://localhost:3002/health/detailed',
        {
          timeout: 10000, // Increased timeout for CI
        }
      );

      if (
        response.data.status === 'healthy' &&
        response.data.services?.database?.status === 'healthy'
      ) {
        console.log('✅ Server and database are healthy');
        break;
      }
    } catch (error) {
      // Server not ready yet, continue waiting
    }

    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }

  // Warm up the database with some test operations
  console.log('🔥 Warming up database connections...');

  try {
    // Test basic cache operations to establish connections
    const warmupRequests = [
      axios.get('http://localhost:3002/api/cache/stats', { timeout: 15000 }),
      axios.get('http://localhost:3002/health', { timeout: 10000 }),
      axios.get('http://localhost:3002/health/ready', { timeout: 10000 }),
    ];

    await Promise.all(warmupRequests);
    console.log('✅ Database warmup completed');

    // Add a small delay to ensure connections are established
    await new Promise((resolve) => setTimeout(resolve, 3000)); // Increased for CI
  } catch (error) {
    console.warn(
      '⚠️  Database warmup had issues, but continuing:',
      error.message
    );
  }

  console.log('Global setup completed');
}

module.exports = globalSetup;
