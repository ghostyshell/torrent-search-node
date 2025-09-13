# Backend GitHub Actions Workflows

This directory contains GitHub Actions workflows specifically for the **Torrent Search Backend API**.

## 🎯 Focus: Backend Only

These workflows are designed to test and validate only the backend API components:
- Node.js/Express.js API server
- Database operations (Turso cloud database)
- Cache management
- API endpoint functionality
- Security vulnerabilities

## 🔧 Workflow: `backend-e2e-tests.yml`

Comprehensive backend E2E testing workflow that runs on:
- **Push** to `main`/`master` branches (only when backend files change)
- **Pull requests** to `main`/`master` branches (only when backend files change)
- **Manual trigger** via GitHub UI

### Triggers
```yaml
paths:
  - 'Torrent-Search-API/**'
  - '.github/workflows/**'
```

### Jobs:

1. **backend-e2e-tests**: Runs all 75 Playwright E2E tests
   - Tests on Node.js 18.x and 20.x
   - Validates API endpoints, cache operations, favorites, etc.
   - Uploads test reports as artifacts

2. **backend-health-check**: Verifies database connectivity
   - Quick health check before running full test suite
   - Validates Turso cloud database connection

3. **backend-security-audit**: Security vulnerability scanning
   - Runs `npm audit` to check for known vulnerabilities
   - Reports security issues in backend dependencies

4. **backend-test-summary**: Consolidated results
   - Provides summary of all backend test results
   - Shows pass/fail status for each backend job

## 🔐 Required Secrets

Add these secrets to your GitHub repository settings:

### Backend Database Configuration
- **`TURSO_DATABASE_URL`**: Your Turso cloud database URL
- **`TURSO_AUTH_TOKEN`**: Your Turso authentication token

## 📊 Backend Test Coverage

The workflow tests **75 comprehensive backend API endpoints**:

### API Categories Tested:
- ✅ **Health Endpoints** (4 tests)
  - `/health`, `/health/detailed`, `/health/ready`, `/health/live`

- ✅ **Torrent Search** (15 tests)
  - YTS, PirateBay, LimeTorrent, NyaaSI, TorrentProject
  - Combo search, details retrieval, parameter validation

- ✅ **Favorites Management** (12 tests)
  - Add/remove favorites, pagination, details, screenshots

- ✅ **Cache Operations** (8 tests)
  - Stats, cached links, cleanup, performance metrics

- ✅ **Image Processing** (10 tests)
  - Google Images search, Pixhost upload, image proxying

- ✅ **Video Screenshots** (14 tests)
  - Screenshot generation, retrieval, batch processing

- ✅ **Proxy Services** (12 tests)
  - Real-Debrid integration, CORS handling, authentication

## 🚀 Backend-Specific Features

- ✅ **Database Warmup**: Pre-initializes Turso connections for fast tests
- ✅ **Timeout Protection**: 5-second timeouts prevent hanging cache operations
- ✅ **Parallel Testing**: Tests multiple Node.js versions simultaneously
- ✅ **Fallback Removal**: Optimized screenshot discovery (no more 360+ cache calls)
- ✅ **Performance Monitoring**: Response time tracking and database health

## 🛠️ Local Backend Development

To run the same backend tests locally:

```bash
cd Torrent-Search-API
npm test                    # Run all backend E2E tests
npm run test:headed         # Run tests with browser UI
npm run test:ui            # Interactive test runner
npm run test:report        # View test report
npm run validate-config    # Validate backend configuration
```

## 📈 Backend Monitoring

The backend workflow will:
- ❌ **Fail** if any backend E2E tests fail
- ⚠️ **Warn** about backend security vulnerabilities
- 📊 **Report** backend API performance metrics
- 🔄 **Retry** flaky backend tests automatically in CI
- 🎯 **Focus** only on backend changes (ignores frontend changes)

This ensures high code quality and reliability specifically for the backend API components.
