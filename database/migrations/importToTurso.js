const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Load environment variables from .env file
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Import exported SQLite data to Turso cloud database
 * This script reads SQL dump files and executes them against Turso
 */
class TursoImporter {
  constructor(config = {}) {
    this.config = {
      tursoUrl: process.env.TURSO_DATABASE_URL || config.tursoUrl,
      tursoAuthToken: process.env.TURSO_AUTH_TOKEN || config.tursoAuthToken,
      batchSize: config.batchSize || 100, // Number of statements per batch
      timeout: config.timeout || 30000,
      maxStatementSize: config.maxStatementSize || 1024 * 1024, // 1MB max per statement
      ...config,
    };

    this.validateConfig();
  }

  validateConfig() {
    if (!this.config.tursoUrl) {
      throw new Error('TURSO_DATABASE_URL is required');
    }
    if (!this.config.tursoAuthToken) {
      throw new Error('TURSO_AUTH_TOKEN is required');
    }
  }

  async testConnection() {

    try {
      const response = await this.executeBatch(['SELECT 1 as test']);

      return true;
    } catch (error) {
      console.error('❌ Turso connection failed:', error.message);
      throw error;
    }
  }

  async executeBatch(statements) {
    // For single statement, use simple execute format
    if (statements.length === 1) {
      const payload = {
        stmt: {
          sql: statements[0],
        },
      };

      try {
        const response = await axios.post(
          `${this.config.tursoUrl}/v1/execute`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${this.config.tursoAuthToken}`,
              'Content-Type': 'application/json',
            },
            timeout: this.config.timeout,
            maxBodyLength: this.config.maxStatementSize,
            maxContentLength: this.config.maxStatementSize,
          }
        );

        return response.data;
      } catch (error) {
        if (error.response) {
          throw new Error(
            `Turso API error: ${error.response.status} - ${JSON.stringify(
              error.response.data
            )}`
          );
        }
        throw new Error(`Network error: ${error.message}`);
      }
    }

    // For multiple statements, use batch format
    const payload = {
      batch: {
        steps: statements.map((sql) => ({
          stmt: {
            sql: sql,
          },
        })),
      },
    };

    try {
      const response = await axios.post(
        `${this.config.tursoUrl}/v1/batch`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.config.tursoAuthToken}`,
            'Content-Type': 'application/json',
          },
          timeout: this.config.timeout,
          maxBodyLength: this.config.maxStatementSize * statements.length,
          maxContentLength: this.config.maxStatementSize * statements.length,
        }
      );

      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(
          `Turso API error: ${error.response.status} - ${JSON.stringify(
            error.response.data
          )}`
        );
      }
      throw new Error(`Network error: ${error.message}`);
    }
  }

  async importFromFile(filePath) {

    if (!fs.existsSync(filePath)) {
      throw new Error(`Import file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const statements = this.parseSqlStatements(content);

    if (statements.length === 0) {

      return { imported: 0, errors: [] };
    }

    return this.executeStatements(statements);
  }

  parseSqlStatements(content) {
    // Split by semicolons and filter out comments and empty lines
    const lines = content.split('\n');
    const statements = [];
    let currentStatement = '';

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Skip comments and empty lines
      if (trimmedLine.startsWith('--') || trimmedLine === '') {
        continue;
      }

      currentStatement += ' ' + trimmedLine;

      // If line ends with semicolon, we have a complete statement
      if (trimmedLine.endsWith(';')) {
        const statement = currentStatement.trim();
        if (statement && statement !== ';') {
          statements.push(statement);
        }
        currentStatement = '';
      }
    }

    return statements;
  }

  async executeStatements(statements) {
    const results = {
      imported: 0,
      errors: [],
      skipped: 0,
      batches: 0,
    };

    // Filter out oversized statements first
    const validStatements = [];
    const oversizedStatements = [];

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const statementSize = Buffer.byteLength(statement, 'utf8');

      if (statementSize > this.config.maxStatementSize) {
        oversizedStatements.push({
          index: i + 1,
          size: Math.round(statementSize / 1024),
          statement: statement.substring(0, 100) + '...',
        });
        results.skipped++;
      } else {
        validStatements.push(statement);
      }
    }

    if (oversizedStatements.length > 0) {

    }

    if (validStatements.length === 0) {

      return results;
    }

    // Use optimized batch processing
    const optimalBatchSize = 50; // Smaller batches for better reliability
    const totalBatches = Math.ceil(validStatements.length / optimalBatchSize);

    for (let i = 0; i < validStatements.length; i += optimalBatchSize) {
      const batch = validStatements.slice(i, i + optimalBatchSize);
      const batchNumber = Math.floor(i / optimalBatchSize) + 1;

      try {
        // Try batch execution first
        await this.executeBatch(batch);
        results.imported += batch.length;
        results.batches++;
      } catch (batchError) {
        console.warn(
          `   Batch ${batchNumber} failed, falling back to individual execution...`
        );

        // Fallback to individual execution for this batch
        let batchImported = 0;
        for (let j = 0; j < batch.length; j++) {
          try {
            await this.executeBatch([batch[j]]);
            batchImported++;
          } catch (individualError) {
            results.errors.push({
              batch: batchNumber,
              statement: j + 1,
              error: individualError.message,
              sql: batch[j].substring(0, 100) + '...',
            });
          }
        }

        results.imported += batchImported;

      }

      // Minimal delay between batches
      if (i + optimalBatchSize < validStatements.length) {
        await this.delay(10);
      }
    }

    // Add oversized statement errors to results
    for (const oversized of oversizedStatements) {
      results.errors.push({
        statementNumber: oversized.index,
        error: `Statement too large: ${oversized.size}KB`,
        statement: oversized.statement,
      });
    }

    return results;
  }

  async importAllExports(exportDir = './database/migrations/exports') {

    if (!fs.existsSync(exportDir)) {
      throw new Error(`Export directory not found: ${exportDir}`);
    }

    const files = fs
      .readdirSync(exportDir)
      .filter((file) => file.endsWith('.sql'))
      .sort(); // Import in consistent order

    if (files.length === 0) {
      throw new Error('No SQL export files found');
    }

    // Skip problematic files with large binary data for now
    const skipFiles = ['images_export.sql'];
    const filesToProcess = files.filter((file) => !skipFiles.includes(file));
    const skippedFiles = files.filter((file) => skipFiles.includes(file));

    if (skippedFiles.length > 0) {

    }

    const importResults = {};
    let totalImported = 0;
    let totalErrors = 0;

    for (const file of filesToProcess) {
      const filePath = path.join(exportDir, file);

      try {
        const result = await this.importFromFile(filePath);
        importResults[file] = result;
        totalImported += result.imported;
        totalErrors += result.errors.length;

      } catch (error) {
        console.error(`❌ ${file}: ${error.message}`);
        importResults[file] = { error: error.message, imported: 0, errors: [] };
        totalErrors++;
      }
    }

    // Mark skipped files in results
    for (const file of skippedFiles) {
      importResults[file] = {
        skipped: true,
        reason: 'Contains large binary data - requires special handling',
        imported: 0,
        errors: [],
      };
    }

    return {
      files: importResults,
      summary: {
        totalImported,
        totalErrors,
        filesProcessed: filesToProcess.length,
        filesSkipped: skippedFiles.length,
      },
    };
  }

  async verifyImport() {

    const tables = [
      'cache',
      'images',
      'stream_urls',
      'favorites',
      'cached_links',
    ];
    const verification = {};

    for (const table of tables) {
      try {
        const result = await this.executeBatch([
          `SELECT COUNT(*) as count FROM ${table}`,
        ]);
        const countValue = result.result?.rows?.[0]?.[0];
        const count = countValue?.value ? parseInt(countValue.value) : 0;
        verification[table] = { count, success: true };

      } catch (error) {
        verification[table] = {
          count: 0,
          success: false,
          error: error.message,
        };

      }
    }

    return verification;
  }

  async clearAllData() {

    const tables = [
      'cache',
      'images',
      'stream_urls',
      'favorites',
      'cached_links',
    ];
    const statements = tables.map((table) => `DELETE FROM ${table}`);

    try {
      await this.executeBatch(statements);

      return true;
    } catch (error) {
      console.error('❌ Failed to clear data:', error.message);
      throw error;
    }
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// CLI usage
if (require.main === module) {
  async function main() {
    const command = process.argv[2];
    const filePath = process.argv[3];

    if (!command) {

      process.exit(1);
    }

    const importer = new TursoImporter();

    try {
      switch (command) {
        case 'test':
          await importer.testConnection();
          break;

        case 'import':
          if (!filePath) {
            console.error('❌ File path required for import command');
            process.exit(1);
          }
          await importer.testConnection();
          const result = await importer.importFromFile(filePath);

          break;

        case 'import-all':
          const exportDir = filePath || './database/migrations/exports';
          await importer.testConnection();
          const allResults = await importer.importAllExports(exportDir);

          break;

        case 'verify':
          await importer.testConnection();
          await importer.verifyImport();
          break;

        case 'clear':
          await importer.testConnection();
          await importer.clearAllData();
          break;

        default:
          console.error(`❌ Unknown command: ${command}`);
          process.exit(1);
      }
    } catch (error) {
      console.error('❌ Operation failed:', error.message);
      process.exit(1);
    }
  }

  main();
}

module.exports = TursoImporter;
