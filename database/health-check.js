#!/usr/bin/env node

/**
 * Database Health Check Script
 * Verifies Turso cloud database connectivity and basic operations
 */

const StorageManager = require('./StorageManager');

async function healthCheck() {

  try {
    // Initialize database connection
    const storage = new StorageManager();
    await storage.initialize();

    // Get database statistics
    const stats = await storage.getStats();

    // Test basic operations
    const testKey = `health_check_${Date.now()}`;
    const testValue = { timestamp: new Date().toISOString(), test: true };

    await storage.cache.set(testKey, testValue, 60); // 1 minute TTL

    const retrievedValue = await storage.cache.get(testKey);
    if (JSON.stringify(retrievedValue) === JSON.stringify(testValue)) {

    } else {
      throw new Error('Read operation returned incorrect data');
    }

    await storage.cache.delete(testKey);

    // Verify deletion
    const deletedValue = await storage.cache.get(testKey);
    if (deletedValue === null) {

    } else {
      throw new Error('Delete operation did not remove the data');
    }

    await storage.close();

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Database health check: FAILED');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run health check if called directly
if (require.main === module) {
  healthCheck();
}

module.exports = healthCheck;
