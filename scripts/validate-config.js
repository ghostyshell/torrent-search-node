#!/usr/bin/env node

/**
 * Configuration validation script
 * Run this before deployment to validate environment configuration
 */

const { config, validateEnvironment } = require('../config/environment');
const { validateCorsConfig } = require('../middleware/cors');

console.log('🔍 Validating configuration...\n');

// Environment info
console.log('📋 Environment Information:');
console.log(`   Environment: ${config.environment}`);
console.log(`   Node Version: ${process.version}`);
console.log(`   Platform: ${process.platform}`);
console.log(`   Architecture: ${process.arch}\n`);

// Server configuration
console.log('🖥️  Server Configuration:');
console.log(`   Port: ${config.server.port}`);
console.log(`   Host: ${config.server.host}\n`);

// Database configuration
console.log('🗄️  Database Configuration:');
console.log(`   Use Cloud DB: ${config.database.useCloudDb}`);
console.log(
  `   Turso URL: ${config.database.turso.url ? '✅ Set' : '❌ Missing'}`
);
console.log(
  `   Turso Token: ${config.database.turso.authToken ? '✅ Set' : '❌ Missing'}`
);
console.log();

// CORS configuration
console.log('🌐 CORS Configuration:');
console.log(`   Origins: ${config.cors.origins.join(', ')}`);
console.log(`   Credentials: ${config.cors.credentials}`);
console.log();

// API configuration
console.log('🔑 API Configuration:');
console.log(
  `   Google Service Account: ${
    config.google.serviceAccountJson ? '✅ Set' : '❌ Missing'
  }`
);
console.log(
  `   Google CSE ID: ${
    config.google.customSearchEngineId ? '✅ Set' : '❌ Missing'
  }`
);
console.log(
  `   Real-Debrid API Key: ${
    config.apiKeys.realDebrid ? '✅ Set' : '⚠️  Optional'
  }`
);
console.log(
  `   Shotstack API Key: ${
    config.apiKeys.shotstack ? '✅ Set' : '⚠️  Optional'
  }`
);
console.log();

// Validate environment
console.log('✅ Running Validations...\n');

const envErrors = validateEnvironment();
const corsErrors = validateCorsConfig();

if (envErrors.length === 0) {
  console.log('✅ Environment validation: PASSED');
} else {
  console.log('❌ Environment validation: FAILED');
  envErrors.forEach((error) => console.log(`   - ${error}`));
}

if (corsErrors.length === 0) {
  console.log('✅ CORS validation: PASSED');
} else {
  console.log('⚠️  CORS validation: WARNINGS');
  corsErrors.forEach((error) => console.log(`   - ${error}`));
}

console.log();

// Overall result
const hasErrors = envErrors.length > 0;
const hasWarnings = corsErrors.length > 0;

if (!hasErrors && !hasWarnings) {
  console.log('🎉 Configuration validation completed successfully!');
  process.exit(0);
} else if (!hasErrors && hasWarnings) {
  console.log('⚠️  Configuration validation completed with warnings.');
  console.log('   The application should work but review the warnings above.');
  process.exit(0);
} else {
  console.log('❌ Configuration validation failed!');
  console.log(
    '   Please fix the errors above before starting the application.'
  );
  process.exit(1);
}
