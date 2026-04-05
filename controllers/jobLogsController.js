const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const { randomUUID } = require('crypto');
const { pipeline } = require('stream/promises');
const { config } = require('../config/environment');
const {
  getJobsRoot,
  ALLOWED_JOB_NAMES,
  assertJobName,
  runWithJobFileLogging,
  LOG_VERSION,
} = require('../services/backgroundJobFileLogger');
const { runMaintenance } = require('../services/backgroundJobLogMaintenance');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Run files: `{runId}.log` or gzip maintenance output `{runId}.log.gz` */
const FILE_RE = /^[\w.-]+\.log(\.gz)?$/;

const STAGING_DIR = () => path.join(config.logging.logDir, '_job_log_staging');
const MAX_MATERIALIZE_BYTES = 80 * 1024 * 1024;

function safeResolveUnderRoot(root, segments) {
  const target = path.join(root, ...segments);
  const normRoot = path.normalize(root + path.sep);
  const normTarget = path.normalize(target);
  if (!normTarget.startsWith(normRoot)) {
    return null;
  }
  return normTarget;
}

/**
 * GET /api/monitoring/job-logs/list?job=&dateFrom=&dateTo=
 */
const listJobLogs = async (req, res) => {
  try {
    const root = getJobsRoot();
    const jobFilter = req.query.job;
    const dateFrom = req.query.dateFrom;
    const dateTo = req.query.dateTo;

    if (jobFilter) {
      assertJobName(jobFilter);
    }
    if (dateFrom && !DATE_RE.test(dateFrom)) {
      return res.status(400).json({ success: false, error: 'Invalid dateFrom (use YYYY-MM-DD)' });
    }
    if (dateTo && !DATE_RE.test(dateTo)) {
      return res.status(400).json({ success: false, error: 'Invalid dateTo (use YYYY-MM-DD)' });
    }

    const files = [];

    if (!fs.existsSync(root)) {
      return res.json({ success: true, logVersion: LOG_VERSION, root, files: [] });
    }

    const jobDirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());

    for (const jd of jobDirs) {
      const jobName = jd.name;
      if (!ALLOWED_JOB_NAMES.has(jobName)) continue;
      if (jobFilter && jobName !== jobFilter) continue;

      const jobPath = path.join(root, jobName);
      const dateDirs = fs.readdirSync(jobPath, { withFileTypes: true }).filter((d) => d.isDirectory());

      for (const dd of dateDirs) {
        const dateStr = dd.name;
        if (!DATE_RE.test(dateStr)) continue;
        if (dateFrom && dateStr < dateFrom) continue;
        if (dateTo && dateStr > dateTo) continue;

        const datePath = path.join(jobPath, dateStr);
        const names = fs.readdirSync(datePath);
        for (const name of names) {
          if (!FILE_RE.test(name)) continue;
          const full = path.join(datePath, name);
          const st = fs.statSync(full);
          files.push({
            job: jobName,
            date: dateStr,
            name,
            compressed: name.endsWith('.log.gz'),
            sizeBytes: st.size,
            mtime: st.mtime.toISOString(),
            relativePath: path.posix.join(jobName, dateStr, name),
          });
        }
      }
    }

    files.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));

    res.json({
      success: true,
      logVersion: LOG_VERSION,
      root,
      count: files.length,
      files,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

async function* eachLineOfLogFile(filePath) {
  if (filePath.endsWith('.gz')) {
    // `.log.gz` from maintenance, or legacy `.gz`
    const gunzip = zlib.createGunzip();
    const rs = fs.createReadStream(filePath);
    rs.on('error', () => gunzip.destroy());
    const input = rs.pipe(gunzip);
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (line.trim()) yield line;
      }
    } finally {
      rl.close();
    }
  } else {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });
    try {
      for await (const line of rl) {
        if (line.trim()) yield line;
      }
    } finally {
      rl.close();
    }
  }
}

function collectLogFiles(root, { job, dateFrom, dateTo, includeCompressed }) {
  const out = [];
  if (!fs.existsSync(root)) return out;

  const jobDirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const jd of jobDirs) {
    const jobName = jd.name;
    if (!ALLOWED_JOB_NAMES.has(jobName)) continue;
    if (job && jobName !== job) continue;

    const jobPath = path.join(root, jobName);
    const dateDirs = fs.readdirSync(jobPath, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const dd of dateDirs) {
      const dateStr = dd.name;
      if (!DATE_RE.test(dateStr)) continue;
      if (dateFrom && dateStr < dateFrom) continue;
      if (dateTo && dateStr > dateTo) continue;

      const datePath = path.join(jobPath, dateStr);
      for (const name of fs.readdirSync(datePath)) {
        if (name.endsWith('.log.gz') && !includeCompressed) continue;
        if (!(name.endsWith('.log') || name.endsWith('.log.gz'))) continue;
        if (!FILE_RE.test(name)) continue;
        out.push(path.join(datePath, name));
      }
    }
  }
  return out;
}

/**
 * GET /api/monitoring/job-logs/search
 *   q (required), job?, dateFrom?, dateTo?, includeCompressed?,
 *   offset (default 0), limit (default 50, max 200),
 *   sort=desc|asc — file order by mtime; desc also reverses hits within each file (newer lines first). Default desc.
 */
const searchJobLogs = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ success: false, error: 'Query parameter q is required' });
    }

    const sort = req.query.sort === 'asc' ? 'asc' : 'desc';
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 200);
    const job = req.query.job || null;
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const includeCompressed = req.query.includeCompressed !== 'false';

    if (job) assertJobName(job);
    if (dateFrom && !DATE_RE.test(dateFrom)) {
      return res.status(400).json({ success: false, error: 'Invalid dateFrom' });
    }
    if (dateTo && !DATE_RE.test(dateTo)) {
      return res.status(400).json({ success: false, error: 'Invalid dateTo' });
    }

    const root = getJobsRoot();
    let paths = collectLogFiles(root, { job, dateFrom, dateTo, includeCompressed });

    paths = paths
      .map((p) => {
        try {
          return { p, mtime: fs.statSync(p).mtimeMs };
        } catch {
          return { p, mtime: 0 };
        }
      })
      .sort((a, b) => (sort === 'desc' ? b.mtime - a.mtime : a.mtime - b.mtime))
      .map((x) => x.p);

    const needle = q.toLowerCase();
    const matches = [];
    let skipped = 0;

    outer: for (const filePath of paths) {
      const fileHits = [];
      try {
        for await (const line of eachLineOfLogFile(filePath)) {
          if (line.toLowerCase().includes(needle)) {
            fileHits.push(line);
          }
        }
      } catch {
        // skip unreadable / corrupt gzip
        continue;
      }

      const ordered = sort === 'desc' ? [...fileHits].reverse() : fileHits;
      const rel = path.relative(root, filePath).split(path.sep).join('/');

      for (const line of ordered) {
        if (skipped < offset) {
          skipped++;
          continue;
        }
        if (matches.length >= limit) {
          break outer;
        }
        matches.push({ file: rel, line });
      }
    }

    const nextOffset = offset + matches.length;
    const hasMore = matches.length === limit;

    res.json({
      success: true,
      query: q,
      sort,
      offset,
      limit,
      returned: matches.length,
      nextOffset,
      hasMore,
      matches,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

function cleanupStagingFile(filePath) {
  fs.promises.unlink(filePath).catch(() => {});
}

/**
 * GET /api/monitoring/job-logs/file?job=&date=&name=&mode=stream|materialize
 * mode=stream (default): plain .log as file stream; .gz gunzipped to response (no temp file).
 * mode=materialize: .gz written to a temp file, sent, then temp deleted (plain .log unchanged).
 */
const serveJobLogFile = async (req, res) => {
  let stagingPath = null;
  try {
    const job = req.query.job;
    const date = req.query.date;
    const name = req.query.name;
    const mode = (req.query.mode || 'stream').toLowerCase();

    if (!job || !date || !name) {
      return res.status(400).json({ success: false, error: 'job, date, and name are required' });
    }
    assertJobName(job);
    if (!DATE_RE.test(date)) {
      return res.status(400).json({ success: false, error: 'Invalid date' });
    }
    if (!FILE_RE.test(name)) {
      return res.status(400).json({ success: false, error: 'Invalid name' });
    }

    const root = getJobsRoot();
    const fullPath = safeResolveUnderRoot(root, [job, date, name]);
    if (!fullPath || !fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, error: 'Log file not found' });
    }

    res.setHeader('X-Job-Log-File', path.basename(fullPath));

    if (name.endsWith('.gz')) {
      if (mode === 'materialize') {
        const st = await fs.promises.stat(fullPath);
        if (st.size > MAX_MATERIALIZE_BYTES) {
          return res.status(413).json({
            success: false,
            error: `Compressed file too large to materialize (max ${MAX_MATERIALIZE_BYTES} bytes). Use mode=stream.`,
          });
        }

        await fs.promises.mkdir(STAGING_DIR(), { recursive: true });
        stagingPath = path.join(STAGING_DIR(), `${randomUUID()}.log`);
        await pipeline(
          fs.createReadStream(fullPath),
          zlib.createGunzip(),
          fs.createWriteStream(stagingPath)
        );

        return res.sendFile(path.resolve(stagingPath), (err) => {
          cleanupStagingFile(stagingPath);
          if (err && !res.headersSent) {
            res.status(500).json({ success: false, error: err.message });
          }
        });
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${name.replace(/\.gz$/, '.log')}"`);
      const rs = fs.createReadStream(fullPath);
      const gunzip = zlib.createGunzip();
      rs.on('error', (e) => {
        gunzip.destroy();
        if (!res.headersSent) res.status(500).end(e.message);
      });
      gunzip.on('error', (e) => {
        if (!res.headersSent) res.status(500).end(e.message);
      });
      return rs.pipe(gunzip).pipe(res);
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.sendFile(path.resolve(fullPath));
  } catch (error) {
    if (stagingPath) cleanupStagingFile(stagingPath);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
};

/**
 * POST /api/monitoring/job-logs/maintenance — gzip + retention (also scheduled)
 */
const triggerJobLogMaintenance = async (req, res) => {
  try {
    res.json({ success: true, message: 'Job log maintenance started' });

    setImmediate(() => {
      runWithJobFileLogging('jobLogMaintenance', async () => {
        const logger = require('../middleware/logger');
        try {
          const result = await runMaintenance();
          logger.info('Job log maintenance completed', result);
        } catch (e) {
          logger.error('Job log maintenance failed', { error: e.message });
        }
      }).catch(() => {});
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  listJobLogs,
  searchJobLogs,
  serveJobLogFile,
  triggerJobLogMaintenance,
};
