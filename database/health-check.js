#!/usr/bin/env node

/**
 * Database Health Check Script
 * Verifies Turso cloud database connectivity and basic operations
 */

const UnifiedCache = require('./UnifiedCache');

async function healthCheck() {
  console.log('🏥 Starting database health check...\n');

  try {
    // Initialize database connection
    const cache = new UnifiedCache();
    await cache.initializeDatabase();
    console.log('✅ Database connection: HEALTHY');

    // Get database statistics
    const stats = await cache.getStats();
    console.log('✅ Database statistics: ACCESSIBLE');
    console.log(`   - Cache entries: ${stats.cache}`);
    console.log(`   - Images: ${stats.images}`);
    console.log(`   - Stream URLs: ${stats.streamUrls}`);
    console.log(`   - Favorites: ${stats.favorites}`);
    console.log(`   - Cached Links: ${stats.cachedLinks}`);
    console.log(`   - Database Type: ${stats.databaseType}`);
    console.log(`   - Environment: ${stats.environment}`);

    // Test basic operations
    const testKey = `health_check_${Date.now()}`;
    const testValue = { timestamp: new Date().toISOString(), test: true };

    await cache.set(testKey, testValue, 60); // 1 minute TTL
    console.log('✅ Write operation: SUCCESS');

    const retrievedValue = await cache.get(testKey);
    if (JSON.stringify(retrievedValue) === JSON.stringify(testValue)) {
      console.log('✅ Read operation: SUCCESS');
    } else {
      throw new Error('Read operation returned incorrect data');
    }

    await cache.delete(testKey);
    console.log('✅ Delete operation: SUCCESS');

    // Verify deletion
    const deletedValue = await cache.get(testKey);
    if (deletedValue === null) {
      console.log('✅ Delete verification: SUCCESS');
    } else {
      throw new Error('Delete operation did not remove the data');
    }

    await cache.close();
    console.log('\n🎉 Database health check: ALL SYSTEMS OPERATIONAL');
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
