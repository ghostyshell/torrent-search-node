# 🚀 Backend E2E Testing Setup

This guide explains the GitHub Actions workflow for testing **only the backend API**.

## 📍 Key Fix Applied

**Problem**: GitHub Actions was failing with "Some specified paths were not resolved, unable to cache dependencies."

**Solution**:

- ✅ Moved workflow to correct location: `/.github/workflows/backend-e2e-tests.yml` (repository root)
- ✅ Fixed cache path: `./Torrent-Search-API/package-lock.json` (relative to repo root)
- ✅ Focused on backend-only testing with proper path filters

## 🎯 Backend-Only Focus

The workflow is configured to **only run when backend files change**:

```yaml
paths:
  - 'Torrent-Search-API/**' # Any backend file changes
  - '.github/workflows/backend-e2e-tests.yml' # Workflow changes
```

This means:

- ❌ Frontend changes won't trigger backend tests
- ✅ Only backend API changes trigger the workflow
- ✅ Manual triggering is still available

## 🔐 Required Secrets

Add these to your GitHub repository secrets:

1. Go to GitHub repository → **Settings** → **Secrets and variables** → **Actions**
2. Add these secrets:

| Secret Name          | Value                                                       |
| -------------------- | ----------------------------------------------------------- |
| `TURSO_DATABASE_URL` | Your Turso database URL (e.g., `libsql://your-db.turso.io`) |
| `TURSO_AUTH_TOKEN`   | Your Turso authentication token                             |

## 🧪 What Gets Tested (Backend Only)

**75 comprehensive backend E2E tests** covering:

### API Endpoints:

- ✅ **Health** (4 tests): `/health`, `/health/detailed`, `/health/ready`, `/health/live`
- ✅ **Torrent Search** (15 tests): YTS, PirateBay, LimeTorrent, NyaaSI, Combo search
- ✅ **Favorites** (12 tests): CRUD operations, pagination, details, screenshots
- ✅ **Cache** (8 tests): Statistics, cached links, cleanup operations
- ✅ **Images** (10 tests): Google Images search, Pixhost upload, proxying
- ✅ **Video Screenshots** (14 tests): Generation, retrieval, batch processing
- ✅ **Proxy** (12 tests): Real-Debrid integration, CORS, authentication

### Backend Infrastructure:

- ✅ **Database Health**: Turso connection validation
- ✅ **Security Audit**: Vulnerability scanning
- ✅ **Multi-Node Testing**: Node.js 18.x and 20.x
- ✅ **Performance**: Database warmup, timeout protection

## 🏃‍♂️ How to Run

### Automatic Triggers:

- **Push** to main/master (backend files only)
- **Pull Request** to main/master (backend files only)

### Manual Trigger:

1. Go to GitHub repository → **Actions** tab
2. Click "Backend E2E API Tests"
3. Click "Run workflow"

### Local Testing:

```bash
cd Torrent-Search-API
npm test                    # Run all 75 backend tests
npm run test:headed         # Run with browser UI
npm run test:report        # View test report
```

## 📊 Test Results

After each run you get:

- **Test Summary**: Pass/fail for all 75 tests
- **Playwright Report**: Detailed results (downloadable)
- **Performance Metrics**: Response times, database health
- **Security Report**: Vulnerability scan results

## ✅ Success Criteria

The workflow passes when:

- ✅ All 75 E2E backend tests pass
- ✅ Database health check succeeds
- ✅ No high-severity security vulnerabilities
- ✅ Tests complete within 15 minutes

## 🛠️ Troubleshooting

### Common Issues:

1. **Cache path error**: Fixed! Now uses `./Torrent-Search-API/package-lock.json`
2. **Database connection failed**: Check your Turso secrets
3. **Tests timeout**: Database warmup prevents this (built-in)
4. **Wrong triggers**: Workflow only runs for backend changes

The workflow is now optimized for **backend-only testing** with proper GitHub Actions setup! 🎉
