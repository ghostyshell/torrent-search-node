# Database Migration System

This directory contains the database abstraction layer and migration tools for transitioning from local SQLite to Turso cloud database.

## Overview

The system provides:

- **DatabaseManager**: Abstraction layer supporting both local SQLite and Turso cloud database
- **UnifiedCache**: Drop-in replacement for SQLiteCache with cloud support
- **Migration Tools**: Scripts to export, import, and verify data migration

## Quick Start

### 1. Local Development (SQLite)

For local development, no additional setup is required. The system will automatically use local SQLite:

```bash
npm start
```

### 2. Production Setup (Turso Cloud)

1. **Create Turso Database**:

   ```bash
   # Install Turso CLI
   curl -sSfL https://get.tur.so/install.sh | bash

   # Create database
   turso db create torrent-cache

   # Get database URL and create auth token
   turso db show torrent-cache
   turso db tokens create torrent-cache
   ```

2. **Configure Environment Variables**:

   ```bash
   # Copy example environment file
   cp .env.example .env

   # Edit .env with your Turso credentials
   TURSO_DATABASE_URL=libsql://your-database-url
   TURSO_AUTH_TOKEN=your-auth-token
   NODE_ENV=production
   ```

3. **Run Migration**:

   ```bash
   # Dry run to test migration
   npm run migrate:dry-run

   # Full migration
   npm run migrate:full

   # Verify migration
   npm run migrate:verify
   ```

## Migration Commands

### Export Data

```bash
# Export from local SQLite to SQL files
npm run migrate:export

# Or run directly
node database/migrations/exportData.js
```

### Import to Turso

```bash
# Import all exported files to Turso
npm run migrate:import

# Or run specific commands
node database/migrations/importToTurso.js test           # Test connection
node database/migrations/importToTurso.js import-all    # Import all files
node database/migrations/importToTurso.js verify        # Verify import
```

### Full Migration

```bash
# Complete migration process
npm run migrate:full

# Dry run (export and validate only)
npm run migrate:dry-run

# Verify existing migration
npm run migrate:verify
```

## Environment Detection

The system automatically detects which database to use:

- **Local SQLite**: Used when `NODE_ENV !== 'production'` and Turso credentials are not provided
- **Turso Cloud**: Used when `NODE_ENV === 'production'` OR Turso credentials are provided
- **Force Cloud**: Set `FORCE_CLOUD_DB=true` to use cloud database in development

## Database Schema

The system maintains the following tables:

### cache

General key-value cache storage

- `key` (TEXT PRIMARY KEY)
- `value` (TEXT)
- `type` (TEXT) - 'json' or 'text'
- `created_at` (INTEGER)
- `updated_at` (INTEGER)
- `expires_at` (INTEGER)
- `metadata` (TEXT)

### images

Binary image data storage

- `id` (INTEGER PRIMARY KEY)
- `torrent_key` (TEXT)
- `image_type` (TEXT) - 'cover', 'screenshot', 'manual'
- `image_data` (BLOB)
- `mime_type` (TEXT)
- `original_url` (TEXT)
- `torrent_name` (TEXT)
- `created_at` (INTEGER)
- `metadata` (TEXT)

### stream_urls

Cached streaming URLs

- `magnet_hash` (TEXT PRIMARY KEY)
- `stream_url` (TEXT)
- `filename` (TEXT)
- `filesize` (INTEGER)
- `supports_range_requests` (BOOLEAN)
- `torrent_name` (TEXT)
- `created_at` (INTEGER)
- `last_accessed_at` (INTEGER)

### favorites

User favorite torrents

- `torrent_key` (TEXT PRIMARY KEY)
- `torrent_data` (TEXT) - JSON serialized torrent object
- `added_at` (INTEGER)

### cached_links

Cached torrent links

- `id` (TEXT PRIMARY KEY)
- `url` (TEXT)
- `title` (TEXT)
- `date_added` (TEXT)
- `stream_url` (TEXT)
- `is_streaming` (BOOLEAN)
- `error` (TEXT)

## API Endpoints

### Health Check

```
GET /health
```

Returns database health status and system information.

### Database Statistics

```
GET /api/database/stats
```

Returns database usage statistics and row counts.

## Error Handling

The system includes comprehensive error handling:

- **Connection Retry**: Automatic retry with exponential backoff
- **Graceful Degradation**: Application continues without cache if database fails
- **Fallback**: Automatic fallback to local SQLite if cloud database fails
- **Transaction Support**: Atomic operations with rollback on failure

## Monitoring

Monitor database health using:

1. **Health Check Endpoint**: `GET /health`
2. **Database Stats**: `GET /api/database/stats`
3. **Application Logs**: Check console output for database status

## Troubleshooting

### Migration Issues

1. **Export Fails**:

   ```bash
   # Check if source database exists
   ls -la cache/torrent_cache.db

   # Run export with specific path
   node database/migrations/exportData.js ./cache/torrent_cache.db
   ```

2. **Import Fails**:

   ```bash
   # Test Turso connection
   node database/migrations/importToTurso.js test

   # Check Turso credentials
   echo $TURSO_DATABASE_URL
   echo $TURSO_AUTH_TOKEN
   ```

3. **Verification Fails**:

   ```bash
   # Run verification separately
   npm run migrate:verify

   # Check individual table counts
   node database/migrations/importToTurso.js verify
   ```

### Runtime Issues

1. **Database Connection Errors**:

   - Check environment variables
   - Verify Turso database is accessible
   - Check network connectivity

2. **Performance Issues**:

   - Monitor connection pool usage
   - Check query execution times
   - Consider database location (edge vs primary)

3. **Data Inconsistency**:
   - Run verification checks
   - Compare local vs cloud data
   - Check for concurrent access issues

## Development

### Adding New Tables

1. Update schema in `DatabaseManager.js`
2. Add methods to `UnifiedCache.js`
3. Update migration scripts if needed
4. Test with both local and cloud databases

### Testing

```bash
# Test local database
NODE_ENV=development npm start

# Test cloud database
NODE_ENV=production npm start

# Test migration
npm run migrate:dry-run
```

## Security

- Turso auth tokens should be kept secure
- Use environment variables for credentials
- Rotate auth tokens regularly
- Monitor database access logs

## Performance

- Connection pooling is handled automatically
- Queries include retry logic with exponential backoff
- Indexes are created for optimal query performance
- Consider using Turso edge locations for better performance
