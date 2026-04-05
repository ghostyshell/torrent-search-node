const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { pipeline } = require('stream/promises');
const { config } = require('../config/environment');
const { getJobsRoot, ALLOWED_JOB_NAMES } = require('./backgroundJobFileLogger');

const gzip = promisify(zlib.gzip);

async function* walkFiles(dir) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walkFiles(full);
    } else if (ent.isFile()) {
      yield full;
    }
  }
}

function isUnderRoot(root, target) {
  const rel = path.relative(root, target);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Gzip idle .log files; delete .log and .gz older than retention.
 * @returns {Promise<object>}
 */
async function runMaintenance() {
  const root = getJobsRoot();
  const now = Date.now();
  const retentionMs =
    (config.logging.backgroundJobLogRetentionDays || 30) * 24 * 60 * 60 * 1000;
  const compressAfterMs = config.logging.backgroundJobLogCompressAfterMs || 6 * 60 * 60 * 1000;

  const results = {
    compressed: 0,
    deleted: 0,
    skippedCompressActive: 0,
    errors: [],
  };

  if (!fs.existsSync(root)) {
    return results;
  }

  for await (const filePath of walkFiles(root)) {
    if (!isUnderRoot(root, filePath)) continue;

    let st;
    try {
      st = await fs.promises.stat(filePath);
    } catch (e) {
      results.errors.push({ file: filePath, op: 'stat', error: e.message });
      continue;
    }

    const age = now - st.mtimeMs;

    if (age > retentionMs) {
      try {
        await fs.promises.unlink(filePath);
        results.deleted++;
      } catch (e) {
        results.errors.push({ file: filePath, op: 'delete', error: e.message });
      }
      continue;
    }

    if (filePath.endsWith('.log') && age >= compressAfterMs) {
      const gzPath = `${filePath}.gz`;
      try {
        const buf = await fs.promises.readFile(filePath);
        const zipped = await gzip(buf, { level: zlib.constants.Z_BEST_SPEED });
        await fs.promises.writeFile(gzPath, zipped);
        await fs.promises.unlink(filePath);
        results.compressed++;
      } catch (e) {
        results.errors.push({ file: filePath, op: 'compress', error: e.message });
      }
    } else if (filePath.endsWith('.log') && age < compressAfterMs) {
      results.skippedCompressActive++;
    }
  }

  return results;
}

module.exports = {
  runMaintenance,
  walkFiles,
  isUnderRoot,
};
