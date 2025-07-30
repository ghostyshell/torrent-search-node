# SQLite Cache Migration Guide

## Overview

This guide explains the migration from localStorage-only caching to a hybrid localStorage + SQLite backend system for persistent storage of cover images, stream URLs, favorites, and other cached data.

## Why SQLite Backend?

### Problems with localStorage-only caching:

- **Limited storage**: 5-10MB browser limits
- **Frequent clearing**: Images need refresh very often
- **Session-bound**: Data lost on browser clear/reinstall
- **No cross-device sync**: Data isolated to single browser
- **Performance**: Large datasets slow down browser

### Benefits of SQLite backend:

- **Unlimited storage**: Disk-based storage with no browser limits
- **True persistence**: Survives browser clears, reinstalls, device changes
- **Better performance**: Efficient indexing and querying
- **Reliability**: ACID transactions and data integrity
- **Scalability**: Handles thousands of cached items efficiently

## Architecture

### Hybrid Caching Strategy

```
Frontend (React)
├── localStorage (5-10MB, fast access)
│   ├── Recent/frequently accessed items
│   └── Immediate response cache
│
└── SQLite API calls (unlimited, persistent)
    ├── All historical data
    ├── Cross-session persistence
    └── Fallback when localStorage full

Backend (Node.js)
└── SQLite Database (disk storage)
    ├── cache table (general key-value)
    ├── images table (binary image data)
    ├── stream_urls table (streaming URLs)
    └── favorites table (user preferences)
```

## Implementation Details

### Backend Changes

#### New Files:

- `Torrent-Search-API/cache/sqliteCache.js` - SQLite cache management class
- Updated `Torrent-Search-API/app.js` - Added cache API endpoints
- Updated `Torrent-Search-API/package.json` - Added SQLite dependencies

#### New API Endpoints:

```
GET  /api/cache/stats              - Get cache statistics
POST /api/cache/clear              - Clear all caches
POST /api/cache/cover-image        - Store cover image
GET  /api/cache/cover-image/:key   - Get cover image
POST /api/cache/stream-url         - Store stream URL
GET  /api/cache/stream-url/:hash   - Get stream URL
POST /api/cache/favorites          - Add favorite
GET  /api/cache/favorites          - Get favorites
DELETE /api/cache/favorites        - Remove favorite
```

### Frontend Changes

#### New Files:

- `src/services/sqliteCacheAPI.ts` - API client for SQLite backend
- `src/services/enhancedCoverImageService.ts` - Hybrid cover image service

#### Updated Files:

- `src/services/cacheManager.ts` - Enhanced with SQLite integration
- `package.json` - Added sql.js dependency

## Migration Process

### Automatic Migration

The system is designed for seamless migration:

1. **Existing localStorage data remains functional**
2. **New data automatically uses hybrid storage**
3. **Background sync gradually moves data to SQLite**
4. **No user intervention required**

### Manual Migration Steps

If you want to force migration of existing data:

```javascript
// In browser console
await enhancedCoverImageService.syncWithBackend();
await cacheManager.getStats(); // Check migration status
```

## Setup Instructions

### 1. Run Setup Script

```bash
chmod +x setup-sqlite-cache.sh
./setup-sqlite-cache.sh
```

### 2. Manual Setup (if script fails)

#### Backend:

```bash
cd Torrent-Search-API
npm install better-sqlite3 sqlite3
mkdir -p cache
chmod 755 cache
npm start
```

#### Frontend:

```bash
cd torrent-browse-ui
npm install sql.js
npm start
```

### 3. Verify Installation

#### Check Backend:

```bash
curl http://localhost:3001/api/cache/stats
```

#### Check Frontend:

```javascript
// In browser console
cacheManager.getStats();
sqliteCacheAPI.getStats();
```

## Usage Examples

### Storing Cover Images

```javascript
// Frontend - Hybrid storage
await enhancedCoverImageService.setCoverImage(torrent, imageUrl, originalUrl);

// Backend API
POST /api/cache/cover-image
{
  "torrent": { "Name": "Movie", "Source": "site", "Size": "1GB" },
  "imageUrl": "https://example.com/cover.jpg",
  "imageData": "data:image/jpeg;base64,/9j/4AAQ..." // optional
}
```

### Retrieving Cover Images

```javascript
// Frontend - Hybrid retrieval
const imageUrl = await enhancedCoverImageService.getCoverImage(torrent);

// Backend API
GET / api / cache / cover - image / movie_site_1gb;
```

### Cache Management

```javascript
// Get comprehensive stats
const stats = await cacheManager.getStats();
console.log(stats.sqliteBackend); // Backend statistics

// Clear all caches
await cacheManager.clearAll(); // Clears both local and backend

// Health monitoring
const health = await cacheManager.getCacheHealth();
```

## Performance Characteristics

### Storage Limits

| Type          | localStorage | SQLite Backend           |
| ------------- | ------------ | ------------------------ |
| Cover Images  | 50 items     | Unlimited                |
| Stream URLs   | 50 items     | 100 items (auto-cleanup) |
| Screenshots   | 50 items     | Unlimited                |
| Favorites     | Unlimited    | Unlimited                |
| Manual Images | Per-torrent  | Per-torrent              |

### Access Patterns

- **localStorage**: Sub-millisecond access
- **SQLite Backend**: 10-50ms network + DB access
- **Hybrid Strategy**: Fast local access with backend fallback

## Development Tools

### Backend Development

```bash
# Check database directly
sqlite3 Torrent-Search-API/cache/torrent_cache.db
.tables
.schema
SELECT * FROM images LIMIT 5;
```

### Frontend Development

```javascript
// Available in development mode
window.cacheManager.getStats();
window.sqliteCacheAPI.getStats();
window.enhancedCoverImageService.getStats();

// Clear specific caches
cacheManager.clearCache('coverImages');
cacheManager.clearCache('streamUrls');
```

## Monitoring and Maintenance

### Health Monitoring

The system includes automatic health monitoring:

```javascript
const health = await cacheManager.getCacheHealth();
// Returns: { status: 'healthy|warning|critical', issues: [], recommendations: [] }
```

### Automatic Cleanup

- **Stream URLs**: Keeps 100 most recent, removes oldest
- **General Cache**: Respects TTL values, removes expired entries
- **Database**: VACUUM runs on cleanup cycles
- **localStorage**: Size-based management (50 items per type)

### Manual Maintenance

```bash
# Backend cleanup (runs automatically every hour)
curl -X POST http://localhost:3001/api/cache/clear

# Database optimization
sqlite3 cache/torrent_cache.db "VACUUM;"
```

## Troubleshooting

### Common Issues

#### "Database locked" errors

```bash
# Check for processes using the database
lsof cache/torrent_cache.db
# Restart the backend service
```

#### localStorage quota exceeded

```javascript
// The hybrid system handles this automatically
// But you can manually clear if needed
localStorage.clear();
```

#### API connection failures

```javascript
// Check backend connectivity
fetch('http://localhost:3001/api/cache/stats')
  .then((r) => r.json())
  .then(console.log);
```

### Performance Issues

#### Slow image loading

1. Check localStorage cache first
2. Verify backend connectivity
3. Monitor network requests in DevTools

#### Database growing too large

```bash
# Check database size
ls -lh Torrent-Search-API/cache/torrent_cache.db

# Manual cleanup
curl -X POST http://localhost:3001/api/cache/clear
```

## Security Considerations

### Data Protection

- SQLite database stored locally on server
- No sensitive data cached (only URLs and metadata)
- CORS properly configured for API access

### Storage Location

- Backend: `Torrent-Search-API/cache/torrent_cache.db`
- Frontend localStorage: Browser-managed
- No external dependencies or cloud storage

## Future Enhancements

### Planned Features

- **Cross-device sync**: Share cache across multiple devices
- **Image optimization**: Automatic compression and format conversion
- **Advanced analytics**: Cache hit rates and usage patterns
- **Export/Import**: Backup and restore cache data

### API Extensions

- Batch operations for bulk cache updates
- WebSocket support for real-time cache notifications
- GraphQL interface for complex cache queries

## Support

### Getting Help

- Check browser console for error messages
- Monitor backend logs for SQLite errors
- Use development tools for cache inspection

### Reporting Issues

Include the following information:

- Browser and version
- Node.js version
- SQLite database size
- Cache statistics output
- Error messages from console/logs

---

**Migration Benefits Summary:**

- ✅ Unlimited storage capacity
- ✅ True persistence across sessions
- ✅ Better performance with hybrid approach
- ✅ Automatic cleanup and maintenance
- ✅ Enhanced development tools
- ✅ Backward compatibility maintained
